"""Rotas do chat e da comunidade (Discord) do painel.

    GET  /api/chat?canal=mundo     histórico do canal (até 200 mensagens)
    POST /api/chat/send            envia por uma conta: {account, canal, texto}
    WS   /ws/chat                  tempo real: init, chat, history, del, notice
    GET  /api/community            Discord: online e membros (lidos do convite, cache de 5 min)
"""
from __future__ import annotations

import asyncio
import json
import time
from typing import TYPE_CHECKING

from fastapi import FastAPI, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from chat import CHANNELS, MAX_LEN, MIN_LEVEL, SEND_GAP_S, ChatError

if TYPE_CHECKING:
    from auth import Auth
    from manager import AccountManager

DISCORD_INVITE = "pFVashEjtH"          # convite permanente do servidor
DISCORD_URL = f"https://discord.gg/{DISCORD_INVITE}"
COMMUNITY_TTL_S = 300
PING_S = 25


class ChatSendIn(BaseModel):
    account: int
    canal: str
    texto: str = Field(max_length=2000)


def register_chat_routes(app: FastAPI, manager: "AccountManager", auth: "Auth") -> None:
    hub = manager.chat
    community: dict = {}

    @app.get("/api/chat")
    async def chat_history(request: Request, tok: str | None = Query(None, alias="token"), canal: str = "mundo"):
        if (denied := auth.read_guard(request, tok)):
            return denied
        if canal not in CHANNELS:
            return JSONResponse({"error": "Canal inválido."}, status_code=400)
        return {"canal": canal, "channels": list(CHANNELS), "limits": {"maxLen": MAX_LEN, "minLevel": MIN_LEVEL, "gapS": SEND_GAP_S},
                "messages": hub.messages(canal)}

    @app.post("/api/chat/send")
    async def chat_send(body: ChatSendIn, request: Request, tok: str | None = Query(None, alias="token")):
        if (denied := auth.guard(request, tok)):  # ação em nome de uma conta: exige login
            return denied
        conn = manager.get(body.account)
        if conn is None:
            return JSONResponse({"error": "Conta não encontrada ou desligada.", "code": "account"}, status_code=404)
        try:
            await hub.send(conn, body.canal, body.texto)
        except ChatError as e:
            return JSONResponse({"error": e.text, "code": e.code, "wait": round(e.wait, 1)}, status_code=e.status)
        except RuntimeError as e:
            return JSONResponse({"error": str(e), "code": "offline"}, status_code=409)
        return {"ok": True}

    @app.websocket("/ws/chat")
    async def chat_ws(ws: WebSocket, tok: str | None = Query(None, alias="token")):
        from telemetry import _ws_origin_ok

        if not _ws_origin_ok(ws) or (auth.required() and not auth.check_ws(ws)):
            await ws.close(code=4401)
            return
        await ws.accept()
        q = hub.subscribe()
        try:
            await ws.send_text(json.dumps({"type": "init", "messages": {c: hub.messages(c) for c in CHANNELS}}))
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=PING_S)
                except asyncio.TimeoutError:
                    event = {"type": "ping"}
                await ws.send_text(json.dumps(event))
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            hub.unsubscribe(q)

    @app.get("/api/community")
    async def community_info(request: Request, tok: str | None = Query(None, alias="token")):
        """Contagem do Discord lida do convite (o widget do servidor está desligado). Falha = sem números, link intacto."""
        if (denied := auth.read_guard(request, tok)):
            return denied
        if community.get("exp", 0) < time.time():
            data = {"url": DISCORD_URL, "name": None, "online": None, "members": None}
            try:
                import aiohttp

                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as s:
                    async with s.get(f"https://discord.com/api/v10/invites/{DISCORD_INVITE}?with_counts=true") as r:
                        if r.status == 200:
                            j = json.loads(await r.text())
                            data.update(name=(j.get("guild") or {}).get("name"),
                                        online=j.get("approximate_presence_count"),
                                        members=j.get("approximate_member_count"))
            except Exception:                 # rede fora, JSON estranho...: o card segue só com o link
                pass
            ok = data["online"] is not None
            community.update(exp=time.time() + (COMMUNITY_TTL_S if ok else 60), data=data)
        return JSONResponse(community["data"], headers={"Cache-Control": "max-age=60"})
