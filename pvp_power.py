"""Poder de luta e tabuleiro do PVP, portados do cliente do jogo (`shared/ginasios.mjs`, `nota-pokemon.mjs`,
`pvp-tabuleiro.mjs`). O jogo calcula tudo isso no navegador; o painel precisa dos mesmos números para ordenar
a lista de Pokémon e mostrar o "Poder no PVP" da ficha.

Em vez de refazer o fator de nascença (qualidade, potência, shiny, lendário), ele é deduzido dos próprios stats que
o servidor mandou para a conta: `stat = round((base + 2*iv) * nível/100 * fator)`. Assim vale para qualquer Pokémon.
"""
from __future__ import annotations

import math

ARENA_FULL_LEVEL = 150
ARENA_EXPO = 0.45                 # ARENA_EXPO_GINASIO: o PVP usa o mesmo achatamento de nível do ginásio
POWER_SCALE = 1e7                 # GINASIO_ESCALA_FORCA
COMBAT_HP_MULT = 12
TM_POWER = 2800
TM_POWER_PVP = 1800
TM_COOLDOWN_MS = 60_000
BASIC_MOVE = {"power": 30, "cooldownMs": 2000, "category": "PHYSICAL", "type": None}
STATS = ("hp", "atk", "def", "spAtk", "spDef", "speed")
BASE_FIELD = {"hp": "baseHp", "atk": "baseAtk", "def": "baseDef", "spAtk": "baseSpAtk", "spDef": "baseSpDef", "speed": "baseSpeed"}
REFINABLE = ("hp", "atk", "def", "spAtk", "spDef")
POTENCY_BONUS = (0, 0.05, 0.1, 0.25, 1)
QUALITY_EXPO = {"hp": 0.95, "atk": 0.8, "def": 0.8, "spAtk": 0.8, "spDef": 0.8, "speed": 0.95}


def _round(x: float) -> int:
    return int(math.floor(x + 0.5))        # Math.round do JavaScript (meio para cima)


def arena_level(level) -> int:
    n = max(1, int(level or 1))
    if n <= ARENA_FULL_LEVEL:
        return n
    return max(ARENA_FULL_LEVEL, _round(ARENA_FULL_LEVEL * (n / ARENA_FULL_LEVEL) ** ARENA_EXPO))


def potency_mult(n) -> float:
    i = (_round(float(n)) or 1) - 1 if n else 0
    return 1 + (POTENCY_BONUS[i] if 0 <= i < len(POTENCY_BONUS) else 0)


def bases(esp: dict, refino) -> dict:
    r = refino if isinstance(refino, dict) else {}
    out = {}
    for k in STATS:
        v = esp.get(BASE_FIELD[k]) or 0
        if k in REFINABLE:
            v += max(0, int(r.get(k) or 0))
        out[k] = v
    return out


def birth_factors(pk: dict, esp: dict) -> dict:
    """Fator (qualidade^expoente × multiplicadores) de cada stat, deduzido dos stats atuais do Pokémon."""
    b = bases(esp, pk.get("refino"))
    ivs = pk.get("ivs") or {}
    stats = pk.get("stats") or {}
    level = max(1, int(pk.get("level") or 1))
    out = {}
    for k in STATS:
        raw = (b[k] + 2 * (ivs.get(k) or 1)) * level / 100
        cur = stats.get(k)
        q = float(pk.get("quality") or pk.get("qualidade") or 1)
        exact = q ** QUALITY_EXPO[k] * potency_mult(pk.get("potencia")) * (3 if pk.get("shiny") else 1)
        if isinstance(cur, (int, float)) and raw > 0:
            # a fórmula direta vale quando reproduz o stat do servidor (só falha em lendário/místico, que tem ×4)
            out[k] = exact if abs(raw * exact - cur) <= 1 else cur / raw
        else:
            out[k] = exact
    return out


def stats_at(pk: dict, esp: dict, level: int, factor_scale: float = 1.0) -> dict:
    b = bases(esp, pk.get("refino"))
    ivs = pk.get("ivs") or {}
    f = birth_factors(pk, esp)
    return {k: _round((b[k] + 2 * (ivs.get(k) or 1)) * (level / 100) * f[k] * factor_scale) for k in STATS}


def tm_move(tipo: str, physical: bool, pvp: bool) -> dict:
    return {"name": f"Z-Move {tipo}", "power": TM_POWER_PVP if pvp else TM_POWER, "type": tipo,
            "category": "PHYSICAL" if physical else "SPECIAL", "cooldownMs": TM_COOLDOWN_MS}


def _move_score(m: dict, level: int, st: dict, types: list[str]) -> float:
    atk = st["spAtk"] if m.get("category") == "SPECIAL" else st["atk"]
    dfn = st["spDef"] if m.get("category") == "SPECIAL" else st["def"]
    stab = 1.5 if m.get("type") in types else 1
    return (((2 * level) / 5 + 2) * (m.get("power") or 0) * (atk / max(1, dfn)) / 50 + 2) * stab


def best_move(esp: dict, level: int, st: dict, pk: dict, pvp: bool) -> dict:
    moves = [a for a in (esp.get("attacks") or []) if (a.get("learnLevel") or 1) <= level]
    tm = pk.get("tmElemental")
    if tm:
        moves.append(tm_move(str(tm), bool(pk.get("tmFisico")), pvp))
    if not moves:
        return BASIC_MOVE
    types = [t for t in (esp.get("type1"), esp.get("type2")) if t]
    best, best_score = BASIC_MOVE, -1.0
    for m in moves:
        score = _move_score(m, level, st, types)
        if score > best_score:
            best, best_score = m, score
    return best


def rating(pk: dict, esp: dict, level: int, pvp: bool, factor_scale: float = 1.0) -> float:
    st = stats_at(pk, esp, level, factor_scale)
    m = best_move(esp, level, st, pk, pvp)
    atk = max(st["atk"], st["spAtk"])
    dfn = (st["def"] + st["spDef"]) / 2
    dps = (((2 * level) / 5 + 2) * (m.get("power") or BASIC_MOVE["power"]) * atk) / 50 / (max(400, m.get("cooldownMs") or 2000) / 1000)
    return dps * max(24, _round(st["hp"] * COMBAT_HP_MULT)) * dfn


def pvp_power(pk: dict, esp: dict | None) -> int:
    """"Poder no PVP": a luta usa o nível achatado da arena (nível 2.064 conta como ~488)."""
    if not esp:
        return 1
    return max(1, _round(rating(pk, esp, arena_level(pk.get("level")), True) / POWER_SCALE))


def pve_power(pk: dict, esp: dict | None) -> int:
    """"Poder no PVE" da ficha: o mesmo cálculo, no nível real do Pokémon (sem o achatamento da arena)."""
    if not esp:
        return 1
    return max(1, _round(rating(pk, esp, max(1, int(pk.get("level") or 1)), False) / POWER_SCALE))


# --------------------------------------------------------------- tabuleiro
ROWS = ((13, 12, 17), (14, 11, 18), (15, 11, 18), (16, 13, 16), (17, 13, 16))     # (cy, de, ate) de cada fileira
HOUSES = [{"house": 0, "row": r, "col": cx - de, "cx": cx, "cy": cy}
          for r, (cy, de, ate) in enumerate(ROWS) for cx in range(de, ate + 1)]
for _i, _h in enumerate(HOUSES):
    _h["house"] = _i
TOTAL_HOUSES = len(HOUSES)
TEAM_MAX = 5

_F0 = [2, 3, 1, 4, 0, 5]
_F1 = [9, 10, 8, 11, 7, 12, 6, 13]
_F2_MID, _F2_SIDES, _F2_ENDS = [17, 18, 16, 19], [15, 20], [14, 21]
_F2 = [*_F2_MID, *_F2_SIDES, *_F2_ENDS]
_F3 = [23, 24, 22, 25]
_F4 = [27, 28, 26, 29]
PRIORITY = {
    1: [*_F0, *_F1, *_F2, *_F3, *_F4],
    2: [*_F1, *_F2, *_F0, *_F3, *_F4],
    3: [*_F2_MID, *_F3, *_F2_SIDES, *_F4, *_F2_ENDS, *_F1, *_F0],
    4: [*_F3, *_F2, *_F4, *_F1, *_F0],
}


def species_range(esp: dict | None) -> int:
    """Alcance no tabuleiro: 1 = corpo a corpo; 2 a 4 = a distância, pela folga do ataque especial."""
    if not esp:
        return 1
    try:
        gap = float(esp["baseSpAtk"]) - max(float(esp.get("baseAtk") or 0), float(esp.get("baseHp") or 0))
    except (KeyError, TypeError, ValueError):
        return 1
    if gap <= 0:
        return 1
    return 2 if gap < 25 else 3 if gap < 50 else 4


def fill_houses(requested: list, ranges: list[int]) -> list[int]:
    """Casa final de cada Pokémon: respeita as pedidas (válidas e sem repetir) e põe as demais pela prioridade do alcance."""
    n = min(TEAM_MAX, len(requested))
    out: list[int | None] = [None] * n
    used: set[int] = set()
    for i in range(n):
        c = requested[i]
        if isinstance(c, int) and not isinstance(c, bool) and 0 <= c < TOTAL_HOUSES and c not in used:
            out[i] = c
            used.add(c)
    for i in range(n):
        if out[i] is not None:
            continue
        order = PRIORITY[max(1, min(4, ranges[i] if i < len(ranges) else 1))]
        free = next(c for c in order if c not in used)
        out[i] = free
        used.add(free)
    return out  # type: ignore[return-value]
