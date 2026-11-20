"""Calculadora de Pokémon da ficha: nota de nascença (0 a 10), potencial na evolução final e peso de cada fator.

Porta da fórmula do cliente do jogo (`shared/nota-pokemon.mjs` e a tela da calculadora). A nota mede quão forte o
Pokémon NASCEU em comparação com os outros da MESMA espécie: IV, qualidade, potência e shiny entram numa soma de
stats de nascença, que vira nota numa escala logarítmica entre o pior e o melhor nascimento possíveis da espécie.
Treinar não muda a nota.
"""
from __future__ import annotations

import math
from typing import Callable

import pvp_power as pw
from evolucoes_ramificadas import RAMIFICADAS

STAT_KEYS = ("hp", "atk", "def", "spAtk", "spDef", "speed")
IV_POR_STAT = (1, 32)
IV_MIN = 6 * IV_POR_STAT[0]
IV_MAX = 6 * IV_POR_STAT[1]
QUALIDADE_MIN, QUALIDADE_MAX = 0.8, 1.8
POTENCIA_MIN, POTENCIA_MAX = 1, 5
MULT_SHINY = 3
MULT_LENDARIO = 4
REF_BASE = {k: 80 for k in STAT_KEYS}
GANHO_MIN_EVOLUCAO = 0.1            # evoluir nunca derruba a nota: ela vale ao menos a do pré-evoluído + 0,1 por passo
MERCADO_NOTA_MIN = 3.5
PODER_ESCALA_NIVEL = 10
FAIXAS = (
    ("extremamente-fraco", 1), ("fraco", 2), ("mediano", 3), ("razoavel", 4), ("bom", 5),
    ("forte", 6), ("poderoso", 7), ("mitico", 8), ("legendario", 9), ("divino", 10),
)
MEGA_FAIXA = (3000, 4000)          # pokeIds das formas Mega (3000 + dex)
OUTLAND_MIN = 13000

LENDARIO_DEX = frozenset({
    377, 378, 379, 380, 381, 382, 383, 384, 480, 481, 482, 483, 484, 485, 486, 487, 488,
    638, 639, 640, 641, 642, 643, 644, 645, 646, 716, 717, 718, 772, 773,
    785, 786, 787, 788, 789, 790, 791, 792, 793, 794, 795, 796, 797, 798, 799, 800, 803, 804, 805, 806,
    888, 889, 890, 891, 892, 894, 895, 896, 897, 898, 905,
    1001, 1002, 1003, 1004, 1007, 1008, 1009, 1010, 1014, 1015, 1016, 1017, 1020, 1021, 1022, 1023, 1024,
})
MITICO_DEX = frozenset({385, 386, 489, 490, 491, 492, 493, 647, 648, 649, 719, 720, 721, 801, 802, 807, 808, 809, 893, 1025})
KANTO_JOHTO_RAROS = frozenset({144, 145, 146, 150, 151, 243, 244, 245, 249, 250, 251, 494})


def _limitar(v: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, v))


def eh_lendario_ou_mitico(poke_id) -> bool:
    try:
        i = int(poke_id)
    except (TypeError, ValueError):
        return False
    dex = i % 1000 if i >= OUTLAND_MIN else (i - 3000 if MEGA_FAIXA[0] <= i < MEGA_FAIXA[1] else i)
    return dex in LENDARIO_DEX or dex in MITICO_DEX or dex in KANTO_JOHTO_RAROS


# ------------------------------------------------------------------ nota
def ivs_de_soma(soma) -> dict:
    s = int(_limitar(pw._round(float(soma or IV_MIN)), IV_MIN, IV_MAX))
    med, rest = divmod(s, 6)
    ivs = {k: med for k in STAT_KEYS}
    for i in range(rest):
        ivs[STAT_KEYS[i % 6]] += 1
    return ivs


def _bases(b: dict | None) -> dict:
    b = b or REF_BASE
    return {k: b.get(k) if b.get(k) is not None else REF_BASE[k] for k in STAT_KEYS}


def bases_da_especie(esp: dict | None) -> dict | None:
    if not esp:
        return None
    return {k: esp.get(pw.BASE_FIELD[k]) or 0 for k in STAT_KEYS}


def soma_nascimento(*, iv=None, ivs=None, qualidade, potencia, shiny=False, lendario=False, bases=None) -> int:
    b = _bases(bases)
    ivs = ivs if ivs is not None else ivs_de_soma(iv)
    q = _limitar(float(qualidade or 1), QUALIDADE_MIN, QUALIDADE_MAX)
    p = int(_limitar(pw._round(float(potencia or POTENCIA_MIN)), POTENCIA_MIN, POTENCIA_MAX))
    mult = pw.potency_mult(p) * (MULT_SHINY if shiny else 1) * (MULT_LENDARIO if lendario else 1)
    total = 0
    for k in STAT_KEYS:
        total += pw._round((b[k] + 2 * (float(ivs.get(k) or IV_POR_STAT[0]))) * (q ** pw.QUALITY_EXPO[k]) * mult)
    return total


def fatias_por_stat(*, ivs, qualidade, potencia, shiny, bases) -> list[dict]:
    """Quanto cada stat pesa na soma de nascença (para ver onde o Pokémon é forte)."""
    b = _bases(bases)
    q = _limitar(float(qualidade or 1), QUALIDADE_MIN, QUALIDADE_MAX)
    p = int(_limitar(pw._round(float(potencia or POTENCIA_MIN)), POTENCIA_MIN, POTENCIA_MAX))
    mult = pw.potency_mult(p) * (MULT_SHINY if shiny else 1)
    partes = [{"key": k, "valor": pw._round((b[k] + 2 * float(ivs.get(k) or 1)) * (q ** pw.QUALITY_EXPO[k]) * mult)} for k in STAT_KEYS]
    div = sum(x["valor"] for x in partes) or 1
    for x in partes:
        x["pct"] = x["valor"] / div
    return sorted(partes, key=lambda x: (-x["pct"], -x["valor"]))


def _limites_forca(bases: dict | None = None) -> tuple[float, float]:
    lo = soma_nascimento(iv=IV_MIN, qualidade=QUALIDADE_MIN, potencia=POTENCIA_MIN, shiny=False, bases=bases)
    hi = soma_nascimento(iv=IV_MAX, qualidade=QUALIDADE_MAX, potencia=POTENCIA_MAX, shiny=True, bases=bases)
    return max(1, lo), max(lo + 1, hi)


def _nota_de_forca(soma: float, limites: tuple[float, float]) -> float:
    lo, hi = limites
    s = _limitar(float(soma or lo), lo, hi)
    if hi <= lo:
        return 0.0
    bruta = 10 * (math.log(max(1, s)) - math.log(lo)) / (math.log(hi) - math.log(lo))
    return pw._round(_limitar(bruta, 0, 10) * 1000) / 1000


def _score_forca(*, limites_ref: bool = True, **p) -> float:
    args = {"iv": IV_MIN, "qualidade": QUALIDADE_MIN, "potencia": POTENCIA_MIN, "shiny": False, **p}
    limites = _limites_forca() if limites_ref else _limites_forca(args.get("bases"))
    return _limitar(_nota_de_forca(soma_nascimento(**args), limites) / 10, 0, 1)


def _limites_score_especie(bases: dict | None) -> tuple[float, float]:
    b = bases or REF_BASE
    lo = _score_forca(iv=IV_MIN, qualidade=QUALIDADE_MIN, potencia=POTENCIA_MIN, shiny=False, bases=b)
    hi = _score_forca(iv=IV_MAX, qualidade=QUALIDADE_MAX, potencia=POTENCIA_MAX, shiny=True, bases=b)
    return lo, max(lo, hi)


def _nota_de_score(score: float, limites: tuple[float, float]) -> float:
    lo, hi = limites
    s = _limitar(float(score or lo), lo, hi)
    if hi <= lo:
        return 0.0
    return pw._round(10 * (s - lo) / (hi - lo) * 1000) / 1000


def faixa_da_nota(n) -> str:
    try:
        v = float(n)
    except (TypeError, ValueError):
        return FAIXAS[0][0]
    return next((f for f, ate in FAIXAS if v <= ate), "divino")


def _eixos(args: dict) -> dict:
    """De onde vem a nota: quanto da força vem de IV, qualidade, potência e shiny (soma 100%)."""
    log_atual = math.log(soma_nascimento(**args))

    def ganho(patch: dict) -> float:
        s = soma_nascimento(**{**args, **patch})
        return max(0.0, log_atual - math.log(max(1, s)))

    d = {
        "iv": ganho({"ivs": ivs_de_soma(IV_MIN)}), "qualidade": ganho({"qualidade": QUALIDADE_MIN}),
        "potencia": ganho({"potencia": POTENCIA_MIN}), "shiny": ganho({"shiny": False}),
    }
    total = sum(d.values())
    div = total if total > 1e-9 else 1
    return {k: v / div for k, v in d.items()}


def nota_pokemon(*, iv=None, ivs=None, qualidade, potencia, shiny=False, bases=None, bases_limites=None, ancestrais=None) -> dict:
    """{nota, faixa, eixos}. `bases` já inclui o refino; `bases_limites` são as da espécie pura; `ancestrais` =
    [{bases, passos}] dos pré-evoluídos (a nota nunca fica abaixo da do pré-evoluído + 0,1 por passo)."""
    limites_esp = _limites_score_especie(bases_limites or bases)
    base_args = {"iv": iv, "ivs": ivs, "qualidade": qualidade, "potencia": potencia, "shiny": shiny}
    nota = _nota_de_score(_score_forca(**base_args, bases=bases), limites_esp)
    for anc in ancestrais or []:
        score_anc = _score_forca(**base_args, bases=anc["bases"])
        piso = min(10, _nota_de_score(score_anc, _limites_score_especie(anc["bases"])) + (anc.get("passos") or 1) * GANHO_MIN_EVOLUCAO)
        nota = max(nota, piso)
    nota = pw._round(nota * 1000) / 1000
    eixos_args = {"iv": iv if iv is not None else IV_MIN, "ivs": ivs, "qualidade": qualidade, "potencia": potencia, "shiny": shiny, "bases": bases}
    return {"nota": nota, "faixa": faixa_da_nota(nota), "eixos": _eixos(eixos_args)}


# ------------------------------------------------------------------ evolução
def _tem_arte(esp: dict) -> bool:
    """Espécies jogáveis: com sprite próprio do jogo (as sem arte ficam fora das projeções)."""
    lt = esp.get("looktype") or 1
    if lt <= 1:
        return False
    i = int(esp.get("pokeId") or 0)
    if MEGA_FAIXA[0] <= i < MEGA_FAIXA[1] or i >= OUTLAND_MIN:
        return True
    return not (1000 <= i < 13000 and lt != 60000 + i)


def _destinos(esp: dict, buscar: Callable[[int], dict | None]) -> list[dict]:
    out: list[dict] = []

    def juntar(pid, nivel):
        alvo = buscar(pid) if pid else None
        if alvo and all(d["pokeId"] != pid for d in out):
            out.append({"pokeId": pid, "nivel": nivel or 0, "especie": alvo})

    for pid, nivel in RAMIFICADAS.get(esp["pokeId"], []):
        juntar(pid, nivel)
    juntar(esp.get("evolvesToId"), esp.get("evolveLevel"))
    return out


def evolucoes_finais(esp: dict, buscar: Callable[[int], dict | None]) -> list[dict]:
    finais: dict[int, dict] = {}

    def dfs(e: dict, raiz: bool, vistos: frozenset) -> None:
        proximos = [d for d in _destinos(e, buscar) if _tem_arte(d["especie"]) and d["pokeId"] not in vistos]
        if not proximos:
            if not raiz:
                finais[e["pokeId"]] = e
            return
        for d in proximos:
            dfs(d["especie"], False, vistos | {e["pokeId"]})

    dfs(esp, True, frozenset())
    return list(finais.values())


def ancestrais_de(esp: dict, species: dict[int, dict]) -> list[dict]:
    """Pré-evoluídos (todos os degraus acima) com a distância em passos, para o piso da nota."""
    pais: dict[int, list[int]] = {}
    for e in species.values():
        for d in _destinos(e, species.get):
            pais.setdefault(d["pokeId"], []).append(e["pokeId"])
    out, visto, fila = [], {esp["pokeId"]}, [(esp["pokeId"], 0)]
    while fila:
        pid, n = fila.pop(0)
        for p in pais.get(pid, []):
            if p in visto or p not in species:
                continue
            visto.add(p)
            out.append({"bases": bases_da_especie(species[p]), "passos": n + 1})
            fila.append((p, n + 1))
    return out


# ------------------------------------------------------------------ resposta da ficha
def _proxima_faixa(nota: float) -> dict | None:
    i = next((n for n, (_, ate) in enumerate(FAIXAS) if nota <= ate), None)
    if i is None or i + 1 >= len(FAIXAS):
        return None
    return {"faixa": FAIXAS[i + 1][0], "falta": max(0.001, FAIXAS[i][1] - nota + 0.001)}


def _mercado_ok(nota: float | None, *, shiny: bool, potencia: int, lendario: bool) -> bool:
    return lendario or shiny or potencia >= POTENCIA_MAX or (nota is not None and nota >= MERCADO_NOTA_MIN - 1e-9)


def poder_ranking(pk: dict, esp: dict, *, nivel: int, lendario: bool) -> int:
    """⚔ do ranking: nível × 10 × a força de nascença (0 a 1)."""
    score = _score_forca(
        iv=sum(int(v or 0) for v in (pk.get("ivs") or {}).values()) or IV_MIN, ivs=pk.get("ivs"),
        qualidade=float(pk.get("quality") or 1), potencia=int(pk.get("potencia") or 1), shiny=bool(pk.get("shiny")),
        lendario=lendario, bases=pw.bases(esp, pk.get("refino")),
    )
    return max(1, pw._round(max(1, nivel) * PODER_ESCALA_NIVEL * score))


def calculadora(pk: dict, esp: dict | None, species: dict[int, dict]) -> dict | None:
    """Tudo que a aba Calculadora mostra para este Pokémon; None quando faltam dados (ficha incompleta)."""
    ivs = pk.get("ivs")
    if esp is None or not isinstance(ivs, dict) or not ivs:
        return None
    iv_total = sum(int(v or 0) for v in ivs.values())
    q = float(pk.get("quality") or 1)
    pot = int(_limitar(pk.get("potencia") or 1, POTENCIA_MIN, POTENCIA_MAX))
    shiny = bool(pk.get("shiny"))
    lend = eh_lendario_ou_mitico(esp["pokeId"])
    refino = pk.get("refino")
    base_esp = bases_da_especie(esp)
    nivel = max(1, int(pk.get("level") or 1))

    def projetar(alvo: dict) -> dict:
        b = bases_da_especie(alvo)
        return nota_pokemon(iv=iv_total, ivs=ivs, qualidade=q, potencia=pot, shiny=shiny,
                            bases=pw.bases(alvo, refino) if refino else b, bases_limites=b, ancestrais=ancestrais_de(alvo, species))

    out: dict = {"lendario": lend, "ivTotal": iv_total, "mercadoMin": MERCADO_NOTA_MIN}
    if not lend:
        r = projetar(esp)
        out.update(nota=r["nota"], faixa=r["faixa"], eixos=r["eixos"], proxima=_proxima_faixa(r["nota"]),
                   mercado=_mercado_ok(r["nota"], shiny=shiny, potencia=pot, lendario=False))
        out["stats"] = fatias_por_stat(ivs=ivs, qualidade=q, potencia=pot, shiny=shiny, bases=base_esp)
        finais = []
        for alvo in sorted(evolucoes_finais(esp, species.get), key=lambda a: str(a.get("name"))):
            p = projetar(alvo)
            finais.append({"pokeId": alvo["pokeId"], "name": alvo.get("name"), "looktype": alvo.get("looktype"),
                           "nota": p["nota"], "faixa": p["faixa"],
                           "mercado": _mercado_ok(p["nota"], shiny=shiny, potencia=pot, lendario=eh_lendario_ou_mitico(alvo["pokeId"]))})
        out["finais"] = finais
    mult_pot = pw.potency_mult(pot)
    out["combate"] = {
        "mult": mult_pot * (MULT_SHINY if shiny else 1) * (MULT_LENDARIO if lend else 1),
        "potencia": mult_pot, "shiny": MULT_SHINY if shiny else None, "lendario": MULT_LENDARIO if lend else None,
        "poderRanking": poder_ranking(pk, esp, nivel=nivel, lendario=lend),
        "poderGinasio": pw.pvp_power(pk, esp), "nivelGinasio": pw.arena_level(nivel),
    }
    return out
