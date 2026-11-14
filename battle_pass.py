"""Passe de Batalha do jogo: quando a conta pode resgatar o dia.

A trilha de prêmios (30 dias, grátis e premium) mora no painel (web/src/lib/pass.ts); aqui fica só a regra que o
servidor usa para não mandar um resgate que o jogo vai recusar. Port de `shared/passe-batalha.mjs` do cliente
oficial. O cliente resgata com `{"t": "passe.resgatar"}` e o jogo responde `{"t": "passe", "resgate": {...}}`."""
from __future__ import annotations

PASSE_DIAS = 30
PASSE_NIVEL_MIN = 10
PASSE_FUSO_MS = 3 * 60 * 60_000          # o dia do passe vira à meia-noite de Brasília
DIA_MS = 24 * 60 * 60_000


def dia_do_passe(ms: float) -> int:
    return int((float(ms) - PASSE_FUSO_MS) // DIA_MS)


def _int(v) -> int | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return int(f) if f == int(f) else None


def pode_resgatar(passe, agora_ms: float) -> bool:
    """Falta resgatar o dia de hoje (o grátis, ou o premium de uma conta que virou VIP depois de resgatar)."""
    p = passe if isinstance(passe, dict) else {}
    hoje = dia_do_passe(agora_ms)
    ultimo, degrau = _int(p.get("ultimo")), _int(p.get("degrau")) or 0
    ja_pegou = ultimo is not None and degrau >= 1 and ultimo == hoje
    if not ja_pegou:
        return True
    vip_ativo = (p.get("vipAte") or 0) > agora_ms
    return bool(vip_ativo and _int(p.get("ultimoVip")) != hoje)


def passe_publico(passe) -> dict | None:
    """O que o painel precisa do estado do passe da conta (None se o jogo ainda não mandou)."""
    if not isinstance(passe, dict):
        return None
    return {k: passe.get(k) for k in ("ultimo", "degrau", "ultimoVip", "vipAte", "ciclos", "total", "vipPegos")}
