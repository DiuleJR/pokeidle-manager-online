"""Rotas do PVP ranqueado do painel.

    GET  /api/pvp                       resumo de cada conta: rank, time, fila, partidas da sessão, histórico
    GET  /api/pvp/ladder?pagina=1       tabela do jogo (Top 1.000), compartilhada entre as contas
    POST /api/pvp/{conta}/queue         {action: "enter" | "leave"} entra/sai da fila agora
    POST /api/pvp/{conta}/auto          {on: bool} liga/desliga a fila automática da conta
    POST /api/pvp/auto                  {on: bool} liga/desliga em todas as contas habilitadas
"""
from __future__ import annotations

import time
from dataclasses import replace
from typing import TYPE_CHECKING, Literal

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from sprite_outfit import look_of

if TYPE_CHECKING:
    from auth import Auth
    from connection import AccountConnection
    from manager import AccountManager
    from store import Store

REASONS = {
    "offline": "Conta offline.",
    "level": "Nível mínimo do PVP não atingido.",
    "team": "Monte a equipe de PVP no jogo antes de entrar na fila.",
}


class QueueIn(BaseModel):
    action: Literal["enter", "leave"]


class AutoIn(BaseModel):
    on: bool


def _team_rows(c: "AccountConnection") -> list[dict]:
    mine = {p.get("id"): p for p in (c.estado.get("pokemons") or []) if isinstance(p, dict)}
    rows = []
    for pid in c.pvp.team:
        p = mine.get(pid)
        if p is None:
            rows.append({"id": pid, "missing": True})
            continue
        rows.append({"id": pid, "name": p.get("nome"), "level": p.get("level"), "looktype": look_of(p),
                     "shiny": bool(p.get("shiny")), "types": p.get("tipos") or [], "power": p.get("poder")})
    return rows


def _rank(r: dict | None) -> dict | None:
    if not isinstance(r, dict):
        return None
    keys = ("pontos", "pico", "vitorias", "derrotas", "partidas", "sequencia", "escudo", "tierId", "divisao",
            "divisaoNum", "de", "ate", "progresso", "naFaixa", "larguraFaixa", "posicao", "aguardandoVaga",
            "vagaDecaiu", "faltamPosicoes", "decaiEm")
    return {k: r[k] for k in keys if k in r}


def account_pvp(c: "AccountConnection") -> dict:
    pv = c.pvp
    est = c.estado
    level = int(est.get("level") or 0)
    now = est.get("servidorAgora") or 0
    online = c.can_send
    blocker = pv.blocker(level) if online else "offline"
    q = pv.queue
    return {
        "id": c.acc.index,
        "nick": c.acc.nick,
        "level": level,
        "online": online,
        "vip": ((est.get("loja") or {}).get("vipAte", 0) or 0) > now,
        "auto": pv.auto,
        "nativeAuto": pv.native_auto,
        "levelMin": pv.level_min,
        "blocker": blocker,
        "blockerText": REASONS.get(blocker) if blocker else None,
        "rank": _rank(pv.rank),
        "position": pv.position,
        "totalRanked": pv.total_ranked,
        "team": _team_rows(c),
        "queue": {"on": bool(q.get("na")), "since": q.get("desde") or 0, "size": q.get("tamanho") or 0,
                  "waitMs": pv.wait_ms()},
        "refusal": pv.refusal,
        "session": {"wins": pv.wins, "losses": pv.losses, "delta": pv.delta, "matches": pv.matches},
        "history": [{"id": h.get("id"), "won": bool(h.get("venci")), "delta": h.get("delta"),
                     "opponent": h.get("oponente") if isinstance(h.get("oponente"), str) else (h.get("oponente") or {}).get("nick"),
                     "at": h.get("criadoEm")} for h in pv.history],
    }


def register_pvp_routes(app: FastAPI, manager: "AccountManager", store: "Store", auth: "Auth") -> None:
    ladder = manager.pvp_ladder

    def _set_auto(c: "AccountConnection", on: bool) -> None:
        c.pvp.auto = on
        c.acc = replace(c.acc, pvp_auto=on)
        store.update_account(c.acc.index, {"options": {"pvp_auto": on}})   # sem reiniciar a conexão

    @app.get("/api/pvp")
    async def pvp_overview(request: Request, tok: str | None = Query(None, alias="token")):
        if (denied := auth.read_guard(request, tok)):
            return denied
        return {"ts": int(time.time() * 1000), "accounts": [account_pvp(c) for c in manager.connections()]}

    @app.get("/api/pvp/ladder")
    async def pvp_ladder(request: Request, tok: str | None = Query(None, alias="token"), pagina: int = 1):
        if (denied := auth.read_guard(request, tok)):
            return denied
        hit = ladder.cached(max(1, min(10, pagina)))
        if hit:
            return hit
        conn = next((c for c in manager.connections() if c.can_send), None)
        if conn is None:
            return JSONResponse({"error": "Nenhuma conta online para consultar a tabela."}, status_code=409)
        data = await ladder.get(pagina, conn)
        if data is None:
            return JSONResponse({"error": "O jogo não respondeu a tabela. Tente de novo."}, status_code=504)
        return data

    @app.post("/api/pvp/auto")
    async def pvp_auto_all(body: AutoIn, request: Request, tok: str | None = Query(None, alias="token")):
        if (denied := auth.guard(request, tok)):
            return denied
        n = 0
        for c in manager.connections():
            _set_auto(c, body.on)
            n += 1
        return {"ok": True, "accounts": n}

    @app.post("/api/pvp/{acc_id}/auto")
    async def pvp_auto(acc_id: int, body: AutoIn, request: Request, tok: str | None = Query(None, alias="token")):
        if (denied := auth.guard(request, tok)):
            return denied
        c = manager.get(acc_id)
        if c is None:
            return JSONResponse({"error": "Conta não encontrada ou desligada."}, status_code=404)
        _set_auto(c, body.on)
        return {"ok": True, "auto": body.on}

    @app.post("/api/pvp/{acc_id}/queue")
    async def pvp_queue(acc_id: int, body: QueueIn, request: Request, tok: str | None = Query(None, alias="token")):
        if (denied := auth.guard(request, tok)):
            return denied
        c = manager.get(acc_id)
        if c is None or not c.can_send:
            return JSONResponse({"error": REASONS["offline"], "code": "offline"}, status_code=409)
        if body.action == "leave":
            await c.pvp.leave()
            return {"ok": True}
        why = await c.pvp.enter(int(c.estado.get("level") or 0))
        if why:
            return JSONResponse({"error": REASONS.get(why, why), "code": why}, status_code=409)
        return {"ok": True}
