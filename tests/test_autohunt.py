"""Testes da política de decisão, independentes de conexão com o jogo."""
from dataclasses import replace

import pytest

from autohunt import AutoHuntPolicy, decide


BASE = AutoHuntPolicy(enabled=True, metric="xp", min_gain_pct=15, cooldown_minutes=10)


def check(**kw):
    args = dict(
        current_slug="kanto-1", target_slug="kanto-2",
        current_rate=100, target_rate=130,
        pending_slug=None, elapsed_seconds=1000,
    )
    args.update(kw)
    return decide(BASE, **args)


def test_default_disabled():
    assert decide(AutoHuntPolicy(), current_slug="a", target_slug="b",
                  current_rate=100, target_rate=200, pending_slug=None, elapsed_seconds=9999)[0] is False


@pytest.mark.parametrize("override,reason", [
    ({"target_slug": "kanto-1"}, "já está na melhor hunt"),
    ({"pending_slug": "kanto-3"}, "troca anterior pendente"),
    ({"target_rate": float("nan")}, "rendimento inválido"),
    ({"target_rate": float("inf")}, "rendimento inválido"),
    ({"target_rate": -1}, "rendimento inválido"),
    ({"target_rate": 0}, "rendimento indisponível"),
    ({"target_rate": 114}, "melhoria abaixo do mínimo"),
    ({"elapsed_seconds": 599}, "intervalo entre trocas"),
])
def test_guards(override, reason):
    assert check(**override) == (False, reason)


def test_accepts_exact_threshold_and_cooldown():
    assert check(target_rate=115, elapsed_seconds=600) == (True, "troca autorizada")


def test_zero_baseline_can_recover():
    assert check(current_rate=0, target_rate=15)[0] is True


def test_invalid_metric_rejected():
    assert decide(replace(BASE, metric="shiny"), current_slug="a", target_slug="b",
                  current_rate=100, target_rate=200, pending_slug=None, elapsed_seconds=1000)[0] is False
