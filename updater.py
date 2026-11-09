"""Atualização do projeto pelo painel.

- Consulta a última Release do GitHub (sozinho a cada hora e quando o usuário pede).
- Só OFERECE a atualização: quem decide e clica é o usuário, no painel.
- Aplicar = baixar o dashboard pronto da Release, `git merge --ff-only` na tag, instalar
  dependências e reiniciar. Só funciona em instalações feitas com `git clone`; nas demais o painel
  mostra o link da Release.

Segurança: só olha o repositório fixo abaixo, só aceita tags `vX.Y.Z`, só baixa o zip do próprio
repositório (HTTPS) e nunca executa nada baixado: o código novo vem do `git merge` da tag.
`UPDATE_CHECK=0` desliga tudo. Os dados (data/, .env) estão no .gitignore e não são tocados.
"""
from __future__ import annotations

import asyncio
import importlib.util
import logging
import os
import re
import shutil
import sys
import time
from typing import Any

import aiohttp
from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse

from version import VERSION

log = logging.getLogger("updater")

REPO = "DiuleJR/pokeidle-manager-online"
API_URL = f"https://api.github.com/repos/{REPO}/releases/latest"
ASSET_NAME = "web_dist.zip"
ASSET_PREFIX = f"https://github.com/{REPO}/releases/download/"
TAG_RE = re.compile(r"^v(\d+)\.(\d+)\.(\d+)$")
ROOT = os.path.dirname(os.path.abspath(__file__))
CHECK_EVERY_S = 3600
RESTART_CODE = 75           # o iniciar.bat / iniciar.sh / systemd sobem o bot de novo com este código
MAX_ZIP_BYTES = 30 * 1024 * 1024
NOTES_MAX = 4000


def parse_version(s: str) -> tuple[int, int, int] | None:
    m = TAG_RE.match(s.strip()) or re.match(r"^(\d+)\.(\d+)\.(\d+)$", s.strip())
    return (int(m[1]), int(m[2]), int(m[3])) if m else None


def _load_get_dashboard():
    spec = importlib.util.spec_from_file_location("get_dashboard", os.path.join(ROOT, "scripts", "get_dashboard.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class UpdateError(Exception):
    """Falha esperada, com mensagem pronta para mostrar ao usuário."""


class Updater:
    def __init__(self, root: str = ROOT, current: str = VERSION) -> None:
        self.root = root
        self.current = current
        self.enabled = os.getenv("UPDATE_CHECK", "1") != "0"
        self.supervised = os.getenv("POKEIDLE_SUPERVISED") == "1"
        self._etag: str | None = None
        self._lock = asyncio.Lock()
        self.latest: str | None = None
        self.notes = ""
        self.url = ""
        self.asset_url = ""
        self.checked_at: float | None = None
        self.error = ""
        self.step = ""          # o que a atualização está fazendo agora (vazio = nada)
        self.done_msg = ""

    # ------------------------------------------------------------------ estado
    @property
    def available(self) -> bool:
        a, b = parse_version(self.latest or ""), parse_version(self.current)
        return bool(a and b and a > b and self.asset_url)

    def git_reason(self) -> str:
        """Vazio se esta instalação pode se atualizar sozinha; senão, o motivo."""
        if not os.path.isdir(os.path.join(self.root, ".git")):
            return "Esta instalação não foi feita com git clone. Baixe a versão nova pela página da Release."
        if not shutil.which("git"):
            return "O Git não foi encontrado nesta máquina."
        return ""

    def public(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled, "current": self.current, "latest": self.latest,
            "available": self.available, "notes": self.notes, "url": self.url,
            "checkedAt": self.checked_at, "error": self.error,
            "canApply": not self.git_reason(), "cannotApplyReason": self.git_reason(),
            "supervised": self.supervised, "step": self.step, "doneMessage": self.done_msg,
        }

    # ------------------------------------------------------------------ consulta
    async def check(self) -> dict[str, Any]:
        """Consulta o GitHub. Nunca levanta: erros ficam em `error`."""
        if not self.enabled:
            return self.public()
        headers = {"Accept": "application/vnd.github+json", "User-Agent": f"pokeidle-manager/{self.current}"}
        if self._etag:
            headers["If-None-Match"] = self._etag
        try:
            timeout = aiohttp.ClientTimeout(total=15)
            async with aiohttp.ClientSession(timeout=timeout) as s, s.get(API_URL, headers=headers) as r:
                if r.status == 304:
                    self.error = ""
                elif r.status == 404:
                    raise UpdateError("Nenhuma Release publicada ainda.")
                elif r.status != 200:
                    raise UpdateError(f"O GitHub respondeu {r.status}. Tente de novo mais tarde.")
                else:
                    self._etag = r.headers.get("ETag")
                    self._read_release(await r.json())
                    self.error = ""
        except UpdateError as e:
            self.error = str(e)
        except Exception as e:  # noqa: BLE001 - rede fora do ar etc.: só avisa, nunca derruba o bot
            self.error = f"Não consegui consultar o GitHub ({type(e).__name__})."
        self.checked_at = time.time()
        return self.public()

    def _read_release(self, data: dict) -> None:
        tag = str(data.get("tag_name") or "")
        if not TAG_RE.match(tag):
            raise UpdateError("A última Release tem um nome de versão inesperado.")
        asset = next((a for a in data.get("assets") or [] if a.get("name") == ASSET_NAME), None)
        url = str((asset or {}).get("browser_download_url") or "")
        self.latest = tag[1:]
        self.notes = str(data.get("body") or "").strip()[:NOTES_MAX]
        self.url = str(data.get("html_url") or "")
        # Sem o zip do dashboard a Release ainda está sendo preparada pelo workflow: não oferece.
        self.asset_url = url if url.startswith(ASSET_PREFIX) else ""

    async def run(self) -> None:
        """Checagem em segundo plano: 20 s depois de iniciar e depois a cada hora."""
        if not self.enabled:
            log.info("Verificação de atualizações desligada (UPDATE_CHECK=0).")
            return
        await asyncio.sleep(20)
        while True:
            await self.check()
            if self.available:
                log.info("Versão nova disponível: %s (atual %s).", self.latest, self.current)
            await asyncio.sleep(CHECK_EVERY_S)

    # ------------------------------------------------------------------ aplicar
    async def _git(self, *args: str, timeout: float = 120) -> str:
        env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
        return await self._exec(["git", *args], timeout, env)

    async def _exec(self, cmd: list[str], timeout: float, env: dict | None = None) -> str:
        proc = await asyncio.create_subprocess_exec(
            *cmd, cwd=self.root, env=env, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), timeout)
        except asyncio.TimeoutError:
            proc.kill()
            raise UpdateError(f"Demorou demais: {' '.join(cmd[:3])}") from None
        text = out.decode("utf-8", "replace").strip()
        if proc.returncode != 0:
            raise UpdateError(f"Falhou ({' '.join(cmd[:3])}): {text[-300:]}")
        return text

    async def _download_dashboard(self) -> bytes:
        if not self.asset_url.startswith(ASSET_PREFIX):
            raise UpdateError("Endereço do dashboard inválido.")
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=120)) as s, \
                s.get(self.asset_url, headers={"User-Agent": f"pokeidle-manager/{self.current}"}) as r:
            if r.status != 200:
                raise UpdateError(f"Não consegui baixar o dashboard (HTTP {r.status}).")
            chunks: list[bytes] = []
            size = 0
            async for chunk in r.content.iter_chunked(64 * 1024):  # read(n) devolve só o 1º pedaço
                size += len(chunk)
                if size > MAX_ZIP_BYTES:
                    raise UpdateError("O arquivo do dashboard é grande demais.")
                chunks.append(chunk)
        return b"".join(chunks)

    async def apply(self) -> dict[str, Any]:
        """Aplica a versão nova. Levanta UpdateError com a mensagem para o usuário."""
        if self._lock.locked():
            raise UpdateError("Já há uma atualização em andamento.")
        async with self._lock:
            self.done_msg = ""
            try:
                return await self._apply()
            finally:
                self.step = ""

    async def _apply(self) -> dict[str, Any]:
        if not self.enabled:
            raise UpdateError("A atualização está desligada (UPDATE_CHECK=0).")
        if (why := self.git_reason()):
            raise UpdateError(why)
        if not self.available:
            raise UpdateError("Não há versão nova para instalar. Clique em Verificar atualização.")
        tag = f"v{self.latest}"
        if not TAG_RE.match(tag):
            raise UpdateError("Versão inválida.")
        if await self._git("status", "--porcelain", "--untracked-files=no"):
            raise UpdateError("Há arquivos do projeto modificados nesta pasta. Salve ou desfaça as mudanças "
                              "(git status) antes de atualizar.")

        self.step = "Baixando o dashboard novo…"
        zip_bytes = await self._download_dashboard()

        self.step = "Baixando o código novo…"
        old_head = await self._git("rev-parse", "HEAD")
        await self._git("fetch", "--force", "--tags", "origin")
        try:
            await self._git("merge", "--ff-only", f"refs/tags/{tag}")
        except UpdateError as e:
            raise UpdateError(f"Não consegui aplicar a versão {self.latest} sobre esta cópia do projeto "
                              f"(ela tem commits próprios?). {e}") from None

        try:
            self.step = "Instalando dependências…"
            await self._exec([sys.executable, "-m", "pip", "install", "-q", "-r", "requirements.txt"], 600)
            self.step = "Instalando o dashboard…"
            _load_get_dashboard().install(zip_bytes, os.path.join(self.root, "web_dist"))
        except Exception as e:  # noqa: BLE001 - desfaz: nunca deixa o projeto pela metade
            await self._git("reset", "--hard", old_head)
            raise UpdateError(f"A atualização falhou e foi desfeita. {e}") from None

        log.info("Atualizado de %s para %s.", self.current, self.latest)
        if self.supervised:
            self.done_msg = f"Atualizado para a versão {self.latest}. Reiniciando…"
            self._schedule_restart()
            return {"ok": True, "restarting": True, "message": self.done_msg}
        self.done_msg = (f"Atualizado para a versão {self.latest}. Feche e abra o bot de novo "
                         "(iniciar.bat / iniciar.sh) para usar a versão nova.")
        return {"ok": True, "restarting": False, "message": self.done_msg}

    def _schedule_restart(self) -> None:
        def _exit() -> None:
            log.warning("Reiniciando para usar a versão nova…")
            logging.shutdown()
            os._exit(RESTART_CODE)

        asyncio.get_running_loop().call_later(2.0, _exit)


# ----------------------------------------------------------------- rotas
def register_update_routes(app: FastAPI, updater: Updater, auth) -> None:
    @app.get("/api/update")
    async def update_state(request: Request, tok: str | None = Query(None, alias="token")):
        if (r := auth.guard(request, tok)):
            return r
        return updater.public()

    @app.post("/api/update/check")
    async def update_check(request: Request, tok: str | None = Query(None, alias="token")):
        if (r := auth.guard(request, tok)):
            return r
        return await updater.check()

    @app.post("/api/update/apply")
    async def update_apply(request: Request, tok: str | None = Query(None, alias="token")):
        if (r := auth.guard(request, tok)):
            return r
        try:
            return await updater.apply()
        except UpdateError as e:
            return JSONResponse({"error": str(e)}, status_code=409)
