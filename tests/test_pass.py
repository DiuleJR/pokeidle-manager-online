import pytest

import actions_api
from battle_pass import DIA_MS, PASSE_FUSO_MS, dia_do_passe, passe_publico, pode_resgatar
from connection import State

from tests.test_actions_api import env, H  # noqa: F401  (fixture e cabeçalho de autenticação)

HOJE_MS = 20_000 * DIA_MS + PASSE_FUSO_MS + 5_000        # 5 s depois da virada do dia do passe


def test_day_boundary_is_brasilia_midnight():
    assert dia_do_passe(HOJE_MS) == 20_000
    assert dia_do_passe(HOJE_MS - 10_000) == 19_999       # 10 s antes da virada ainda é o dia anterior


def test_can_claim_rules():
    hoje = dia_do_passe(HOJE_MS)
    assert pode_resgatar(None, HOJE_MS)                                          # nunca resgatou
    assert pode_resgatar({"ultimo": hoje - 1, "degrau": 3}, HOJE_MS)             # resgatou ontem
    assert not pode_resgatar({"ultimo": hoje, "degrau": 3}, HOJE_MS)             # já resgatou hoje
    vip = {"ultimo": hoje, "degrau": 3, "vipAte": HOJE_MS + 10 * DIA_MS}
    assert pode_resgatar({**vip, "ultimoVip": hoje - 1}, HOJE_MS)                # virou VIP depois: falta o premium
    assert not pode_resgatar({**vip, "ultimoVip": hoje}, HOJE_MS)


def test_public_pass_state():
    assert passe_publico(None) is None
    assert passe_publico({"ultimo": 1, "degrau": 2, "x": 9})["degrau"] == 2


def test_claim_route_confirmed_by_game_reply(env, monkeypatch):  # noqa: F811
    c, conn, acc_id, _ = env
    monkeypatch.setattr(actions_api, "PASS_CLAIM_TIMEOUT_S", 1.0)
    monkeypatch.setattr(type(conn), "server_now_ms", lambda self: HOJE_MS)
    conn.estado["passe"] = {"ultimo": dia_do_passe(HOJE_MS) - 1, "degrau": 1}
    orig = conn.hunt._ws.send

    async def reply(raw):                                  # o jogo responde ao resgate
        await orig(raw)
        conn._on_pass({"t": "passe", "resgate": {"degrau": 2, "premios": [{"trilha": "free", "tipo": "coins", "qtd": 5}]}})
    conn.hunt._ws.send = reply
    r = c.post(f"/api/accounts/{acc_id}/pass/claim", headers=H).json()
    assert r["confirmed"] is True and r["claim"]["degrau"] == 2
    assert conn.hunt._ws.sent == [{"t": "passe.resgatar"}]


def test_claim_route_rejections(env, monkeypatch):  # noqa: F811
    c, conn, acc_id, _ = env
    monkeypatch.setattr(type(conn), "server_now_ms", lambda self: HOJE_MS)
    hoje = dia_do_passe(HOJE_MS)
    conn.estado["passe"] = {"ultimo": hoje, "degrau": 4}
    assert c.post(f"/api/accounts/{acc_id}/pass/claim", headers=H).status_code == 409      # já resgatado hoje
    conn.estado["level"] = 5
    assert c.post(f"/api/accounts/{acc_id}/pass/claim", headers=H).status_code == 400      # nível baixo
    conn.state = State.DISCONNECTED
    assert c.post(f"/api/accounts/{acc_id}/pass/claim", headers=H).status_code == 409      # offline
    assert c.post("/api/accounts/99/pass/claim", headers=H).status_code == 404


def test_snapshot_carries_pass_state(env):  # noqa: F811
    from telemetry import account_snapshot
    _, conn, _, _ = env
    conn.estado["passe"] = {"ultimo": 7, "degrau": 3, "total": 12, "vipAte": 0, "extra": "x"}
    snap = account_snapshot(conn)["pass"]
    assert snap["degrau"] == 3 and snap["total"] == 12 and "extra" not in snap
