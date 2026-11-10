"""Ações do painel sobre as contas: trocar de hunt, trocar poção/bola e o catálogo do mapa.

Tudo exige login no painel (ou o TELEMETRY_TOKEN), como em admin_api.py. Os comandos usam só frames
já confirmados do protocolo: `hunt.select` (docs/02) e `auto.set` (docs/04).
"""
from __future__ import annotations

import asyncio
import json
import time
from dataclasses import replace
from typing import TYPE_CHECKING, Literal

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from auth import Auth
from connection import AccountConnection
from game_data import BALL_NAMES
from shop import BUYABLE_BALL_IDS, KNOWN_POTION_IDS
from store import Store

if TYPE_CHECKING:
    from manager import AccountManager

SITE = "https://pokeidle.io"
HUNT_CONFIRM_TIMEOUT_S = 6.0   # o jogo confirma a troca com batalha.ev[].k == "hunt"


class HuntIn(BaseModel):
    slug: str


class EquipIn(BaseModel):
    kind: Literal["ball", "potion"]
    id: int


def hunt_catalog(conn: AccountConnection) -> list[dict]:
    """`welcome.hunts` da conta, só com os campos que o mapa usa."""
    out = []
    for h in conn.hunts:
        if not isinstance(h, dict) or not h.get("slug"):
            continue
        out.append({
            "slug": h["slug"], "nome": h.get("nome") or h["slug"], "area": h.get("area") or "kanto",
            "nivel": h.get("nivel") or 0, "regiao": h.get("regiao"), "pixel": h.get("pixel"),
            "looktype": h.get("looktype"), "totalSpawns": h.get("totalSpawns") or 0,
            "especies": [{"pokeId": e.get("pokeId"), "nome": e.get("nome"), "pontos": e.get("pontos", 0)}
                         for e in h.get("especies") or [] if isinstance(e, dict)],
        })
    return out


# Variantes Outland (#2001+): o nome é "<prefixo> <espécie base>" e elas herdam o sprite da base.
OUTLAND_MIN, OUTLAND_MAX = 2001, 2059
OUTLAND_LEGACY_MIN, OUTLAND_LEGACY_MAX = 10501, 10548   # faixa antiga do espelho: normaliza para 2001+
ORRE_MIN, ORRE_MAX = 13000, 14000                        # clones de Orre (#13000 + dex): sprite do nacional
OUTLAND_PREFIXES = (
    "Brave ", "Tribal ", "Ancient ", "War ", "Furious ", "Charged ", "Magnetic ", "Evil ", "Freezing ", "Psy ",
    "Heavy ", "Milch-", "Roll ", "Hard ", "Brute ", "Enraged ", "Dark ", "Trickmaster ", "Banshee ",
    "Taekwondo ", "Enigmatic ", "Magma ", "Toxic ",
)
CATALOG_FILES = ("creatures.json", "creatures-novos.json", "creatures-outland-novos.json", "creatures-formas.json")


def merge_catalog(parts: list[dict], lab: dict | None = None) -> dict:
    """Junta os arquivos de espécies do jogo como o cliente oficial faz: lista única, normaliza o Outland antigo,
    aplica os looktypes do lab e faz Orre e Outland herdarem o sprite da espécie base. Devolve o formato compacto."""
    creatures: list[dict] = []
    for p in parts:
        creatures.extend(c for c in (p or {}).get("creatures", []) if isinstance(c, dict) and c.get("pokeId") is not None)
    creatures = [dict(c) for c in creatures]
    for c in creatures:
        if OUTLAND_LEGACY_MIN <= int(c["pokeId"]) < OUTLAND_LEGACY_MAX:
            c["pokeId"] = int(c["pokeId"]) - (OUTLAND_LEGACY_MIN - OUTLAND_MIN)
    by_id: dict[int, dict] = {}
    for c in creatures:
        by_id.setdefault(int(c["pokeId"]), c)
    for patch in (lab or {}).get("patches", []):
        c = by_id.get(patch.get("pokeId"))
        if c is not None and patch.get("looktype"):
            c["looktype"] = patch["looktype"]
    by_name = {str(c.get("name", "")).lower(): c for c in creatures if int(c["pokeId"]) <= 1025}
    for c in creatures:
        pid = int(c["pokeId"])
        base = None
        if ORRE_MIN <= pid < ORRE_MAX:
            base = by_id.get(pid - ORRE_MIN)
        elif OUTLAND_MIN <= pid < OUTLAND_MAX:
            name = str(c.get("name", "")).strip()
            for pre in OUTLAND_PREFIXES:
                if name.startswith(pre):
                    name = name[len(pre):]
                    break
            base = by_name.get(name.lower())
        if base is not None and (base.get("looktype") or 0) > 1:
            c["looktype"] = base["looktype"]
    return compact_creatures({"creatures": creatures})


def compact_creatures(raw: dict) -> dict:
    """creatures.json do jogo -> {pokeId: {n: nome, t: [tipos], l: [nomes de loot], lk: looktype}} (leve para o navegador)."""
    out: dict[str, dict] = {}
    for c in raw.get("creatures", []):
        if not isinstance(c, dict) or c.get("pokeId") is None:
            continue
        types = [t for t in (c.get("type1"), c.get("type2")) if t]
        loot = [l.get("name") for l in c.get("loot") or [] if isinstance(l, dict) and l.get("name")]
        out[str(c["pokeId"])] = {"n": c.get("name"), "t": types, "l": loot, "lk": c.get("looktype")}
    return out


def register_action_routes(app: FastAPI, manager: "AccountManager", store: Store, auth: Auth) -> None:
    creatures_cache: dict = {}

    def guard(request: Request, tok: str | None):
        return auth.guard(request, tok)

    def conn_of(acc_id: int) -> AccountConnection | None:
        return manager.get(acc_id)

    @app.get("/api/hunts")
    async def hunts(request: Request, tok: str | None = Query(None, alias="token"), account: str | None = None):
        if (r := guard(request, tok)):
            return r
        conns = manager.connections()
        pick = next((c for c in conns if f"acc{c.acc.index}" == account), None) if account else None
        pick = pick or next((c for c in conns if c.hunts), None)
        if pick is None:
            return {"account": None, "level": 0, "current": None, "hunts": []}
        s = pick.hunt.session
        return {"account": f"acc{pick.acc.index}", "level": pick.estado.get("level") or 0,
                "current": s.slug if s else pick.estado.get("huntSlug"), "hunts": hunt_catalog(pick)}

    @app.get("/api/creatures")
    async def creatures(request: Request, tok: str | None = Query(None, alias="token")):
        """creatures.json do jogo (tipos e loot), com cache de 1h: o site não envia CORS."""
        if (r := guard(request, tok)):
            return r
        if creatures_cache.get("exp", 0) < time.time():
            import aiohttp

            async def fetch(s, name: str):
                try:
                    async with s.get(f"{SITE}/assets/{name}") as resp:
                        return json.loads(await resp.text()) if resp.status == 200 else None
                except (aiohttp.ClientError, asyncio.TimeoutError, ValueError):
                    return None  # arquivo opcional: o catálogo fica só com o que veio

            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as s:
                *parts, lab = await asyncio.gather(*(fetch(s, n) for n in (*CATALOG_FILES, "creatures-sprites-lab.json")))
            if not parts[0]:
                return JSONResponse({"error": "não consegui baixar os dados do jogo"}, status_code=502)
            creatures_cache.update(exp=time.time() + 3600, data=merge_catalog(parts, lab))
        return JSONResponse(creatures_cache["data"], headers={"Cache-Control": "max-age=3600"})

    @app.post("/api/accounts/{acc_id}/hunt")
    async def select_hunt(acc_id: int, body: HuntIn, request: Request, tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        conn = conn_of(acc_id)
        if conn is None:
            return JSONResponse({"error": "conta não encontrada ou desligada"}, status_code=404)
        if not conn.can_send:
            return JSONResponse({"error": "A conta está offline."}, status_code=409)
        if body.slug not in {h.get("slug") for h in conn.hunts if isinstance(h, dict)}:
            return JSONResponse({"error": "Hunt desconhecida para esta conta."}, status_code=400)
        # Em combate o jogo recusa a troca: entra na fila e o bot troca sozinho quando a trava acabar.
        wait = conn.combat_lock_ms()
        if wait > 0:
            conn.queue_hunt(body.slug)
            return {"ok": True, "confirmed": False, "queued": True, "waitMs": wait, "slug": body.slug}
        conn.queue_hunt(None)  # um pedido novo sem trava substitui qualquer fila antiga
        await conn.hunt.select_hunt(body.slug)
        # O envio não prova nada: quem confirma é o evento `hunt` do jogo (recusa em combate/nível não responde).
        for _ in range(int(HUNT_CONFIRM_TIMEOUT_S / 0.25)):
            await asyncio.sleep(0.25)
            s = conn.hunt.session
            if s is not None and s.slug == body.slug:
                return {"ok": True, "confirmed": True, "slug": body.slug}
        return {"ok": True, "confirmed": False, "slug": body.slug}

    @app.delete("/api/accounts/{acc_id}/hunt/queue")
    async def cancel_hunt_queue(acc_id: int, request: Request, tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        conn = conn_of(acc_id)
        if conn is None:
            return JSONResponse({"error": "conta não encontrada ou desligada"}, status_code=404)
        conn.queue_hunt(None)
        return {"ok": True}

    @app.post("/api/accounts/{acc_id}/equip")
    async def equip(acc_id: int, body: EquipIn, request: Request, tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        conn = conn_of(acc_id)
        if conn is None:
            return JSONResponse({"error": "conta não encontrada ou desligada"}, status_code=404)
        if not conn.can_send:
            return JSONResponse({"error": "A conta está offline."}, status_code=409)
        is_ball = body.kind == "ball"
        if (is_ball and body.id not in BALL_NAMES) or (not is_ball and body.id not in KNOWN_POTION_IDS):
            return JSONResponse({"error": "Item inválido."}, status_code=400)
        await conn.set_automation({"ballIds": [body.id]} if is_ball else {"potionIds": [body.id]})
        # A escolha vira o alvo da reposição automática (e sobrevive a reinícios).
        field = "ball_id" if is_ball else "potion_id"
        store.update_account(acc_id, {"options": {field: body.id}})
        conn.acc = replace(conn.acc, **{field: body.id})
        bucket = "balls" if is_ball else "items"
        stock = int((conn.estado.get(bucket) or {}).get(str(body.id), 0) or 0)
        threshold = conn.acc.ball_restock_threshold if is_ball else conn.acc.potion_restock_threshold
        enabled = conn.acc.auto_ball_restock if is_ball else conn.acc.auto_potion
        buyable = (body.id in BUYABLE_BALL_IDS) if is_ball else True
        will_buy = enabled and buyable and stock < threshold
        if will_buy:
            await conn.restock_now("ball" if is_ball else "item")
        return {"ok": True, "stock": stock, "willBuy": will_buy, "restockEnabled": enabled, "buyable": buyable}
