"""Rotas de gestão do painel: contas, importação, testes e configurações.

Toda rota aqui exige login no painel (cookie de sessão) ou o TELEMETRY_TOKEN
(`Authorization: Bearer <token>` ou `?token=`), conforme auth.py.
Tokens do jogo e senhas de proxy NUNCA saem pela API: só dicas mascaradas.
"""
from __future__ import annotations

import asyncio
import json
import re
import secrets
import time
from typing import TYPE_CHECKING

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import config
import login_window
from auth import Auth
from config import ProxyConfig, build_account_config
from connection import State, probe_account, probe_exit_ip
from notify import BLUE
from store import DEVICE_ID_RE, Store, mask, new_device_id

if TYPE_CHECKING:
    from manager import AccountManager

DISCORD_WEBHOOK_RE = re.compile(r"^https://(?:canary\.|ptb\.)?(?:discord|discordapp)\.com/api/webhooks/\d+/[\w-]+/?$")
TOKEN_RE = re.compile(r"^\S{10,4096}$")
LOGIN_TTL_S = 600          # tempo para concluir o cadastro depois do login na janela
LOOPBACK_CLIENTS = ("127.0.0.1", "::1", "localhost")


# ----------------------------------------------------------------- modelos
class ProxyIn(BaseModel):
    scheme: str = "socks5"
    host: str = Field(min_length=1, max_length=253)
    port: int = Field(ge=1, le=65535)
    username: str = Field("", max_length=256)
    password: str | None = Field(None, max_length=256)  # None = manter a atual (edição)


class OptionsIn(BaseModel):
    hunt_slug: str | None = Field(None, max_length=64)
    auto_catch: bool | None = None
    ball_priority: list[int] | None = None
    auto_potion: bool | None = None
    potion_id: int | None = None
    potion_restock_threshold: int | None = Field(None, ge=0, le=100000)
    potion_restock_qty: int | None = Field(None, ge=1, le=100000)
    auto_ball_restock: bool | None = None
    ball_id: int | None = None
    ball_restock_threshold: int | None = Field(None, ge=0, le=100000)
    ball_restock_qty: int | None = Field(None, ge=1, le=100000)


class LoginWindowIn(BaseModel):
    """Onde está a janela do navegador com o painel (px CSS), para a janela do jogo abrir por cima."""
    cx: float | None = Field(None, ge=-20000, le=20000)
    cy: float | None = Field(None, ge=-20000, le=20000)
    dpr: float | None = Field(None, ge=0.5, le=4)


class ImportIn(BaseModel):
    login_id: str | None = None        # sessão lida pela janela de login (fica só no servidor)
    text: str | None = None            # o que o bookmarklet/snippet copiou (ou o JSON do hello)
    nick: str | None = None            # alternativa: campos soltos
    token: str | None = None
    device_id: str | None = None
    proxy: ProxyIn | None = None
    options: OptionsIn | None = None
    skip_test: bool = False            # salvar sem conectar para testar


class AccountPatch(BaseModel):
    nick: str | None = Field(None, min_length=1, max_length=64)
    token: str | None = None
    device_id: str | None = None
    enabled: bool | None = None
    proxy: ProxyIn | None = None       # enviar null remove o proxy
    options: OptionsIn | None = None


class ProxyTestIn(BaseModel):
    proxy: ProxyIn
    account_id: int | None = None      # p/ reaproveitar a senha salva se password=None


class SettingsIn(BaseModel):
    ws_url: str | None = Field(None, max_length=300)
    discord_webhook: str | None = Field(None, max_length=300)  # None = manter; "" = limpar
    report_hour: int | None = Field(None, ge=0, le=23)
    report_tz: str | None = Field(None, max_length=64)
    public_url: str | None = Field(None, max_length=300)
    alert_sell: bool | None = None
    alert_sell_pct: int | None = Field(None, ge=5, le=500)
    alert_sold: bool | None = None
    external_login_wait_min: int | None = Field(None, ge=1, le=1440)   # espera após login em outro lugar


# ----------------------------------------------------------------- parser da importação
def parse_import(text: str) -> dict:
    """Extrai nick/token/dispositivo do texto colado. Aceita o JSON do bookmarklet, o frame
    `hello` do WebSocket, ou um objeto com a chave `sessao` (como no localStorage do jogo)."""
    t = (text or "").strip()
    if not t:
        raise ValueError("Cole os dados copiados do jogo.")
    obj = None
    try:
        obj = json.loads(t)
    except ValueError:
        a, b = t.find("{"), t.rfind("}")
        if a >= 0 and b > a:
            try:
                obj = json.loads(t[a:b + 1])
            except ValueError:
                obj = None
    if not isinstance(obj, dict):
        raise ValueError("Formato não reconhecido. Use o botão do painel (bookmarklet) ou cole o JSON do hello.")
    src = dict(obj)
    sess = obj.get("sessao")
    if isinstance(sess, str):
        try:
            sess = json.loads(sess)
        except ValueError:
            sess = None
    if isinstance(sess, dict):
        src.update(sess)
    device = (src.get("dispositivo") or src.get("device_id") or src.get("deviceId")
              or obj.get("id-dispositivo") or "")
    return {"nick": str(src.get("nick") or "").strip(), "token": str(src.get("token") or "").strip(),
            "device_id": str(device).strip()}


def _validate_creds(nick: str, token: str, device_id: str) -> str | None:
    if not nick or len(nick) > 64:
        return "Faltou o nick da conta."
    if not token or not TOKEN_RE.match(token):
        return "Faltou o token (ou ele está em formato inválido)."
    if device_id and not DEVICE_ID_RE.match(device_id):
        return "O ID do dispositivo tem formato inválido (use letras, números e hífen, 8 a 64 caracteres)."
    return None


def _proxy_dict(p: ProxyIn | None, keep_password: str = "") -> dict | None:
    if p is None:
        return None
    scheme = p.scheme.strip().lower()
    if scheme not in config.VALID_SCHEMES:
        raise ValueError(f"Esquema de proxy inválido: {scheme} (use {', '.join(sorted(config.VALID_SCHEMES))})")
    return {"scheme": scheme, "host": p.host.strip(), "port": p.port, "username": p.username,
            "password": keep_password if p.password is None else p.password}


def _options_dict(o: OptionsIn | None) -> dict:
    if o is None:
        return {}
    d = o.model_dump(exclude_unset=True)
    if "hunt_slug" in d and d["hunt_slug"] is None:
        d["hunt_slug"] = ""
    return d


# ----------------------------------------------------------------- rotas
def register_admin_routes(app: FastAPI, manager: "AccountManager", store: Store, auth: Auth) -> None:
    def guard(request: Request, tok: str | None) -> JSONResponse | None:
        return auth.guard(request, tok)

    def _public(row: dict) -> dict:
        conn = manager.get(row["id"])
        p = row["proxy"]
        return {
            "id": f"acc{row['id']}", "numericId": row["id"], "nick": row["nick"],
            "tokenHint": mask(row["token"]), "deviceHint": mask(row["device_id"]),
            "enabled": row["enabled"],
            "proxy": {"scheme": p["scheme"], "host": p["host"], "port": p["port"],
                      "username": p["username"], "hasPassword": bool(p["password"])} if p else None,
            "options": {**config.OPTION_DEFAULTS, **row["options"]},
            "tokenStatus": row["token_status"], "tokenDetail": row["token_detail"],
            "state": conn.state.value if conn else ("STOPPED" if not row["enabled"] else "STARTING"),
            "lastReason": conn.last_reason if conn else "",
            "blocked": conn.block if conn else None,
        }

    def _warnings(creds: dict, proxy: dict | None, ignore_id: int | None = None) -> list[str]:
        out: list[str] = []
        others = [r for r in store.list_accounts() if r["id"] != ignore_id]
        if proxy and any(r["proxy"] and (r["proxy"]["host"], r["proxy"]["port"]) == (proxy["host"], proxy["port"])
                         for r in others):
            out.append("Outra conta usa o mesmo proxy. Confirme que o plano do proxy permite conexões simultâneas.")
        if not proxy:
            out.append("Conta sem proxy: ela vai conectar pelo IP desta máquina.")
        if len(others) >= 1 and any(r["device_id"] == creds["device_id"] for r in others):
            out.append("Outra conta usa o mesmo ID de dispositivo. Os termos do jogo permitem até 4 contas por "
                       "dispositivo e por rede.")
        return out

    @app.get("/api/accounts")
    async def list_accounts(request: Request, tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        return {"max": config.MAX_ACCOUNTS, "accounts": [_public(r) for r in store.list_accounts()]}

    # --- login pela janela do jogo: a sessão lida fica aqui e só um código (login_id) vai ao painel
    pending_logins: dict[str, tuple[dict, float]] = {}
    login_lock = asyncio.Lock()

    def _is_local(request: Request) -> bool:
        return bool(request.client) and request.client.host in LOOPBACK_CLIENTS

    @app.get("/api/login-window")
    async def login_window_status(request: Request, tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        return {"available": _is_local(request) and login_window.available()}

    def _store_login(found: dict) -> str:
        now = time.monotonic()
        for k in [k for k, (_, exp) in pending_logins.items() if exp < now]:
            pending_logins.pop(k, None)
        login_id = secrets.token_urlsafe(16)
        pending_logins[login_id] = (found, now + LOGIN_TTL_S)
        return login_id

    @app.post("/api/login-window")
    async def login_window_open(request: Request, body: LoginWindowIn | None = None,
                                tok: str | None = Query(None, alias="token")):
        """Abre o login do jogo neste computador; devolve o nick e um código para cadastrar."""
        if (r := guard(request, tok)):
            return r
        if not _is_local(request):
            return JSONResponse({"error": "A janela de login só abre no computador onde o bot roda."}, status_code=400)
        if login_lock.locked():
            return JSONResponse({"error": "Já existe uma janela de login aberta."}, status_code=409)
        async with login_lock:
            try:
                center = (body.cx, body.cy, body.dpr or 1.0) if body and body.cx is not None and body.cy is not None else None
                found = await login_window.run(center=center)
            except login_window.LoginError as e:
                msg = {"closed": "A janela foi fechada antes de entrar na conta.",
                       "timeout": "Tempo esgotado. Abra a janela e entre na conta de novo.",
                       "unavailable": "O navegador embutido não está disponível neste computador."}.get(e.reason, "Falha no login.")
                return JSONResponse({"error": msg, "reason": e.reason}, status_code=409 if e.reason == "closed" else 400)
        return {"ok": True, "nick": found["nick"], "loginId": _store_login(found)}

    @app.post("/api/accounts/import")
    async def import_account(body: ImportIn, request: Request, tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        try:
            if body.login_id:
                got = pending_logins.get(body.login_id)
                if not got or got[1] < time.monotonic():
                    raise ValueError("O login expirou. Abra a janela do jogo e entre na conta de novo.")
                creds = {"nick": got[0]["nick"], "token": got[0]["token"], "device_id": got[0]["dispositivo"]}
            elif body.text:
                creds = parse_import(body.text)
            else:
                creds = {"nick": (body.nick or "").strip(), "token": (body.token or "").strip(),
                         "device_id": (body.device_id or "").strip()}
            err = _validate_creds(creds["nick"], creds["token"], creds["device_id"])
            if err:
                return JSONResponse({"error": err}, status_code=400)
            proxy = _proxy_dict(body.proxy)
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        generated_device = not creds["device_id"]
        if generated_device:
            creds["device_id"] = new_device_id()
        if store.count_accounts() >= config.MAX_ACCOUNTS:
            return JSONResponse({"error": f"Limite de {config.MAX_ACCOUNTS} contas atingido. "
                                          "Remova uma conta antes de adicionar outra."}, status_code=409)
        for r in store.list_accounts():
            if r["token"] == creds["token"] or r["nick"].lower() == creds["nick"].lower():
                return JSONResponse({"error": f"A conta {r['nick']} já está cadastrada."}, status_code=409)
        data = {**creds, "proxy": proxy, "options": _options_dict(body.options), "enabled": True}
        test = None
        if not body.skip_test:
            probe_cfg = build_account_config({**data, "id": 0})
            test = await probe_account(probe_cfg, manager.settings().ws_url)
            if not test["ok"]:
                return {"ok": False, "stage": "test", "test": test}
            if test.get("nick"):
                data["nick"] = test["nick"]  # o jogo é a fonte da verdade (maiúsculas etc.)
        acc_id = manager.add(data)
        pending_logins.pop(body.login_id or "", None)
        return {"ok": True, "account": _public(store.get_account(acc_id)), "test": test,
                "generatedDevice": generated_device, "warnings": _warnings(creds, proxy, acc_id)}

    @app.patch("/api/accounts/{acc_id}")
    async def patch_account(acc_id: int, body: AccountPatch, request: Request,
                            tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        row = store.get_account(acc_id)
        if row is None:
            return JSONResponse({"error": "conta não encontrada"}, status_code=404)
        changes: dict = {}
        sent = body.model_fields_set
        try:
            if "nick" in sent and body.nick is not None:
                changes["nick"] = body.nick.strip()
            if "token" in sent and body.token:
                if not TOKEN_RE.match(body.token.strip()):
                    return JSONResponse({"error": "Token em formato inválido."}, status_code=400)
                changes["token"] = body.token.strip()
            if "device_id" in sent and body.device_id:
                if not DEVICE_ID_RE.match(body.device_id.strip()):
                    return JSONResponse({"error": "ID do dispositivo com formato inválido."}, status_code=400)
                changes["device_id"] = body.device_id.strip()
            if "enabled" in sent and body.enabled is not None:
                changes["enabled"] = body.enabled
            if "proxy" in sent:
                keep = row["proxy"]["password"] if row["proxy"] else ""
                changes["proxy"] = _proxy_dict(body.proxy, keep)
            if "options" in sent:
                changes["options"] = _options_dict(body.options)
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        await manager.update(acc_id, changes)
        return {"ok": True, "account": _public(store.get_account(acc_id))}

    @app.delete("/api/accounts/{acc_id}")
    async def delete_account(acc_id: int, request: Request, tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        if not await manager.remove(acc_id):
            return JSONResponse({"error": "conta não encontrada"}, status_code=404)
        return {"ok": True}

    @app.post("/api/accounts/{acc_id}/restart")
    async def restart_account(acc_id: int, request: Request, tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        if not await manager.restart(acc_id):
            return JSONResponse({"error": "conta não encontrada"}, status_code=404)
        return {"ok": True, "account": _public(store.get_account(acc_id))}

    @app.post("/api/accounts/{acc_id}/test")
    async def test_account(acc_id: int, request: Request, tok: str | None = Query(None, alias="token")):
        """Conecta de verdade com o token. Em conta ligada, não testa (derrubaria o próprio bot):
        devolve o estado atual."""
        if (r := guard(request, tok)):
            return r
        row = store.get_account(acc_id)
        if row is None:
            return JSONResponse({"error": "conta não encontrada"}, status_code=404)
        conn = manager.get(acc_id)
        if conn is not None:
            ok = conn.state == State.ONLINE
            return {"ok": ok, "kind": "running", "detail": "Conta em execução: " + (
                "online." if ok else (conn.last_reason or conn.state.value)), "live": True}
        res = await probe_account(build_account_config(row), manager.settings().ws_url)
        store.set_token_status(acc_id, "ok" if res["ok"] else res["kind"], res.get("detail", ""))
        return res

    @app.post("/api/proxy/test")
    async def test_proxy(body: ProxyTestIn, request: Request, tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        keep = ""
        if body.account_id is not None and (row := store.get_account(body.account_id)) and row["proxy"]:
            keep = row["proxy"]["password"]
        try:
            pd = _proxy_dict(body.proxy, keep)
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        cfg = ProxyConfig(pd["scheme"], pd["host"], pd["port"], pd["username"], pd["password"])
        try:
            ip = await probe_exit_ip(cfg)
        except Exception as e:  # noqa: BLE001 - mostra só o tipo, nunca credenciais
            return {"ok": False, "detail": f"Falha ao usar o proxy ({type(e).__name__})"}
        return {"ok": True, "ip": ip}

    # ---------------------------------------------------------- configurações globais
    def _settings_public() -> dict:
        s = store.all_settings()
        hook = s.pop("discord_webhook")
        return {**s, "report_hour": int(s["report_hour"] or 0), "hasWebhook": bool(hook),
                "alert_sell": s["alert_sell"] == "1", "alert_sold": s["alert_sold"] == "1",
                "alert_sell_pct": int(s["alert_sell_pct"] or 30),
                "external_login_wait_min": int(s["external_login_wait_min"] or 5),
                "webhookHint": mask(hook, 6), "defaultWsUrl": config.DEFAULT_WS_URL}

    @app.get("/api/settings")
    async def get_settings(request: Request, tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        return _settings_public()

    @app.put("/api/settings")
    async def put_settings(body: SettingsIn, request: Request, tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        sent = body.model_fields_set
        if "ws_url" in sent and body.ws_url is not None:
            v = body.ws_url.strip() or config.DEFAULT_WS_URL
            if not v.startswith(("ws://", "wss://")):
                return JSONResponse({"error": "A URL do WebSocket deve começar com ws:// ou wss://"},
                                    status_code=400)
            store.set_setting("ws_url", v)
        if "discord_webhook" in sent and body.discord_webhook is not None:
            v = body.discord_webhook.strip()
            if v and not DISCORD_WEBHOOK_RE.match(v):
                return JSONResponse({"error": "O webhook deve ser uma URL do Discord "
                                              "(https://discord.com/api/webhooks/...)."}, status_code=400)
            store.set_setting("discord_webhook", v)
        if "report_hour" in sent and body.report_hour is not None:
            store.set_setting("report_hour", str(body.report_hour))
        if "report_tz" in sent and body.report_tz is not None:
            v = body.report_tz.strip() or "America/Sao_Paulo"
            try:
                from zoneinfo import ZoneInfo
                ZoneInfo(v)
            except Exception:  # noqa: BLE001
                return JSONResponse({"error": f"Fuso horário desconhecido: {v}"}, status_code=400)
            store.set_setting("report_tz", v)
        if "public_url" in sent and body.public_url is not None:
            v = body.public_url.strip().rstrip("/")
            if v and not v.startswith(("http://", "https://")):
                return JSONResponse({"error": "A URL pública deve começar com http:// ou https://"},
                                    status_code=400)
            store.set_setting("public_url", v)
        if "alert_sell" in sent and body.alert_sell is not None:
            store.set_setting("alert_sell", "1" if body.alert_sell else "0")
        if "alert_sold" in sent and body.alert_sold is not None:
            store.set_setting("alert_sold", "1" if body.alert_sold else "0")
        if "external_login_wait_min" in sent and body.external_login_wait_min is not None:
            store.set_setting("external_login_wait_min", str(body.external_login_wait_min))
        if "alert_sell_pct" in sent and body.alert_sell_pct is not None:
            store.set_setting("alert_sell_pct", str(body.alert_sell_pct))
        await manager.apply_global_settings()
        return _settings_public()

    @app.post("/api/settings/test-webhook")
    async def test_webhook(request: Request, tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        if not manager.notifier.enabled:
            return JSONResponse({"error": "Nenhum webhook configurado."}, status_code=400)
        manager.notifier.send("Teste do painel", "Webhook configurado com sucesso. ✅", BLUE)
        return {"ok": True}
