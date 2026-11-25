"""Rotas dos Bosses (arenas lendárias) do painel.

    GET  /api/bosses                    catálogo (com o prêmio de hoje/amanhã/depois) + estado de cada conta
    POST /api/bosses/{conta}/enter      {key} entra na arena do boss
    POST /api/bosses/{conta}/leave      abandona a luta
    POST /api/bosses/{conta}/auto       {on, key} liga/desliga o "Repetir automaticamente"
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import replace
from typing import TYPE_CHECKING

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from boss import PREMIOS, REVIVE_ID, TRIOS, next_rotation_ms, prize_for, rotation_day
from item_labels import display_name, item_icon_path, item_name
from sprite_outfit import look_of

if TYPE_CHECKING:
    from auth import Auth
    from connection import AccountConnection
    from manager import AccountManager
    from store import Store

SITE = "https://pokeidle.io"
PT_NAMES = {70011: "Fragmento de Chave", 70012: "Fragmento de Shiny Stone", 70013: "Fragmento de Bicicleta"}
REASONS = {
    "offline": "Conta offline.",
    "unknown": "Esse boss ainda não tem arena.",
    "level": "Nível de treinador insuficiente para este boss.",
    "token": "Faltam fichas de entrada.",
    "busy": "A conta já está em uma luta de boss.",
    "team": "Monte a equipe de hunt no jogo antes de lutar.",
}


class EnterIn(BaseModel):
    key: str


class AutoIn(BaseModel):
    on: bool
    key: str


class ReviveIn(BaseModel):
    on: bool


def _abs(path: str | None) -> str | None:
    if not path:
        return None
    return SITE + (path if path.startswith("/") else f"/assets/{path}")


def _item(c: "AccountConnection", item_id, fallback: str | None = None) -> dict:
    """Nome e ícone de um item (os do servidor, 70xxx, vêm do welcome.itensNossos)."""
    try:
        iid = int(item_id)
    except (TypeError, ValueError):
        return {"itemId": None, "name": display_name(fallback), "icon": None}
    nos = c.itens_nossos.get(iid) or {}
    name = PT_NAMES.get(iid) or nos.get("name") or item_name(iid) or fallback
    icon = nos.get("icon") or item_icon_path(iid)
    return {"itemId": iid, "name": display_name(name), "icon": _abs(icon)}


def _drop(c: "AccountConnection", d: dict) -> dict:
    qty = d.get("qtd")
    chance = d.get("chance")
    return {**_item(c, d.get("itemId"), d.get("nome")),
            "chance": chance if isinstance(chance, (int, float)) else None,
            "qty": [qty[0], qty[1]] if isinstance(qty, list) and len(qty) == 2 else None}


def _drops_for(c: "AccountConnection", ficha: dict | None, prize: str | None) -> list[dict]:
    if not ficha:
        return []
    rows = ((ficha.get("dropsPorPremio") or {}).get(prize) if prize else None) or ficha.get("drops") or []
    return [_drop(c, d) for d in rows if isinstance(d, dict)]


def catalog_view(c: "AccountConnection", now_ms: int) -> list[dict]:
    playable = {b.get("key"): b for b in c.boss_playable}
    out = []
    for b in c.boss_catalog:
        key = b.get("key")
        ficha = playable.get(key)
        pos = b.get("posicao")
        rotates = pos is not None and ficha is not None and bool(ficha.get("dropsPorPremio"))
        days = []
        for day in range(len(PREMIOS)):
            prize = prize_for(pos, rotation_day(now_ms + day * 86_400_000)) if rotates else None
            days.append({"prize": prize, "drops": _drops_for(c, ficha, prize)})
        region = b.get("regiao")
        entry = ficha.get("entrada") if ficha else None
        out.append({
            "key": key, "name": b.get("name"), "level": b.get("level"), "region": region,
            "regionName": str(region or "").capitalize(), "trio": TRIOS.get(region), "position": pos,
            "looktype": b.get("looktype"), "img": b.get("img"), "pokeId": b.get("pokeId"),
            "types": [t for t in ((ficha or {}).get("type1") or b.get("type1"), (ficha or {}).get("type2") or b.get("type2")) if t],
            "playable": ficha is not None,
            "minTrainerLevel": (ficha or {}).get("minNivelTreinador") or b.get("minNivelTreinador") or b.get("level") or 0,
            "teamLevel": (ficha or {}).get("teamLevel"), "idealTeam": (ficha or {}).get("equipeIdeal"),
            "entry": {**_item(c, entry.get("itemId"), entry.get("nome")), "qty": entry.get("qtd") or 1} if isinstance(entry, dict) else None,
            "days": days,
            # sem arena: o jogo só lista os nomes dos drops
            "dropNames": [] if ficha else [str(d) for d in (b.get("drops") or [])],
        })
    return out


def _team(c: "AccountConnection") -> list[dict]:
    mons = [p for p in (c.estado.get("pokemons") or []) if isinstance(p, dict) and p.get("slot") is not None]
    mons.sort(key=lambda p: p.get("slot"))
    return [{"id": p.get("id"), "name": p.get("nome"), "level": p.get("level") or 0, "looktype": look_of(p),
             "shiny": bool(p.get("shiny")), "hp": p.get("hp") or 0, "maxHp": p.get("maxHp") or 0} for p in mons]


def _series_view(c: "AccountConnection", s: dict | None) -> dict | None:
    if not s:
        return None
    rows = [{**_item(c, r.get("itemId"), r.get("name")), "qty": r.get("qty", 0)} for r in s.get("items", {}).values()]
    return {"key": s.get("key"), "name": s.get("name"), "startedAt": s.get("startedAt"), "endedAt": s.get("endedAt"),
            "reason": s.get("reason"), "wins": s.get("wins", 0), "losses": s.get("losses", 0),
            "entries": s.get("entries", 0), "tokens": s.get("tokens", 0), "revives": s.get("revives", 0), "items": rows}


def _run_view(run: dict | None) -> dict | None:
    if not run:
        return None
    return {"key": run.get("key"), "phase": run.get("phase"), "error": run.get("error"),
            "returnSlug": run.get("returnSlug"), "stopping": bool(run.get("stopping")), "finished": bool(run.get("finished")),
            "startedAt": run.get("startedAt")}


def account_view(c: "AccountConnection", item_ids: set[int]) -> dict:
    items = c.estado.get("items") or {}
    bm = c.boss
    bm.settle()
    arena = bm.arena
    return {
        "id": c.acc.index, "nick": c.acc.nick, "level": int(c.estado.get("level") or 0), "online": c.can_send,
        "items": {str(i): int(items.get(str(i), items.get(i, 0)) or 0) for i in item_ids},
        "arena": {"key": arena.get("key"), "name": arena.get("nome") or arena.get("name")} if arena else None,
        "auto": bm.auto, "autoKey": bm.auto_key, "wins": bm.victories(), "team": _team(c),
        "session": {"wins": bm.wins, "losses": bm.losses}, "recent": bm.recent,
        "active": bm.active(), "run": _run_view(bm.run), "hp": bm.hp_view(),
        "series": _series_view(c, bm.series), "summary": _series_view(c, bm.summary),
        "buyRevive": bm.buy_revive, "revives": bm.stock(REVIVE_ID),
        "raid": {k: (bm.raid.get("eu") or {}).get(k) for k in ("inscrito", "equipeIds", "dano", "posicao")} if bm.raid else None,
    }


def raid_view(c: "AccountConnection | None") -> dict | None:
    """O Raid semanal como o servidor manda (edição, horários, Gigantamax, bônus, inscritos), sem os dados da conta."""
    r = c.boss.raid if c else None
    if not r or not isinstance(r.get("edicao"), dict):
        return None
    return {"agora": r.get("agora"), "edicao": r["edicao"], "gigantamax": r.get("gigantamax"), "token": r.get("token"),
            "maxEquipe": r.get("maxEquipe"), "bonus": r.get("bonus"), "inscritos": r.get("inscritos"),
            "hasResult": bool(r.get("resultado")), "offset": c.boss.raid_offset}


def register_boss_routes(app: FastAPI, manager: "AccountManager", store: "Store", auth: "Auth") -> None:
    @app.get("/api/bosses")
    async def bosses(request: Request, tok: str | None = Query(None, alias="token")):
        if (denied := auth.read_guard(request, tok)):
            return denied
        conns = manager.connections()
        now = int(time.time() * 1000)
        src = next((c for c in conns if c.boss_catalog and c.can_send), None) or next((c for c in conns if c.boss_catalog), None)
        catalog = catalog_view(src, now) if src else []
        ids = {d["itemId"] for b in catalog for day in b["days"] for d in day["drops"] if d["itemId"] is not None}
        ids |= {b["entry"]["itemId"] for b in catalog if b["entry"] and b["entry"]["itemId"] is not None}
        for c in conns:                                    # o Raid muda pouco: pede de novo só a cada 5 s
            if c.can_send:
                asyncio.create_task(c.boss.request_raid())
        raid_src = next((c for c in conns if c.boss.raid), None)
        return {"ts": now, "nextRotation": next_rotation_ms(now), "catalog": catalog, "raid": raid_view(raid_src),
                "revive": _item(src, REVIVE_ID) if src else None,
                "accounts": [account_view(c, ids) for c in conns]}

    def _conn(acc_id: int):
        c = manager.get(acc_id)
        if c is None or not c.can_send:
            return None, JSONResponse({"error": REASONS["offline"], "code": "offline"}, status_code=409)
        return c, None

    @app.post("/api/bosses/{acc_id}/enter")
    async def boss_enter(acc_id: int, body: EnterIn, request: Request, tok: str | None = Query(None, alias="token")):
        if (denied := auth.guard(request, tok)):
            return denied
        c, err = _conn(acc_id)
        if err:
            return err
        ficha = next((b for b in c.boss_playable if b.get("key") == body.key), None)
        why = None
        if ficha is None:
            why = "unknown"
        elif c.boss.arena or c.boss.busy:
            why = "busy"
        elif not any(isinstance(p, dict) and p.get("slot") is not None for p in (c.estado.get("pokemons") or [])):
            why = "team"
        else:
            cat = next((b for b in c.boss_catalog if b.get("key") == body.key), {})
            if int(c.estado.get("level") or 0) < int(ficha.get("minNivelTreinador") or cat.get("level") or 0):
                why = "level"
            else:
                e = ficha.get("entrada") or {}
                have = int((c.estado.get("items") or {}).get(str(e.get("itemId")), 0) or 0)
                if have < int(e.get("qtd") or 1):
                    why = "token"
        if why:
            return JSONResponse({"error": REASONS[why], "code": why}, status_code=409)
        c.boss.start(body.key)           # cura no Centro, entra, repete e volta à hunt (ver boss.py)
        return {"ok": True}

    @app.post("/api/bosses/{acc_id}/leave")
    async def boss_leave(acc_id: int, request: Request, tok: str | None = Query(None, alias="token")):
        if (denied := auth.guard(request, tok)):
            return denied
        c, err = _conn(acc_id)
        if err:
            return err
        await c.boss.stop()
        return {"ok": True}

    @app.post("/api/bosses/{acc_id}/auto")
    async def boss_auto(acc_id: int, body: AutoIn, request: Request, tok: str | None = Query(None, alias="token")):
        if (denied := auth.guard(request, tok)):
            return denied
        c, err = _conn(acc_id)
        if err:
            return err
        if not any(b.get("key") == body.key for b in c.boss_playable):
            return JSONResponse({"error": REASONS["unknown"], "code": "unknown"}, status_code=409)
        await c.boss.set_auto(body.on, body.key)
        return {"ok": True}

    @app.post("/api/bosses/{acc_id}/raid/enroll")
    async def raid_enroll(acc_id: int, request: Request, tok: str | None = Query(None, alias="token")):
        """Inscreve a conta no Raid semanal (só enquanto as inscrições estão abertas, com a ficha e sem inscrição)."""
        if (denied := auth.guard(request, tok)):
            return denied
        c, err = _conn(acc_id)
        if err:
            return err
        r = c.boss.raid or {}
        ed = r.get("edicao") or {}
        now = c.boss.raid_now_ms()
        if not (ed.get("inscricoesDe", 0) <= now < ed.get("inscricoesAte", 0)):
            return JSONResponse({"error": "As inscrições do Raid não estão abertas.", "code": "closed"}, status_code=409)
        if (r.get("eu") or {}).get("inscrito"):
            return JSONResponse({"error": "Esta conta já está inscrita.", "code": "enrolled"}, status_code=409)
        tok_item = r.get("token") or {}
        have = int((c.estado.get("items") or {}).get(str(tok_item.get("itemId", 70000)), 0) or 0)
        if have < int(tok_item.get("qtd") or 1):
            return JSONResponse({"error": REASONS["token"], "code": "token"}, status_code=409)
        await c.boss.enroll_raid()
        return {"ok": True}

    @app.post("/api/bosses/{acc_id}/revive")
    async def boss_revive(acc_id: int, body: ReviveIn, request: Request, tok: str | None = Query(None, alias="token")):
        """Comprar Revive sozinho (100 do mais barato quando zerar) e ligar o auto-revive do jogo."""
        if (denied := auth.guard(request, tok)):
            return denied
        c = manager.get(acc_id)
        if c is None:
            return JSONResponse({"error": "Conta não encontrada ou desligada.", "code": "offline"}, status_code=404)
        c.boss.buy_revive = body.on
        c.acc = replace(c.acc, boss_revive=body.on)
        store.update_account(c.acc.index, {"options": {"boss_revive": body.on}})
        if body.on and c.can_send:
            await c.boss.ensure_revive()
        return {"ok": True}
