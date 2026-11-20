"""Equipe do PVP e fichas: lista de Pokémon para montar a equipe, salvar o tabuleiro, ficha do Pokémon e da espécie.

    GET  /api/pvp/{conta}/roster        Pokémon da conta (filtros, ordem e páginas)
    GET  /api/pvp/{conta}/team-view     equipe atual com as casas finais do tabuleiro
    POST /api/pvp/{conta}/team          {ids, casas} salva a equipe no jogo (pvp.time.salvar)
    GET  /api/pvp/{conta}/pokemon/{id}  ficha do Pokémon (+ espécie)
    GET  /api/pvp/species/{id}          ficha da espécie
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import pvp_power as pw
from actions_api import load_catalog

if TYPE_CHECKING:
    from auth import Auth
    from connection import AccountConnection
    from manager import AccountManager

ROSTER_MAX = 80
SORTS = {
    "poder": lambda r: r["pvpPower"], "nivel": lambda r: r["level"], "nota": lambda r: r["grade"] or 0,
    "iv": lambda r: r["ivTotal"], "qualidade": lambda r: r["quality"] or 0, "pve": lambda r: r["power"] or 0,
}
NO_ACCOUNT = {"error": "Conta não encontrada ou desligada."}


class TeamIn(BaseModel):
    ids: list[int] = Field(max_length=pw.TEAM_MAX)
    casas: dict[str, int] = {}


def _iv_total(pk: dict) -> int:
    return sum(v for v in (pk.get("ivs") or {}).values() if isinstance(v, (int, float)))


def roster_row(pk: dict, esp: dict | None, in_team: bool) -> dict:
    types = pk.get("tipos") or [t for t in ((esp or {}).get("type1"), (esp or {}).get("type2")) if t]
    return {
        "id": pk.get("id"), "speciesId": pk.get("speciesId"), "name": pk.get("nome"), "level": pk.get("level") or 1,
        "looktype": pk.get("looktype"), "shiny": bool(pk.get("shiny")), "types": types,
        "pvpPower": pw.pvp_power(pk, esp), "pvpLevel": pw.arena_level(pk.get("level")), "power": pk.get("poder"),
        "quality": pk.get("quality"), "potency": pk.get("potencia"), "grade": pk.get("nota"), "ivTotal": _iv_total(pk),
        "range": pw.species_range(esp), "hunting": pk.get("slot") is not None, "inTeam": in_team,
        "refined": bool(pk.get("refino")),
    }


def _owned(c: "AccountConnection") -> dict[int, dict]:
    return {p.get("id"): p for p in (c.estado.get("pokemons") or []) if isinstance(p, dict)}


def _brief(e: dict | None) -> dict | None:
    return None if not e else {"pokeId": e["pokeId"], "name": e.get("name"), "looktype": e.get("looktype")}


def evolution(species: dict[int, dict], esp: dict) -> dict:
    pid = int(esp["pokeId"])
    prev = next((e for e in species.values() if e.get("evolvesToId") == pid), None)
    nxt = species.get(int(esp.get("evolvesToId") or 0))
    return {"prev": _brief(prev), "next": _brief(nxt), "level": esp.get("evolveLevel") or 0,
            "prevLevel": (prev or {}).get("evolveLevel") or 0}


def species_payload(esp: dict, species: dict[int, dict], c: "AccountConnection | None") -> dict:
    pid = int(esp["pokeId"])
    dex = ((c.estado.get("pokedex") or {}).get(str(pid)) if c else None) or {}
    found = []
    for h in (c.hunts if c else []):
        if not isinstance(h, dict):
            continue
        hit = next((e for e in h.get("especies") or [] if isinstance(e, dict) and e.get("pokeId") == pid), None)
        if hit:
            found.append({"slug": h.get("slug"), "name": h.get("nome"), "level": h.get("nivel"), "points": hit.get("pontos")})
    return {"species": dict(esp), "range": pw.species_range(esp), "evolution": evolution(species, esp),
            "pokedex": {"defeated": dex.get("k"), "captured": dex.get("c")}, "foundIn": found}


def find_species(pk: dict, species: dict[int, dict]) -> dict | None:
    """Espécie do Pokémon. Fichas públicas (chat, mercado) podem vir sem `speciesId`: cai para o nome."""
    esp = species.get(pk.get("speciesId"))
    if esp is None and pk.get("nome"):
        nome = str(pk["nome"]).strip().lower()
        esp = next((e for e in species.values() if str(e.get("name") or "").lower() == nome), None)
    return esp


def sheet_payload(pk: dict, species: dict[int, dict], c: "AccountConnection | None", *,
                  hunts_from: "AccountConnection | None" = None) -> dict:
    """Ficha completa de um Pokémon (da conta, ou de outro jogador quando `c` é None).

    Em Pokémon de outro jogador não há Pokédex a mostrar; `hunts_from` só empresta a lista de hunts."""
    esp = find_species(pk, species)
    stats = pk.get("stats") or {}
    out = {
        "pokemon": dict(pk),
        "combatHp": max(24, pw._round((stats.get("hp") or 0) * pw.COMBAT_HP_MULT)),
        "pvpPower": 0, "pvpLevel": pw.arena_level(pk.get("level") or 1), "pvePower": 0,
        "bases": None, "range": pw.species_range(esp),
        "species": None,
    }
    if esp is None:
        return out
    try:
        out.update(pvpPower=pw.pvp_power(pk, esp), pvePower=pw.pve_power(pk, esp), bases=pw.bases(esp, pk.get("refino")))
    except (KeyError, TypeError, ValueError):       # ficha pública incompleta: mostra o resto sem os poderes
        pass
    out["pokemon"].setdefault("speciesId", esp.get("pokeId"))
    if c is not None:
        out.update(species_payload(esp, species, c))
    else:
        out.update(species_payload(esp, species, hunts_from))
        out["pokedex"] = {"defeated": None, "captured": None}
    return out


def register_pvp_team_routes(app: FastAPI, manager: "AccountManager", auth: "Auth") -> None:
    async def species_map() -> dict[int, dict]:
        cat = await load_catalog()
        return cat["full"] if cat else {}

    @app.get("/api/pvp/{acc_id}/roster")
    async def roster(acc_id: int, request: Request, tok: str | None = Query(None, alias="token"),
                     q: str = "", tipo: str = "", iv: int = 0, shiny: bool = False, local: str = "todos",
                     ord: str = "poder", offset: int = 0, limit: int = 60):
        if (denied := auth.read_guard(request, tok)):
            return denied
        c = manager.get(acc_id)
        if c is None:
            return JSONResponse(NO_ACCOUNT, status_code=404)
        species = await species_map()
        team = set(c.pvp.team)
        q = q.strip().lower()
        tipo = tipo.strip().upper()
        rows = []
        for pk in _owned(c).values():
            if shiny and not pk.get("shiny"):
                continue
            if (local == "equipe") != (pk.get("slot") is not None) and local in ("equipe", "colecao"):
                continue
            if _iv_total(pk) < iv:
                continue
            types = [str(t).upper() for t in (pk.get("tipos") or [])]
            if tipo and tipo not in types:
                continue
            if q and q not in str(pk.get("nome") or "").lower() and not any(q in t.lower() for t in types):
                continue
            rows.append(roster_row(pk, species.get(pk.get("speciesId")), pk.get("id") in team))
        rows.sort(key=SORTS.get(ord, SORTS["poder"]), reverse=True)
        limit = max(1, min(ROSTER_MAX, limit))
        offset = max(0, offset)
        return {"total": len(rows), "owned": len(_owned(c)), "offset": offset, "items": rows[offset:offset + limit]}

    @app.get("/api/pvp/{acc_id}/team-view")
    async def team_view(acc_id: int, request: Request, tok: str | None = Query(None, alias="token")):
        """Equipe atual com as casas finais (as salvas + o preenchimento automático), pronta para o editor."""
        if (denied := auth.read_guard(request, tok)):
            return denied
        c = manager.get(acc_id)
        if c is None:
            return JSONResponse(NO_ACCOUNT, status_code=404)
        species = await species_map()
        mine = _owned(c)
        ids = [i for i in c.pvp.team if i in mine]
        ranges = [pw.species_range(species.get(mine[i].get("speciesId"))) for i in ids]
        houses = pw.fill_houses([(c.pvp.houses or {}).get(str(i)) for i in ids], ranges)
        return {"ids": ids, "casas": {str(i): h for i, h in zip(ids, houses)},
                "members": [roster_row(mine[i], species.get(mine[i].get("speciesId")), True) for i in ids]}

    @app.post("/api/pvp/{acc_id}/team")
    async def save_team(acc_id: int, body: TeamIn, request: Request, tok: str | None = Query(None, alias="token")):
        if (denied := auth.guard(request, tok)):
            return denied
        c = manager.get(acc_id)
        if c is None or not c.can_send:
            return JSONResponse({"error": "Conta offline.", "code": "offline"}, status_code=409)
        mine = _owned(c)
        ids = body.ids
        if len(set(ids)) != len(ids) or any(i not in mine for i in ids):
            return JSONResponse({"error": "Equipe inválida: Pokémon repetido ou que não é da conta."}, status_code=400)
        species = await species_map()
        ranges = [pw.species_range(species.get(mine[i].get("speciesId"))) for i in ids]
        houses = pw.fill_houses([body.casas.get(str(i)) for i in ids], ranges)
        mapa = {str(i): h for i, h in zip(ids, houses)}
        err = await c.pvp.save_team(ids, mapa)
        if err:
            return JSONResponse({"error": err, "code": "refused"}, status_code=409)
        return {"ok": True, "ids": ids, "casas": mapa}

    @app.get("/api/pvp/species/{pid}")
    async def species_sheet(pid: int, request: Request, tok: str | None = Query(None, alias="token"),
                            account: int | None = None):
        if (denied := auth.read_guard(request, tok)):
            return denied
        species = await species_map()
        esp = species.get(pid)
        if esp is None:
            return JSONResponse({"error": "Espécie não encontrada."}, status_code=404)
        return species_payload(esp, species, manager.get(account) if account is not None else None)

    @app.get("/api/pvp/{acc_id}/pokemon/{pid}")
    async def pokemon_sheet(acc_id: int, pid: int, request: Request, tok: str | None = Query(None, alias="token")):
        if (denied := auth.read_guard(request, tok)):
            return denied
        c = manager.get(acc_id)
        pk = _owned(c).get(pid) if c else None
        if pk is None:
            return JSONResponse({"error": "Pokémon não encontrado nessa conta."}, status_code=404)
        return sheet_payload(pk, await species_map(), c)
