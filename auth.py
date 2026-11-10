"""Autenticação do painel: senha criada no primeiro acesso e sessões por cookie.

Modos:
    setup  nenhuma senha definida (e sem TELEMETRY_TOKEN): o painel pede para criar uma senha.
    login  há senha (ou TELEMETRY_TOKEN): o painel pede a senha. O TELEMETRY_TOKEN, se definido,
           também vale como senha e como `Authorization: Bearer` para scripts.

A senha é guardada com hash (scrypt). A sessão é um valor aleatório num cookie HttpOnly; no
banco fica só o hash dele. Quem acessa de fora do computador (ou por proxy reverso) precisa
do código de configuração mostrado no console para criar a senha pela primeira vez.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from typing import TYPE_CHECKING

from fastapi import FastAPI, Request, Response, WebSocket
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from store import Store

SESSION_COOKIE = "pokeidle_session"
SESSION_SECONDS = 30 * 24 * 3600
MIN_PASSWORD = 8
LOOPBACK = ("127.0.0.1", "::1", "localhost")
_FORWARD_HEADERS = ("x-forwarded-for", "forwarded", "x-real-ip")
_SCRYPT = (2 ** 14, 8, 1)  # n, r, p


# ----------------------------------------------------------------- senha
def hash_password(password: str) -> str:
    n, r, p = _SCRYPT
    salt = os.urandom(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=n, r=r, p=p, dklen=32)
    return f"scrypt${n}${r}${p}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, dk = stored.split("$")
        calc = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p),
                              dklen=len(bytes.fromhex(dk)))
        return hmac.compare_digest(calc, bytes.fromhex(dk))
    except (ValueError, TypeError):
        return False


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Auth:
    def __init__(self, store: "Store", exposed: bool = False, env_token: str | None = None) -> None:
        self.store = store
        self.exposed = exposed  # o servidor escuta fora do loopback
        self.env_token = (os.getenv("TELEMETRY_TOKEN", "") if env_token is None else env_token).strip()
        self._fails: dict[str, list[float]] = {}

    # ---------------------------------------------------------- estado
    @property
    def password_set(self) -> bool:
        return bool(self.store.get_setting("pw_hash"))

    @property
    def mode(self) -> str:
        return "login" if (self.password_set or self.env_token) else "setup"

    def required(self) -> bool:
        """Leituras (dashboard) exigem login quando há senha/token, ou quando o servidor está exposto."""
        return self.mode == "login" or self.exposed

    def local_direct(self, request: Request) -> bool:
        """Acesso direto do próprio computador (sem proxy reverso por cima)."""
        host = request.client.host if request.client else ""
        return (not self.exposed and host in LOOPBACK
                and not any(h in request.headers for h in _FORWARD_HEADERS))

    # ---------------------------------------------------------- limite de tentativas
    @staticmethod
    def client_ip(request: Request) -> str:
        """IP real do cliente. Atrás de proxy local (Caddy/nginx no mesmo servidor) o socket é sempre
        127.0.0.1: nesse caso vale o último X-Forwarded-For (o que o proxy acrescentou). De qualquer outro
        par, o cabeçalho é ignorado (falsificável)."""
        peer = request.client.host if request.client else "?"
        if peer in LOOPBACK:
            fwd = request.headers.get("x-forwarded-for", "")
            last = fwd.split(",")[-1].strip()
            if last:
                return last[:64]
        return peer

    def limited(self, request: Request) -> bool:
        ip = self.client_ip(request)
        now = time.time()
        recent = [t for t in self._fails.get(ip, []) if now - t < 60]
        if recent:
            self._fails[ip] = recent
        else:
            self._fails.pop(ip, None)
        return len(recent) >= 10

    def fail(self, request: Request) -> None:
        ip = self.client_ip(request)
        if len(self._fails) > 5000:  # evita crescer sem limite sob ataque com muitos IPs
            now = time.time()
            self._fails = {k: v for k, v in self._fails.items() if v and now - v[-1] < 60}
        self._fails.setdefault(ip, []).append(time.time())

    # ---------------------------------------------------------- sessões
    def new_session(self) -> str:
        token = secrets.token_urlsafe(32)
        self.store.add_session(_digest(token), time.time() + SESSION_SECONDS)
        return token

    def session_ok(self, token: str | None) -> bool:
        return bool(token) and self.store.session_valid(_digest(token))

    def set_cookie(self, request: Request, response: Response, token: str) -> None:
        secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
        response.set_cookie(SESSION_COOKIE, token, max_age=SESSION_SECONDS, httponly=True,
                            samesite="strict", secure=secure, path="/")

    # ---------------------------------------------------------- verificação
    def _token_ok(self, supplied: str | None) -> bool:
        return bool(self.env_token) and supplied is not None and hmac.compare_digest(supplied, self.env_token)

    def check(self, request: Request, query_token: str | None = None) -> bool:
        """True se a requisição está autenticada (cookie de sessão, ou TELEMETRY_TOKEN por bearer/?token=)."""
        auth = request.headers.get("authorization", "")
        supplied = auth[7:] if auth.lower().startswith("bearer ") else query_token
        if supplied and self._token_ok(supplied):
            return True
        if self.session_ok(request.cookies.get(SESSION_COOKIE)):
            return True
        if supplied and self.env_token:
            self.fail(request)  # chave errada em bearer/query conta como tentativa
        return False

    def check_ws(self, ws: WebSocket) -> bool:
        if self._token_ok(ws.query_params.get("token")):
            return True
        return self.session_ok(ws.cookies.get(SESSION_COOKIE))

    def guard(self, request: Request, query_token: str | None = None) -> JSONResponse | None:
        """Para rotas protegidas: None = liberado; senão, a resposta de erro."""
        if self.session_ok(request.cookies.get(SESSION_COOKIE)):
            return None  # sessão válida nunca é barrada pelo limite de tentativas
        if self.limited(request):
            return JSONResponse({"error": "Muitas tentativas. Aguarde 1 minuto."}, status_code=429)
        if self.check(request, query_token):
            return None
        return JSONResponse({"error": "unauthorized", "mode": self.mode}, status_code=401)

    def read_guard(self, request: Request, query_token: str | None = None) -> JSONResponse | None:
        """Leituras do dashboard: abertas só quando nada exige login."""
        return None if not self.required() else self.guard(request, query_token)

    # ---------------------------------------------------------- operações
    def set_password(self, password: str) -> None:
        self.store.set_setting("pw_hash", hash_password(password))
        self.store.set_setting("setup_code", "")

    def setup_code(self) -> str:
        """Código de configuração (só existe enquanto não há senha). Gerado sob demanda."""
        code = self.store.get_setting("setup_code")
        if not code:
            code = secrets.token_urlsafe(9)
            self.store.set_setting("setup_code", code)
        return code

    def reset(self) -> None:
        """Esqueci a senha: apaga a senha e encerra todas as sessões (comando local)."""
        self.store.set_setting("pw_hash", "")
        self.store.clear_sessions()


# ----------------------------------------------------------------- rotas
class SetupIn(BaseModel):
    password: str = Field(min_length=1, max_length=256)
    code: str | None = Field(None, max_length=128)


class LoginIn(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class ChangeIn(BaseModel):
    current: str | None = Field(None, max_length=256)
    new: str = Field(min_length=1, max_length=256)


def register_auth_routes(app: FastAPI, auth: Auth) -> None:
    def _status(request: Request) -> dict:
        return {"mode": auth.mode, "authenticated": auth.check(request) if auth.mode == "login" else False,
                "needsCode": auth.mode == "setup" and not auth.local_direct(request),
                "passwordSet": auth.password_set, "minPassword": MIN_PASSWORD}

    @app.get("/api/auth/status")
    async def status(request: Request):
        return _status(request)

    @app.post("/api/auth/setup")
    async def setup(body: SetupIn, request: Request):
        if auth.mode != "setup":
            return JSONResponse({"error": "A senha já foi criada."}, status_code=409)
        if auth.limited(request):
            return JSONResponse({"error": "Muitas tentativas. Aguarde 1 minuto."}, status_code=429)
        if not auth.local_direct(request):
            if not body.code or not hmac.compare_digest(body.code.strip(), auth.setup_code()):
                auth.fail(request)
                return JSONResponse({"error": "Código de configuração incorreto (veja o console do bot)."},
                                    status_code=403)
        if len(body.password) < MIN_PASSWORD:
            return JSONResponse({"error": f"A senha precisa ter pelo menos {MIN_PASSWORD} caracteres."},
                                status_code=400)
        auth.set_password(body.password)
        resp = JSONResponse({"ok": True})
        auth.set_cookie(request, resp, auth.new_session())
        return resp

    @app.post("/api/auth/login")
    async def login(body: LoginIn, request: Request):
        if auth.mode != "login":
            return JSONResponse({"error": "Crie a senha primeiro.", "mode": auth.mode}, status_code=409)
        if auth.limited(request):
            return JSONResponse({"error": "Muitas tentativas. Aguarde 1 minuto."}, status_code=429)
        stored = auth.store.get_setting("pw_hash")
        ok = (bool(stored) and verify_password(body.password, stored)) or auth._token_ok(body.password)
        if not ok:
            auth.fail(request)
            return JSONResponse({"error": "Senha incorreta."}, status_code=401)
        resp = JSONResponse({"ok": True})
        auth.set_cookie(request, resp, auth.new_session())
        return resp

    @app.post("/api/auth/logout")
    async def logout(request: Request):
        token = request.cookies.get(SESSION_COOKIE)
        if token:
            auth.store.delete_session(_digest(token))
        resp = JSONResponse({"ok": True})
        resp.delete_cookie(SESSION_COOKIE, path="/")
        return resp

    @app.post("/api/auth/password")
    async def change_password(body: ChangeIn, request: Request):
        if (r := auth.guard(request)):
            return r
        stored = auth.store.get_setting("pw_hash")
        if stored and not (body.current and verify_password(body.current, stored)):
            auth.fail(request)
            return JSONResponse({"error": "A senha atual está incorreta."}, status_code=403)
        if len(body.new) < MIN_PASSWORD:
            return JSONResponse({"error": f"A nova senha precisa ter pelo menos {MIN_PASSWORD} caracteres."},
                                status_code=400)
        auth.set_password(body.new)
        auth.store.clear_sessions()  # derruba os outros aparelhos
        resp = JSONResponse({"ok": True})
        auth.set_cookie(request, resp, auth.new_session())
        return resp
