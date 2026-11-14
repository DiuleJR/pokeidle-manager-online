"""Mapa do jogo para o painel: região de cada hunt e os níveis (tiers) de Outland.

Os tiers vêm do `welcome.outlandTiers` do jogo (com esta tabela como reserva, copiada do cliente oficial). O jogo
usa o tier escolhido pela conta (`estado.outlandTier`) só se o nível do treinador alcança; senão cai para o maior
tier liberado. O cliente troca o tier com `{"t": "outland.tier", "tier": N}`."""
from __future__ import annotations

DEFAULT_TIER = 1
DEFAULT_TIERS: list[dict] = [
    {"tier": 1, "rotulo": "Outland 1", "nivel": 150, "mult": 1},
    {"tier": 2, "rotulo": "Outland 2", "nivel": 1000, "mult": 1.25},
    {"tier": 3, "rotulo": "Outland 3", "nivel": 2000, "mult": 1.5},
    {"tier": 4, "rotulo": "Outland 4", "nivel": 4000, "mult": 2},
    {"tier": 5, "rotulo": "Outland 5", "nivel": 8000, "mult": 3},
    {"tier": 6, "rotulo": "Outland 6", "nivel": 16000, "mult": 4},
    {"tier": 7, "rotulo": "Outland 7", "nivel": 24000, "mult": 6},
    {"tier": 8, "rotulo": "Outland 8", "nivel": 36000, "mult": 8},
]


def normalize_tiers(raw) -> list[dict]:
    """Lista de tiers do welcome (ordenada); se vier vazia ou torta, usa a tabela padrão."""
    out = []
    for t in raw if isinstance(raw, list) else []:
        if not isinstance(t, dict) or not isinstance(t.get("tier"), int):
            continue
        out.append({"tier": t["tier"], "rotulo": str(t.get("rotulo") or f"Outland {t['tier']}"),
                    "nivel": int(t.get("nivel") or 0), "mult": t.get("mult") or 1})
    out.sort(key=lambda t: t["tier"])
    return out or [dict(t) for t in DEFAULT_TIERS]


def effective_tier(tiers: list[dict], chosen, level) -> dict:
    """O tier em vigor: o escolhido se o nível alcança; senão o maior liberado (ou o primeiro)."""
    try:
        chosen, level = int(chosen or DEFAULT_TIER), int(level or 0)
    except (TypeError, ValueError):
        chosen, level = DEFAULT_TIER, 0
    pick = next((t for t in tiers if t["tier"] == chosen), tiers[0])
    if level >= pick["nivel"]:
        return pick
    free = [t for t in tiers if level >= t["nivel"]]
    return free[-1] if free else tiers[0]


# ---------------------------------------------------------------- regiões
REGION_LABELS = {"kanto": "Kanto", "outland": "Outland", "johto": "Johto", "hoenn": "Hoenn", "sinnoh": "Sinnoh",
                 "unova": "Unova", "kalos": "Kalos", "alola": "Alola", "galar": "Galar", "paldea": "Paldea",
                 "orre": "Orre"}
_GENERATIONS = [(1, 151, "kanto"), (152, 251, "johto"), (252, 386, "hoenn"), (387, 493, "sinnoh"), (494, 649, "unova"),
                (650, 721, "kalos"), (722, 809, "alola"), (810, 905, "galar"), (906, 1025, "paldea")]


def _dex(poke_id: int) -> int | None:
    if poke_id <= 1025:
        return poke_id
    if 13000 <= poke_id < 14000:
        return poke_id - 13000          # clones de Orre
    if 2000 <= poke_id < 13000:
        return None                     # Outland, megas e formas ficam de fora
    return poke_id % 1000


def _generation(hunt: dict) -> str | None:
    """A geração que manda na hunt: a das espécies com mais pontos de spawn (mesma regra do painel do mapa)."""
    weight: dict[str, int] = {}
    for e in hunt.get("especies") or []:
        dex = _dex(int(e.get("pokeId") or 0)) if isinstance(e, dict) else None
        gen = next((g for a, b, g in _GENERATIONS if dex is not None and a <= dex <= b), None)
        if gen:
            weight[gen] = weight.get(gen, 0) + (e.get("pontos") or 1)
    return max(weight, key=weight.get) if weight else None


def region_of_hunt(hunt: dict | None) -> str | None:
    """Id da região (kanto, outland, johto, hoenn...) de uma hunt do catálogo do jogo; None se não der para saber."""
    if not isinstance(hunt, dict):
        return None
    reg = str(hunt.get("regiao") or "").lower()
    if reg:
        return "outland" if reg.startswith("outland") else reg
    area = str(hunt.get("area") or "").lower()
    if area == "outland":
        return "outland"
    return _generation(hunt) or area or None
