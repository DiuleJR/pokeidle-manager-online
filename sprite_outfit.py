"""Sprites de Pokémon que não estão no atlas de retratos: formas Mega, shinies e espécies novas.

O atlas do jogo (`marker-atlas.json`) só cobre as formas comuns. Para o resto o próprio jogo carrega o "outfit" do
looktype: índice (`outfits-index.json`) -> manifesto da categoria -> página de textura com o quadro. O site não envia
CORS, então o painel pergunta aqui qual é a página e o retângulo do primeiro quadro (o Pokémon de frente) e desenha
com CSS, sem baixar nada pelo servidor.

    GET /api/sprite/{looktype}  ->  {image, pageW, pageH, x, y, w, h}   (404 quando o jogo não tem esse looktype)
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import TYPE_CHECKING

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse

if TYPE_CHECKING:
    from auth import Auth

log = logging.getLogger("sprite_outfit")

SITE = "https://pokeidle.io"
PACK = "/assets/asset-packs"
INDEX_TTL_S = 3600
HIT_TTL_S = 6 * 3600
MISS_TTL_S = 300             # "não existe" é reavaliado logo: o jogo adiciona looktypes a cada atualização
CACHE_MAX = 2000
FETCH_TIMEOUT_S = 15
FRONT = 3                    # direção "de frente", a mesma que o jogo usa nos retratos


def look_of(pk: dict | None) -> int | None:
    """Looktype a desenhar: o do shiny quando o Pokémon é shiny e o jogo informou a forma dele."""
    if not pk:
        return None
    if pk.get("shiny") and pk.get("lookShiny"):
        return pk["lookShiny"]
    return pk.get("looktype")


def _localize(path: str) -> str:
    """O manifesto aponta para /assets-packs/...; no site o pacote fica em /assets/asset-packs/..."""
    return PACK + path[len("/assets-packs"):] if path.startswith("/assets-packs") else path


def pick_frame(manifest: dict) -> dict | None:
    """Primeiro quadro da direção de frente (ou da primeira direção que existir) -> {page, x, y, w, h}."""
    by_dir: dict[int, dict[int, dict]] = {}
    for key, asset in (manifest.get("assets") or {}).items():
        stem = key.rsplit("/", 1)[-1].removesuffix(".png")
        if stem.endswith("_template"):                   # máscara de colorização, não é o desenho
            continue
        try:
            n = [int(x) for x in stem.split("_")]
            frame = (asset.get("frames") or [None])[0]
            if frame is None or len(n) < 4:
                continue
            by_dir.setdefault(n[3], {})[n[0]] = {"page": frame.get("page", 0), "x": frame["x"], "y": frame["y"], "w": frame["w"], "h": frame["h"]}
        except (ValueError, KeyError, TypeError, AttributeError):
            continue
    if not by_dir:
        return None
    frames = by_dir.get(FRONT) or next(iter(by_dir.values()))
    return frames[min(frames)]


class OutfitSprites:
    def __init__(self) -> None:
        self._index: dict | None = None
        self._index_exp = 0.0
        self._cache: dict[int, tuple[float, dict | None]] = {}
        self._tasks: dict[int, asyncio.Task] = {}
        self._index_lock = asyncio.Lock()

    async def _get_json(self, session, path: str) -> dict:
        async with session.get(SITE + path) as r:
            r.raise_for_status()
            return json.loads(await r.text())

    async def _load_index(self, session) -> dict:
        async with self._index_lock:
            if self._index is None or self._index_exp < time.time():
                try:
                    j = await self._get_json(session, f"{PACK}/outfits-index.json")
                    self._index, self._index_exp = j.get("outfits") or {}, time.time() + INDEX_TTL_S
                except Exception:
                    if self._index is None:
                        raise
                    self._index_exp = time.time() + 60          # mantém o último bom e tenta de novo logo
            return self._index

    async def _resolve(self, looktype: int) -> dict | None:
        import aiohttp

        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=FETCH_TIMEOUT_S)) as s:
            entry = (await self._load_index(s)).get(str(looktype))
            if not entry:
                return None
            manifest = await self._get_json(s, _localize(entry["manifest"]))
        cat = next(iter((manifest.get("categories") or {}).values()), None)
        frame = pick_frame(manifest)
        pages = (cat or {}).get("pages") or []
        if not cat or frame is None or frame["page"] >= len(pages):
            return None
        page = pages[frame["page"]]
        return {"image": SITE + _localize(page["image"]), "pageW": page["width"], "pageH": page["height"],
                "x": frame["x"], "y": frame["y"], "w": frame["w"], "h": frame["h"]}

    async def get(self, looktype: int) -> dict | None:
        hit = self._cache.get(looktype)
        if hit and hit[0] > time.time():
            return hit[1]
        task = self._tasks.get(looktype)                         # várias abas pedindo o mesmo looktype: uma busca só
        if task is None:
            task = self._tasks[looktype] = asyncio.ensure_future(self._resolve(looktype))
        try:
            data = await asyncio.shield(task)
        finally:
            if task.done():
                self._tasks.pop(looktype, None)
        if len(self._cache) >= CACHE_MAX:
            self._cache.pop(next(iter(self._cache)))
        self._cache[looktype] = (time.time() + (HIT_TTL_S if data else MISS_TTL_S), data)
        return data


def register_sprite_routes(app: FastAPI, auth: "Auth") -> None:
    sprites = OutfitSprites()

    @app.get("/api/sprite/{looktype}")
    async def outfit_sprite(looktype: int, request: Request, tok: str | None = Query(None, alias="token")):
        if (denied := auth.read_guard(request, tok)):
            return denied
        if not 0 < looktype < 10_000_000:
            return JSONResponse({"error": "looktype inválido"}, status_code=400)
        try:
            data = await sprites.get(looktype)
        except Exception as e:  # noqa: BLE001 - o site fora do ar não pode virar erro 500 na tela
            log.warning("sprite %s indisponível: %s", looktype, e)
            return JSONResponse({"error": "sprite indisponível"}, status_code=502)
        if data is None:
            return JSONResponse({"error": "esse looktype não tem sprite"}, status_code=404)
        return JSONResponse(data, headers={"Cache-Control": "max-age=21600"})
