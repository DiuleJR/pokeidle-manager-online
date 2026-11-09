"""Telemetria em tempo real: snapshot das contas + servidor FastAPI.

Endpoints:
    GET /healthz          liveness (sem auth)
    GET /api/telemetry    snapshot atual (JSON)
    WS  /ws/telemetry     snapshot a cada TELEMETRY_INTERVAL_S segundos

Autenticação (auth.py): cookie de sessão (painel) ou TELEMETRY_TOKEN por
`Authorization: Bearer <token>` / `?token=` (scripts). O WebSocket usa o cookie ou `?token=`.

Nunca expõe token/proxy/device_id das contas. As rotas de gestão ficam em admin_api.py.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from typing import TYPE_CHECKING, Callable

from fastapi import FastAPI, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from connection import State
from game_data import ball_name, item_icon_path, item_meta, item_name

if TYPE_CHECKING:
    from connection import AccountConnection

_STATUS = {
    State.ONLINE: "online",
    State.PAUSED_COOLDOWN: "paused_cooldown",
    State.BLOCKED: "blocked",
}  # o resto (DISCONNECTED/CONNECTING/AUTHENTICATING) -> "offline"


def _count(raw: dict, ids: set[int] | None = None) -> int:
    total = 0
    for k, v in (raw or {}).items():
        try:
            if ids is None or int(k) in ids:
                total += int(v)
        except (TypeError, ValueError):
            continue
    return total


SITE = "https://pokeidle.io"
BALL_ICONS = {1: "/assets/site/assets/ui/ball-poke.png", 2: "/assets/site/assets/ui/ball-great.png",
              3: "/img/ball-super.png", 4: "/assets/site/assets/ui/ball-ultra.png", 5: "/img/ball-beast.png"}


# Nomes em português para itens raros que o jogo envia em inglês.
PT_NAMES = {70011: "Fragmento de Chave", 70012: "Fragmento de Shiny Stone", 70013: "Fragmento de Bicicleta"}

NOT_RARE_CATEGORIES = frozenset({"stone", "heal", "revive"})


def _abs(path: str | None) -> str | None:
    if not path:
        return None
    return SITE + (path if path.startswith("/") else f"/assets/{path}")


def item_rows(c: "AccountConnection") -> list[dict]:
    """Itens da conta com nome/categoria/raro/ícone. Itens só do servidor (70xxx)
    vêm do `welcome.itensNossos`; os demais das tabelas de game_data."""
    rows = []
    for raw_id, qty in (c.estado.get("items") or {}).items():
        try:
            iid, qty = int(raw_id), int(qty)
        except (TypeError, ValueError):
            continue
        nos = c.itens_nossos.get(iid)
        if nos:
            name, cat, rare, icon = nos.get("name", item_name(iid)), nos.get("category", "special"), bool(nos.get("rare")), nos.get("icon")
        else:
            name = item_name(iid)
            cat, rare = item_meta(iid)
            icon = item_icon_path(iid)
        name = PT_NAMES.get(iid, name)
        if cat in NOT_RARE_CATEGORIES:  # pedras e poções não contam como raros, mesmo que o jogo marque
            rare = False
        rows.append({"id": iid, "name": name, "qty": qty, "category": cat, "rare": rare, "icon": _abs(icon)})
    rows.sort(key=lambda r: -r["qty"])
    return rows


def ball_rows(c: "AccountConnection") -> list[dict]:
    return [{"id": i, "name": n, "qty": q, "icon": _abs(BALL_ICONS.get(i))} for i, n, q in c.inventory.balls()]


def pokemon_rows(c: "AccountConnection") -> list[dict]:
    """Lista compacta de Pokémons da conta (servida sob demanda em /api/pokemons)."""
    acc_id = f"acc{c.acc.index}"
    rows = []
    for p in c.inventory.pokemons():
        ivs = p.get("ivs") or {}
        rows.append({
            "id": p.get("id"), "account": acc_id, "speciesId": p.get("speciesId"),
            "name": p.get("nome"), "types": p.get("tipos") or [], "level": p.get("level"),
            "shiny": bool(p.get("shiny")), "quality": p.get("quality"), "power": p.get("poder"),
            "grade": p.get("nota"), "slot": p.get("slot"), "ivTotal": sum(v for v in ivs.values() if isinstance(v, (int, float))),
            "caughtAt": p.get("caughtAt"), "looktype": p.get("looktype"),
        })
    return rows


def equipped_rows(c: "AccountConnection") -> dict:
    """Poção e Ball equipadas no momento (com quantidade), p/ os cards do dashboard."""
    from shop import KNOWN_POTION_IDS  # evita ciclo em import-time

    est = c.estado
    pk = c.hunt.active_pokemon()
    auto = est.get("automation") or {}

    held = pk.get("heldItemId") if pk else None
    potion_id = c.acc.potion_id or (held if held in KNOWN_POTION_IDS else None)
    if potion_id is None:
        potion_id = next((i for i in auto.get("potionIds", []) if i in KNOWN_POTION_IDS), None)
    potion = None
    if potion_id is not None:
        nos = c.itens_nossos.get(potion_id) or {}
        icon = nos.get("icon") or item_icon_path(potion_id)
        potion = {"id": potion_id, "name": nos.get("name") or item_name(potion_id),
                  "qty": int((est.get("items") or {}).get(str(potion_id), 0) or 0), "icon": _abs(icon)}

    ball_id = c.acc.ball_id or next(iter(auto.get("ballIds", [])), None) or next(iter(c.acc.ball_priority), None)
    ball = None
    if ball_id is not None:
        ball = {"id": ball_id, "name": ball_name(ball_id),
                "qty": int((est.get("balls") or {}).get(str(ball_id), 0) or 0), "icon": _abs(BALL_ICONS.get(ball_id))}
    return {"potion": potion, "ball": ball}


def account_snapshot(c: "AccountConnection") -> dict:
    from inventory import POTION_NAMES  # evita ciclo em import-time

    est = c.estado
    pk = c.hunt.active_pokemon()
    s = c.hunt.session
    inv = c.inventory
    summary = inv.pokemon_summary()
    return {
        "id": f"acc{c.acc.index}",
        "nick": c.acc.nick,
        "level": est.get("level") or 0,
        "status": _STATUS.get(c.state, "offline"),
        "state": c.state.value,  # estado detalhado, p/ debug
        "blocked": c.block,      # {kind, detail} quando o jogo recusou a conta
        "lastReason": c.last_reason,
        "pokemon": {
            "name": pk.get("nome", "?"),
            "hp": pk.get("hp", 0),
            "maxHp": pk.get("maxHp", 0),
            "level": pk.get("level"),
            "looktype": pk.get("looktype"),
            "shiny": bool(pk.get("shiny")),
        } if pk else None,
        "xpPerHour": round(s.xp_por_hora) if s else 0,
        "goldPerHour": round(s.gold_por_hora) if s else 0,
        "xp": {"atual": est.get("xp"), "nivel": est.get("xpNivel"), "proximo": est.get("xpProximo")},
        "hunt": {"slug": s.slug, "kills": s.kills, "minutes": round(s.elapsed_h * 60, 1)} if s else None,
        "vip": (est.get("loja") or {}).get("vipAte", 0) > (est.get("servidorAgora") or 0),
        "huntName": s.nome if s else None,
        "session": {
            "startedAt": int(c.session_started * 1000) if c.session_started else None,
            "items": dict(c.session_items.gained),
        },
        "equipped": equipped_rows(c),
        "gold": est.get("gold") or 0,
        "gems": est.get("orbs") or 0,
        "diamonds": est.get("diamonds") or 0,
        "potions": _count(est.get("items"), set(POTION_NAMES)),
        "balls": _count(est.get("balls")),
        "captured": {
            "session": c.balls.caught,
            "failed": c.balls.failed,
            "total": summary["total"],
            "shiny": summary["shiny"],
        },
        "inventory": {
            "balls": ball_rows(c),
            "items": item_rows(c),
            "pokedexSpecies": inv.pokedex_species_count(),
        },
    }


def build_snapshot(conns: "list[AccountConnection]") -> dict:
    return {
        "type": "snapshot",
        "ts": int(time.time() * 1000),
        "accounts": [account_snapshot(c) for c in conns],
    }


def create_app(
    conns: "list[AccountConnection] | Callable[[], list[AccountConnection]]",
    auth,
    interval: float = 1.0,
    cors_origins: list[str] | None = None,
    manager=None,
    store=None,
    updater=None,
) -> FastAPI:
    """`conns` pode ser uma lista fixa ou uma função (contas mudam em tempo de execução).
    `auth` (auth.Auth) protege tudo. Com `manager` e `store`, registra as rotas de gestão (admin_api.py)."""
    get_conns = conns if callable(conns) else (lambda: conns)
    app = FastAPI(title="Pokeidle Manager Telemetry", docs_url=None, redoc_url=None)
    if cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=cors_origins,
                           allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
                           allow_headers=["Authorization", "Content-Type"])

    from auth import register_auth_routes

    register_auth_routes(app, auth)

    @app.get("/healthz")
    async def healthz():
        return {"ok": True}

    @app.get("/api/telemetry")
    async def telemetry(request: Request, tok: str | None = Query(None, alias="token")):
        if (denied := auth.read_guard(request, tok)):
            return denied
        return build_snapshot(get_conns())

    atlas_cache: dict = {}

    @app.get("/api/sprite-atlas")
    async def sprite_atlas():
        """Proxy (com cache de 1h) do índice de retratos do jogo: o site não envia CORS."""
        import aiohttp

        if atlas_cache.get("exp", 0) < time.time():
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as s:
                async with s.get(f"{SITE}/assets/site/assets/maps/marker-atlas.json") as r:
                    j = json.loads(await r.text())
            atlas_cache.update(exp=time.time() + 3600, data={
                "cell": j.get("cell", 64), "cols": j.get("cols", 16), "rows": j.get("rows", 1),
                "image": SITE + j.get("image", "/assets/site/assets/maps/marker-atlas.png"),
                "slots": j.get("slots", {}),
            })
        return JSONResponse(atlas_cache["data"], headers={"Cache-Control": "max-age=3600"})

    @app.get("/api/pokemons")
    async def pokemons(request: Request, tok: str | None = Query(None, alias="token"),
                       account: str | None = None):
        if (denied := auth.read_guard(request, tok)):
            return denied
        rows: list[dict] = []
        for c in get_conns():
            if account in (None, "", f"acc{c.acc.index}"):
                rows.extend(pokemon_rows(c))
        return {"ts": int(time.time() * 1000), "pokemons": rows}

    @app.post("/api/sell-depot")
    async def sell_depot(request: Request, tok: str | None = Query(None, alias="token"),
                          account: str | None = None):
        """Vende o Depot (shop.sellAllPokemons, spec do protocolo §17) de uma conta
        ou de todas. AÇÃO IRREVERSÍVEL no jogo — a confirmação ao usuário é feita
        no dashboard antes desta chamada; aqui só se executa o comando."""
        if (denied := auth.guard(request, tok)):  # ação: exige login mesmo sem senha exigida nas leituras
            return denied
        targets = [c for c in get_conns() if account in (None, "", f"acc{c.acc.index}")]
        if not targets:
            return JSONResponse({"error": "conta não encontrada"}, status_code=404)

        async def _sell_one(c: "AccountConnection") -> dict:
            acc_id = f"acc{c.acc.index}"
            try:
                r = await c.shop.sell_all_pokemons()
                return {"account": acc_id, "nick": c.acc.nick, "ok": True, **r}
            except RuntimeError as e:
                return {"account": acc_id, "nick": c.acc.nick, "ok": False, "error": str(e)}

        results = await asyncio.gather(*(_sell_one(c) for c in targets))
        return {"results": results}

    @app.websocket("/ws/telemetry")
    async def ws_telemetry(ws: WebSocket, tok: str | None = Query(None, alias="token")):
        if auth.required() and not auth.check_ws(ws):
            await ws.close(code=4401)  # antes do accept => HTTP 403 no handshake
            return
        await ws.accept()
        try:
            while True:
                await ws.send_json(build_snapshot(get_conns()))
                await asyncio.sleep(interval)
        except (WebSocketDisconnect, RuntimeError):
            pass

    if manager is not None and store is not None:
        from admin_api import register_admin_routes
        register_admin_routes(app, manager, store, auth)
        from market_api import register_market_routes
        register_market_routes(app, manager, store, auth)
    if updater is not None:
        from updater import register_update_routes
        register_update_routes(app, updater, auth)

    # Dashboard estático (build do Vite) na raiz; rotas /api e /ws acima têm prioridade.
    web_dir = os.getenv("WEB_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "web_dist")
    if os.path.isdir(web_dir):
        from fastapi.staticfiles import StaticFiles
        app.mount("/", StaticFiles(directory=web_dir, html=True), name="web")

    return app
