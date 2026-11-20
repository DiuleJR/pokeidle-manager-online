"""Ficha de Pokémon que não é da conta aberta: mercado, chat e anúncios.

    POST /api/pokemon/sheet            {pokemon}  ficha a partir de um Pokémon já em mãos (anúncio da vitrine)
    GET  /api/pokemon/public?nick=&pid= Pokémon mostrado/capturado por um jogador (chat.verPokemon -> ranking.ficha)
    GET  /api/pokemon/listing/{id}     Pokémon de um anúncio do mercado (market.anuncio), o link do chat

A resposta tem o mesmo formato de `GET /api/pvp/{conta}/pokemon/{id}` (mais `owner` e, em anúncios, `listing`).
Nada disso muda estado no jogo: só lê.
"""
from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from actions_api import load_catalog
from market import MarketError
from pvp_team_api import sheet_payload

if TYPE_CHECKING:
    from auth import Auth
    from connection import AccountConnection
    from manager import AccountManager

FICHA_TTL_S = 60.0       # o mesmo Pokémon aberto várias vezes não vira várias perguntas ao jogo
FICHA_WAIT_S = 8.0
CACHE_MAX = 200


class FichaIn(BaseModel):
    pokemon: dict
    listing: dict | None = None      # preço do anúncio de onde o Pokémon veio (a vitrine já sabe)


class PublicFichas:
    """Pede `chat.verPokemon` por uma conta online e entrega o `ranking.ficha` que o jogo devolve."""

    def __init__(self) -> None:
        self._cache: dict[int, tuple[float, dict]] = {}
        self._waiters: dict[int, list[asyncio.Future]] = {}

    def handle_frame(self, conn: "AccountConnection", msg: dict) -> None:
        if msg.get("dica"):                       # a "dica" é o balão da guerra de guilds, não a ficha
            return
        pk = msg.get("pokemon")
        if not isinstance(pk, dict) or not isinstance(pk.get("id"), int):
            return
        pid = pk["id"]
        if len(self._cache) >= CACHE_MAX:
            self._cache.pop(next(iter(self._cache)))
        self._cache[pid] = (time.monotonic(), pk)
        for fut in self._waiters.pop(pid, []):
            if not fut.done():
                fut.set_result(pk)

    def cached(self, pid: int) -> dict | None:
        hit = self._cache.get(pid)
        return hit[1] if hit and time.monotonic() - hit[0] < FICHA_TTL_S else None

    async def get(self, manager: "AccountManager", nick: str, pid: int) -> dict:
        if (pk := self.cached(pid)) is not None:
            return pk
        conn = next((c for c in manager.connections() if c.can_send), None)
        if conn is None:
            raise MarketError("Nenhuma conta online para consultar o jogo.")
        fut = asyncio.get_running_loop().create_future()
        self._waiters.setdefault(pid, []).append(fut)
        try:
            await conn.send_frame({"t": "chat.verPokemon", "nick": nick, "pokemonId": pid})
            return await asyncio.wait_for(fut, FICHA_WAIT_S)
        except asyncio.TimeoutError:
            raise MarketError("O jogo não respondeu: o Pokémon pode ter sido vendido ou liberado.") from None
        finally:
            lst = self._waiters.get(pid)
            if lst and fut in lst:
                lst.remove(fut)
                if not lst:
                    self._waiters.pop(pid, None)


def register_pokemon_sheet_routes(app: FastAPI, manager: "AccountManager", auth: "Auth") -> None:
    async def species_map() -> dict[int, dict]:
        cat = await load_catalog()
        return cat["full"] if cat else {}

    def any_conn() -> "AccountConnection | None":
        return next((c for c in manager.connections() if c.can_send), None)

    async def payload(pk: dict, **extra) -> dict:
        return {**sheet_payload(pk, await species_map(), None, hunts_from=any_conn()), **extra}

    @app.post("/api/pokemon/sheet")
    async def sheet_from_pokemon(body: FichaIn, request: Request, tok: str | None = Query(None, alias="token")):
        if (denied := auth.read_guard(request, tok)):
            return denied
        pk = body.pokemon
        if not isinstance(pk.get("stats"), dict) and not isinstance(pk.get("ivs"), dict):
            return JSONResponse({"error": "Esse anúncio não trouxe a ficha do Pokémon."}, status_code=422)
        ls = body.listing or {}
        listing = {"id": ls.get("id"), "price": ls.get("price"), "currency": "orb" if ls.get("currency") == "orb" else "gold",
                   "qty": ls.get("qty") or 1} if isinstance(ls.get("price"), (int, float)) else None
        return await payload(pk, owner=pk.get("dono"), **({"listing": listing} if listing else {}))

    @app.get("/api/pokemon/public")
    async def sheet_public(request: Request, nick: str = "", pid: int = 0, tok: str | None = Query(None, alias="token")):
        if (denied := auth.read_guard(request, tok)):
            return denied
        nick = nick.strip()[:24]
        if not nick or pid <= 0:
            return JSONResponse({"error": "Faltou o jogador ou o Pokémon."}, status_code=400)
        for c in manager.connections():              # é de uma das suas contas: usa a ficha completa
            mine = next((p for p in (c.estado.get("pokemons") or []) if isinstance(p, dict) and p.get("id") == pid), None)
            if mine is not None and str((c.estado.get("eu") or {}).get("nick") or getattr(c.acc, "nick", "") or "").lower() == nick.lower():
                return {**sheet_payload(mine, await species_map(), c), "owner": nick}
        try:
            pk = await manager.fichas.get(manager, nick, pid)
        except MarketError as e:
            return JSONResponse({"error": str(e)}, status_code=504)
        return await payload(pk, owner=nick)

    @app.get("/api/pokemon/listing/{listing_id}")
    async def sheet_listing(listing_id: int, request: Request, tok: str | None = Query(None, alias="token")):
        if (denied := auth.read_guard(request, tok)):
            return denied
        conn = next((c for c in manager.connections() if c.market.online), None)
        if conn is None:
            return JSONResponse({"error": "Nenhuma conta online para consultar o mercado."}, status_code=503)
        try:
            res = await conn.market.anuncio(listing_id)
        except MarketError as e:
            return JSONResponse({"error": str(e)}, status_code=504)
        a = res.get("anuncio")
        if not isinstance(a, dict) or a.get("estado") not in (None, "aberto"):
            return JSONResponse({"error": "Esse anúncio já saiu do mercado.", "code": "gone"}, status_code=404)
        if a.get("tipo") != "pokemon" or not isinstance(a.get("ficha"), dict):
            return JSONResponse({"error": "Esse anúncio é de item, não de Pokémon.", "code": "item"}, status_code=422)
        pk = {**a["ficha"], "id": a["ficha"].get("id") or a.get("pokemonId"), "dono": a.get("vendedor")}
        return await payload(pk, owner=a.get("vendedor"),
                             listing={"id": a.get("id"), "price": a.get("preco"), "currency": a.get("moeda"), "qty": a.get("qtd")})
