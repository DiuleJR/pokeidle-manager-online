"""Guarda de decisões AutoHunt. O ranking é produzido pelo motor /hunt do painel.

Esta etapa não executa o simulador no servidor: aceita sugestões autenticadas
do painel e deixa a troca para a fila de combate existente. Nunca mascara essa
limitação como cálculo autônomo com o navegador fechado.
"""
from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class AutoHuntPolicy:
    enabled: bool = False
    metric: str = "xp"
    min_gain_pct: int = 15
    cooldown_minutes: int = 15


def decide(
    policy: AutoHuntPolicy, *,
    current_slug: str | None,
    target_slug: str,
    current_rate: float,
    target_rate: float,
    pending_slug: str | None,
    elapsed_seconds: float,
) -> tuple[bool, str]:
    """Decisão determinística e sem efeitos colaterais, fácil de testar."""
    if not policy.enabled:
        return False, "desligado"
    if policy.metric not in ("xp", "ouro"):
        return False, "métrica inválida"
    if not target_slug or target_slug == current_slug:
        return False, "já está na melhor hunt"
    if pending_slug:
        return False, "troca anterior pendente"
    if not all(math.isfinite(v) and v >= 0 for v in (current_rate, target_rate)):
        return False, "rendimento inválido"
    if target_rate <= 0:
        return False, "rendimento indisponível"
    if current_rate > 0 and target_rate < current_rate * (1 + policy.min_gain_pct / 100):
        return False, "melhoria abaixo do mínimo"
    if elapsed_seconds < policy.cooldown_minutes * 60:
        return False, "intervalo entre trocas"
    return True, "troca autorizada"
