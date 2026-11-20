"""Histórico do mercado vindo do pokeidleguide.io (site da comunidade que guarda as vendas desde 08/10).

Usado só para os períodos de 7 e 30 dias e para o gráfico de preço dos itens: o site entrega o que o nosso coletor
ainda não tem (semanas de histórico, mediana e quartis). Sem documentação oficial da API, então tudo aqui é defensivo:
cache em memória (resumo 5 min, série 1 h), uma consulta por vez para cada endereço, tempo limite curto e, se o site
cair, o painel volta para os dados locais. Só leitura e só GET; nada do painel é enviado para lá.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

log = logging.getLogger("market")

SITE = "https://pokeidleguide.io"
BASE = f"{SITE}/api/mercado"
TTL_NAMES_S = 24 * 3600
SPRITES_MAX = 1500
TIMEOUT_S = 8.0
TTL_RESUMO_S = 300
TTL_SERIE_S = 3600
STALE_MAX_S = 24 * 3600         # se o site cair, ainda vale mostrar o que veio nas últimas 24 h
MAX_DAYS = 30                   # o site não passa disso
MOEDA = {"gold": "ouro", "orb": "gema"}
TOP_GROUPS = 60
TOP_MOVERS = 6
MOVER_MIN_SALES = 5


class HubError(Exception):
    """O site não respondeu ou respondeu algo que não dá para usar."""


class HubClient:
    def __init__(self) -> None:
        self._cache: dict[str, tuple[float, Any]] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._sprites: dict[int, bytes | None] = {}      # espécie -> PNG (None = o site não tem)
        self._sprite_at: dict[int, float] = {}

    async def _fetch(self, url: str) -> Any:
        import aiohttp

        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=TIMEOUT_S),
                                             headers={"User-Agent": "PokeIdleManager", "Accept": "application/json"}) as s:
                async with s.get(url) as r:
                    if r.status != 200:
                        raise HubError(f"o site respondeu {r.status}")
                    return await r.json(content_type=None)
        except HubError:
            raise
        except Exception as e:  # noqa: BLE001 - rede fora, JSON quebrado, tempo esgotado
            raise HubError(f"o site não respondeu ({type(e).__name__})") from e

    async def get(self, path: str, ttl: float) -> Any:
        url = path if path.startswith("https://") else f"{BASE}/{path}"
        hit = self._cache.get(url)
        if hit and time.monotonic() - hit[0] < ttl:
            return hit[1]
        lock = self._locks.setdefault(url, asyncio.Lock())
        async with lock:                       # várias telas pedindo a mesma coisa viram uma consulta só
            hit = self._cache.get(url)
            if hit and time.monotonic() - hit[0] < ttl:
                return hit[1]
            try:
                data = await self._fetch(url)
            except HubError:
                if hit and time.monotonic() - hit[0] < STALE_MAX_S:
                    log.warning("pokeidleguide.io fora do ar: usando a resposta guardada de %s", path)
                    return hit[1]
                raise
            self._cache[url] = (time.monotonic(), data)
            return data

    async def resumo(self, days: int) -> dict:
        data = await self.get(f"resumo?dias={min(max(1, days), MAX_DAYS)}", TTL_RESUMO_S)
        if not isinstance(data, dict) or not isinstance(data.get("totais"), dict) or not isinstance(data.get("maisVendidos"), list):
            raise HubError("resposta inesperada do site")
        return data

    async def names(self) -> dict[str, int]:
        """nome do Pokémon (inclusive formas como "Furious Scizor") -> id da espécie, do índice de sprites do site."""
        data = await self.get(f"{SITE}/assets/sprites/nomes.json", TTL_NAMES_S)
        if not isinstance(data, dict):
            raise HubError("resposta inesperada do site")
        return {str(k): int(v) for k, v in data.items() if isinstance(v, int) and not isinstance(v, bool)}

    async def sprite(self, species: int) -> bytes | None:
        """PNG (folha de 3 quadros) da espécie. Guardado em memória: cada espécie é baixada uma vez só."""
        if species in self._sprites and (self._sprites[species] is not None or time.monotonic() - self._sprite_at.get(species, 0) < 600):
            return self._sprites[species]
        import aiohttp

        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=TIMEOUT_S), headers={"User-Agent": "PokeIdleManager"}) as s:
                async with s.get(f"{SITE}/assets/sprites/{int(species)}.png") as r:
                    body = await r.read() if r.status == 200 and "image" in (r.content_type or "") else None
        except Exception as e:  # noqa: BLE001
            raise HubError(f"sem sprite ({type(e).__name__})") from e
        if len(self._sprites) >= SPRITES_MAX:
            self._sprites.pop(next(iter(self._sprites)))
        self._sprites[species] = body if body and len(body) < 200_000 else None
        self._sprite_at[species] = time.monotonic()
        return self._sprites[species]

    async def serie(self, name: str, moeda: str, days: int) -> dict:
        from urllib.parse import urlencode

        q = urlencode({"nome": name, "moeda": MOEDA[moeda], "dias": min(max(1, days), MAX_DAYS)})
        data = await self.get(f"serie?{q}", TTL_SERIE_S)
        if not isinstance(data, dict) or not isinstance(data.get("pontos"), list):
            raise HubError("resposta inesperada do site")
        return data


# ------------------------------------------------------------------ conversão para o formato do painel
def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _kind(cat: str) -> str:
    return "item" if cat == "item" else "pokemon"


def _index(r: dict, moeda: str) -> dict | None:
    pts = ((r.get("inflacao") or {}).get("itensOuro" if moeda == "gold" else "itensGema")) or []
    pts = [{"day": p["dia"], "index": float(p["indice"])} for p in pts if isinstance(p, dict) and _num(p.get("indice")) is not None and p.get("dia")]
    if len(pts) < 2 or not pts[0]["index"]:
        return None
    return {"points": pts, "change": round((pts[-1]["index"] / pts[0]["index"] - 1) * 100, 1)}


def _change(g: dict) -> float | None:
    v = _num(g.get("variacao"))
    return None if v is None else round(v * 100, 1)


def normalize(r: dict, prev: dict | None, moeda: str, period: str, days: int, looks: dict[str, int],
              icon_of, now_ms: int, species: dict[str, int] | None = None, looks_sp: dict[int, int] | None = None) -> dict:
    """Resumo do site -> mesmo formato que `market_stats.overview` devolve."""
    mo = MOEDA[moeda]
    species = species or {}
    looks_sp = looks_sp or {}

    def sprite_of(name: str) -> tuple[int | None, int | None]:
        """(looktype, espécie): o looktype vem das vendas que o painel viu; a espécie, do índice do site."""
        sp = species.get(name)
        return looks.get(name) or (looks_sp.get(sp) if sp else None), sp

    trend = {}
    for g in (r.get("tendencias") or {}).get("todas") or []:
        if isinstance(g, dict) and g.get("moeda") == mo:
            trend[(g.get("nome"), _kind(g.get("categoria", "")), g.get("categoria") == "shiny")] = g

    def group(g: dict, spark_from: dict | None = None) -> dict | None:
        name = str(g.get("nome") or "").strip()
        if not name:
            return None
        cat = str(g.get("categoria") or "item")
        kind, shiny = _kind(cat), cat == "shiny"
        t = spark_from or trend.get((name, kind, shiny)) or {}
        vendas = int(g.get("vendas") or t.get("vendas") or 0)
        look, sp = sprite_of(name) if kind == "pokemon" else (None, None)
        return {"name": name, "kind": kind, "shiny": shiny, "look": look, "species": sp,
                "icon": icon_of(name) if kind == "item" else None, "sales": vendas,
                "units": int(g.get("unidades") or vendas), "volume": round(_num(g.get("volume")) or 0),
                "typical": _num(g.get("mediana")), "low": _num(g.get("p25")), "high": _num(g.get("p75")),
                "change": _change(t) if t and vendas >= MOVER_MIN_SALES else None,
                "spark": [x for x in (t.get("serie") or []) if _num(x) is not None][-14:]}

    groups = [x for x in (group(g) for g in r["maisVendidos"] if isinstance(g, dict) and g.get("moeda") == mo) if x]

    def movers(key: str) -> list[dict]:
        out = []
        for g in (r.get("tendencias") or {}).get(key) or []:
            if not isinstance(g, dict) or g.get("moeda") != mo or int(g.get("vendas") or 0) < MOVER_MIN_SALES:
                continue
            name = str(g.get("nome") or "").strip()
            cat = str(g.get("categoria") or "item")
            if not name:
                continue
            look, sp = sprite_of(name) if cat != "item" else (None, None)
            out.append({"name": name, "kind": _kind(cat), "shiny": cat == "shiny",
                        "look": look, "species": sp, "icon": icon_of(name) if cat == "item" else None,
                        "sales": int(g.get("vendas") or 0), "units": int(g.get("vendas") or 0), "volume": 0,
                        "typical": _num(g.get("depois")), "low": None, "high": None, "change": _change(g),
                        "spark": [x for x in (g.get("serie") or []) if _num(x) is not None][-14:]})
        return out[:TOP_MOVERS]

    t, p = r["totais"], (prev or {}).get("totais") or {}
    key = "ouro" if moeda == "gold" else "gema"
    prev_sales = (int(p.get("vendas") or 0) - int(t.get("vendas") or 0)) if prev else 0
    prev_vol = (int(p.get(key) or 0) - int(t.get(key) or 0)) if prev else 0
    cov = (r.get("cobertura") or {})
    ws = cov.get("ws") or {}
    return {
        "source": "hub", "priceKind": "median", "moeda": moeda, "period": period, "days": days, "now": now_ms,
        "coverage": {"first": ws.get("min"), "last": ws.get("max"), "count": int(cov.get("total") or 0)},
        "totals": {"sales": int(t.get("vendas") or 0), "volume": round(_num(t.get(key)) or 0),
                   "prevSales": max(prev_sales, 0), "prevVolume": max(prev_vol, 0)},
        "series": [], "hourly": False, "index": _index(r, moeda), "hours": [],
        "groups": groups[:TOP_GROUPS], "up": movers("sobem"), "down": movers("caem"),
    }


def normalize_serie(s: dict) -> list[dict]:
    out = []
    for p in s.get("pontos") or []:
        if not isinstance(p, dict) or not p.get("dia") or _num(p.get("mediana")) is None:
            continue
        out.append({"k": p["dia"], "sales": int(p.get("vendas") or 0), "units": int(p.get("unidades") or 0),
                    "volume": round(_num(p.get("volume")) or 0), "avg": round(float(p["mediana"]), 2),
                    "min": round(_num(p.get("p25")) or float(p["mediana"]), 2),
                    "max": round(_num(p.get("p75")) or float(p["mediana"]), 2)})
    return out
