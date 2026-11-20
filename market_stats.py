"""Análise do mercado: guarda as vendas do servidor inteiro e resume por período.

O jogo só entrega o histórico global das últimas ~1,3 hora (30 vendas por página, id crescente e único), então
um coletor lê as páginas novas a cada minuto, para no último id já gravado e guarda tudo no SQLite. Os resumos
(mais vendidos, preço médio, altas e quedas, volume por dia e por hora) saem de consultas sobre essa tabela.
O dia vale em horário de Brasília, como o do jogo.
"""
from __future__ import annotations

import re
import time
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from store import Store

FUSO_S = 3 * 3600
MAX_PAGES = 60                   # a profundidade real do jogo é ~40 páginas; passou disso, é laço
MOVER_MIN_SALES = 3              # alta/queda só vale com algumas vendas nos dois períodos
TOP_N = 60
PERIODS = {"24h": 1, "7d": 7, "30d": 30}
_QTY = re.compile(r"^\s*([\d.,]+)\s*[×x]\s*(.+?)\s*$")


def parse_sale(row: Any) -> tuple | None:
    """Uma linha do histórico global -> (id, ts, kind, moeda, price, qty, name, species, shiny, iv, level, look) ou None."""
    if not isinstance(row, dict):
        return None
    try:
        sid, ts, price = int(row["id"]), int(row["em"]), float(row["bruto"])
    except (KeyError, TypeError, ValueError):
        return None
    moeda = row.get("moeda")
    if moeda not in ("gold", "orb") or price < 0:
        return None
    tipo = row.get("tipo")
    if tipo == "pokemon":
        f = row.get("ficha") if isinstance(row.get("ficha"), dict) else {}
        name = str(f.get("nome") or re.sub(r"\s+Nv\s*\d+\s*$", "", str(row.get("descricao") or ""))).strip()
        if not name:
            return None
        return (sid, ts, "pokemon", moeda, price, 1, name, f.get("speciesId"), 1 if f.get("shiny") else 0,
                f.get("ivTotal"), f.get("level"), (f.get("lookShiny") if f.get("shiny") else None) or f.get("looktype"))
    if tipo == "item":
        desc = str(row.get("descricao") or "")
        m = _QTY.match(desc)
        try:
            qty = max(1, int(re.sub(r"[.,]", "", m.group(1)))) if m else 1
        except ValueError:
            qty = 1
        name = (m.group(2) if m else desc).strip()
        if not name:
            return None
        return (sid, ts, "item", moeda, price, qty, name, None, 0, None, None, None)
    return None


async def collect(svc, store: "Store") -> int:
    """Lê as vendas novas do histórico global e grava. Devolve quantas linhas entraram."""
    last = store.last_sale_id()
    added = 0
    prev_first = None
    for page in range(MAX_PAGES):
        res = await svc.history("global", page, {})
        rows = res.get("rows") or []
        ids = [r.get("id") for r in rows if isinstance(r, dict) and isinstance(r.get("id"), int)]
        if not ids or ids[0] == prev_first:
            break                                  # página vazia ou repetida: o jogo parou de entregar
        prev_first = ids[0]
        parsed = [p for p in (parse_sale(r) for r in rows) if p and p[0] > last]
        added += store.add_sales(parsed)
        if min(ids) <= last or res.get("hasMore") is False:
            break
    return added


# ------------------------------------------------------------------ resumos
def _bucket(days: int) -> tuple[str, int]:
    """Expressão SQL do balde do gráfico (hora para 24h, dia para o resto) e seu tamanho em segundos."""
    if days <= 1:
        return "strftime('%Y-%m-%d %H:00', ts/1000 - {f}, 'unixepoch')".format(f=FUSO_S), 3600
    return "strftime('%Y-%m-%d', ts/1000 - {f}, 'unixepoch')".format(f=FUSO_S), 86400


def _pct(cur: float | None, prev: float | None) -> float | None:
    if not cur or not prev:
        return None
    return round((cur - prev) / prev * 100, 1)


def _groups(store: "Store", kind: str, moeda: str, since: int, prev_since: int) -> list[dict]:
    rows = store.sales_query(
        """SELECT name, shiny, MAX(look) look, MAX(species) species,
                  SUM(CASE WHEN ts>=:s THEN 1 ELSE 0 END) sales,
                  SUM(CASE WHEN ts>=:s THEN qty ELSE 0 END) units,
                  SUM(CASE WHEN ts>=:s THEN price ELSE 0 END) volume,
                  MIN(CASE WHEN ts>=:s THEN price*1.0/qty END) mn,
                  MAX(CASE WHEN ts>=:s THEN price*1.0/qty END) mx,
                  SUM(CASE WHEN ts<:s THEN 1 ELSE 0 END) psales,
                  SUM(CASE WHEN ts<:s THEN qty ELSE 0 END) punits,
                  SUM(CASE WHEN ts<:s THEN price ELSE 0 END) pvolume
           FROM market_sales WHERE kind=:k AND moeda=:m AND ts>=:p GROUP BY name, shiny""",
        {"s": since, "p": prev_since, "k": kind, "m": moeda})
    out = []
    for r in rows:
        avg = r["volume"] / r["units"] if r["units"] else None
        pavg = r["pvolume"] / r["punits"] if r["punits"] else None
        out.append({"name": r["name"], "kind": kind, "shiny": bool(r["shiny"]), "look": r["look"], "species": r["species"], "icon": None,
                    "sales": r["sales"], "units": r["units"], "volume": round(r["volume"]),
                    "typical": round(avg, 2) if avg else None,
                    "low": round(r["mn"], 2) if r["mn"] is not None else None,
                    "high": round(r["mx"], 2) if r["mx"] is not None else None,
                    "change": _pct(avg, pavg) if r["sales"] >= MOVER_MIN_SALES and r["psales"] >= MOVER_MIN_SALES else None,
                    "spark": []})
    return out


def hours_of_day(store: "Store", moeda: str, since: int) -> list[dict]:
    """Vendas por hora do dia (horário de Brasília) desde `since`."""
    rows = store.sales_query(
        f"""SELECT CAST(strftime('%H', ts/1000 - {FUSO_S}, 'unixepoch') AS INTEGER) h, COUNT(*) sales, SUM(price) volume
            FROM market_sales WHERE moeda=:m AND ts>=:s GROUP BY h ORDER BY h""", {"m": moeda, "s": since})
    return [{"h": r["h"], "sales": r["sales"], "volume": round(r["volume"])} for r in rows]


def hours_from(store: "Store", since: int) -> int | None:
    """Desde quando há vendas guardadas dentro da janela (para avisar que os horários ainda são parciais)."""
    r = store.sales_query("SELECT MIN(ts) a FROM market_sales WHERE ts>=:s", {"s": since})[0]
    return r["a"]


_LOOKS: tuple[float, dict[str, int]] = (0.0, {})


def looks(store: "Store") -> dict[str, int]:
    """nome do Pokémon -> looktype (para o sprite), das vendas guardadas; em cache por 10 min."""
    global _LOOKS
    if time.monotonic() - _LOOKS[0] < 600 and _LOOKS[1]:
        return _LOOKS[1]
    rows = store.sales_query("SELECT name, MAX(look) look FROM market_sales WHERE kind='pokemon' AND shiny=0 AND look IS NOT NULL GROUP BY name", {})
    _LOOKS = (time.monotonic(), {r["name"]: r["look"] for r in rows})
    return _LOOKS[1]


def looks_by_species(store: "Store") -> dict[int, int]:
    """id da espécie -> looktype, das vendas guardadas (a mesma espécie tem o mesmo sprite em qualquer nome)."""
    rows = store.sales_query(
        "SELECT species, MAX(look) look FROM market_sales "
        "WHERE kind='pokemon' AND shiny=0 AND look IS NOT NULL AND species IS NOT NULL GROUP BY species", {})
    return {int(r["species"]): r["look"] for r in rows}


def overview(store: "Store", moeda: str, period: str, now_ms: int | None = None) -> dict:
    days = PERIODS.get(period, 7)
    now = now_ms if now_ms is not None else int(time.time() * 1000)
    span = days * 86_400_000
    since, prev_since = now - span, now - 2 * span
    bucket, _ = _bucket(days)

    cov = store.sales_query("SELECT MIN(ts) a, MAX(ts) b, COUNT(*) n FROM market_sales", {})[0]
    tot = store.sales_query(
        """SELECT SUM(CASE WHEN ts>=:s THEN 1 ELSE 0 END) sales, SUM(CASE WHEN ts>=:s THEN price ELSE 0 END) volume,
                  SUM(CASE WHEN ts<:s THEN 1 ELSE 0 END) psales, SUM(CASE WHEN ts<:s THEN price ELSE 0 END) pvolume
           FROM market_sales WHERE moeda=:m AND ts>=:p""", {"s": since, "p": prev_since, "m": moeda})[0]
    series = store.sales_query(
        f"""SELECT {bucket} k, kind, COUNT(*) sales, SUM(price) volume FROM market_sales
            WHERE moeda=:m AND ts>=:s GROUP BY k, kind ORDER BY k""", {"m": moeda, "s": since})
    by_k: dict[str, dict] = {}
    for r in series:
        o = by_k.setdefault(r["k"], {"k": r["k"], "sales": 0, "volume": 0, "itemVolume": 0, "pokemonVolume": 0})
        o["sales"] += r["sales"]
        o["volume"] += round(r["volume"])
        o["itemVolume" if r["kind"] == "item" else "pokemonVolume"] += round(r["volume"])
    hours_rows = hours_of_day(store, moeda, since)

    items = _groups(store, "item", moeda, since, prev_since)
    mons = _groups(store, "pokemon", moeda, since, prev_since)
    moved = [g for g in items + mons if g["change"] is not None]
    moved.sort(key=lambda g: g["change"])
    groups = sorted((g for g in items + mons if g["sales"]), key=lambda g: -g["sales"])
    return {
        "source": "local", "priceKind": "avg", "moeda": moeda, "period": period, "days": days, "now": now,
        "coverage": {"first": cov["a"], "last": cov["b"], "count": cov["n"]},
        "totals": {"sales": tot["sales"] or 0, "volume": round(tot["volume"] or 0),
                   "prevSales": tot["psales"] or 0, "prevVolume": round(tot["pvolume"] or 0)},
        "series": list(by_k.values()), "hourly": days <= 1, "index": None,
        "hours": hours_rows, "hoursFrom": hours_from(store, since),
        "groups": groups[:TOP_N],
        "up": [g for g in reversed(moved) if g["change"] > 0][:6],
        "down": [g for g in moved if g["change"] < 0][:6],
    }


def detail(store: "Store", kind: str, name: str, shiny: bool, moeda: str, period: str, now_ms: int | None = None) -> dict:
    days = PERIODS.get(period, 7)
    now = now_ms if now_ms is not None else int(time.time() * 1000)
    bucket, _ = _bucket(days)
    rows = store.sales_query(
        f"""SELECT {bucket} k, COUNT(*) sales, SUM(qty) units, SUM(price) volume,
                   MIN(price*1.0/qty) mn, MAX(price*1.0/qty) mx
            FROM market_sales WHERE kind=:k AND name=:n AND shiny=:sh AND moeda=:m AND ts>=:s GROUP BY k ORDER BY k""",
        {"k": kind, "n": name, "sh": 1 if shiny else 0, "m": moeda, "s": now - days * 86_400_000})
    return {"kind": kind, "name": name, "shiny": shiny, "moeda": moeda, "period": period, "hourly": days <= 1,
            "points": [{"k": r["k"], "sales": r["sales"], "units": r["units"], "volume": round(r["volume"]),
                        "avg": round(r["volume"] / r["units"], 2) if r["units"] else None,
                        "min": round(r["mn"], 2), "max": round(r["mx"], 2)} for r in rows]}
