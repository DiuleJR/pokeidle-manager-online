"""Economia de rede e bateria: telemetria em delta e laços que dormem até haver trabalho."""
import asyncio

import pytest

import config
from pvp import PvpManager
from telemetry import delta_message


@pytest.fixture(autouse=True)
def _economia_volta_ao_padrao():
    config.set_economy_mode(False)
    yield
    config.set_economy_mode(False)


def _snap(ts, **accs):
    return {"type": "snapshot", "ts": ts, "accounts": [{"id": k, **v} for k, v in accs.items()]}


def test_primeira_mensagem_leva_tudo_e_a_igual_nao_leva_nada():
    s1 = _snap(1, acc1={"gold": 10, "hp": 5}, acc2={"gold": 3, "hp": 9})
    msg, last, order, changed = delta_message(s1, {}, [])
    assert changed and msg["delta"] is False and len(msg["accounts"]) == 2 and msg["order"] == ["acc1", "acc2"]

    msg, last, order, changed = delta_message(_snap(2, acc1={"gold": 10, "hp": 5}, acc2={"gold": 3, "hp": 9}), last, order)
    assert not changed and msg["accounts"] == [] and msg["delta"] is True and msg["ts"] == 2   # só a batida


def test_delta_leva_so_as_chaves_que_mudaram():
    _, last, order, _ = delta_message(_snap(1, acc1={"gold": 10, "hp": 5, "nick": "A"}, acc2={"gold": 3}), {}, [])
    msg, last, order, changed = delta_message(_snap(2, acc1={"gold": 10, "hp": 4, "nick": "A"}, acc2={"gold": 3}), last, order)
    assert changed and msg["accounts"] == [{"id": "acc1", "hp": 4}]


def test_conta_nova_vai_inteira_e_remocao_muda_a_ordem():
    _, last, order, _ = delta_message(_snap(1, acc1={"gold": 1}), {}, [])
    msg, last, order, changed = delta_message(_snap(2, acc1={"gold": 1}, acc2={"gold": 2}), last, order)
    assert changed and msg["accounts"] == [{"id": "acc2", "gold": 2}] and msg["order"] == ["acc1", "acc2"]
    msg, last, order, changed = delta_message(_snap(3, acc2={"gold": 2}), last, order)
    assert changed and msg["accounts"] == [] and msg["order"] == ["acc2"]       # a ordem mudou: o painel precisa saber


def test_websocket_manda_delta_e_obedece_o_aviso_de_aba_oculta(store, tmp_path, monkeypatch):
    from tests.test_auth import make, PW
    c, _ = make(store, tmp_path, monkeypatch)
    c.post("/api/auth/setup", json={"password": PW})
    config.set_economy_mode(True)
    with c.websocket_connect("/ws/telemetry") as ws:
        first = ws.receive_json()
        assert first["type"] == "snapshot" and first["delta"] is False and "order" in first and first["economy"] is True
        ws.send_json({"type": "visibility", "hidden": True})
        ws.send_json({"type": "visibility", "hidden": False})     # volta: o servidor acorda e manda na hora (batida)
        nxt = ws.receive_json()
        assert nxt["type"] == "snapshot" and nxt["accounts"] == []      # nada mudou: só a batida


def test_pvp_dorme_com_automatico_desligado_e_acorda_ao_ligar():
    async def go():
        config.set_economy_mode(True)
        pvp = PvpManager("acc", {}, auto=False)
        pvp._ws = None
        ticks = []

        async def fake_tick(level):
            ticks.append(level)

        pvp._tick = fake_tick                      # type: ignore[method-assign]

        async def noop():
            return None
        pvp.request_info = noop                    # type: ignore[method-assign]
        import pvp as mod
        mod.IDLE_TICK_S = 5.0
        task = asyncio.create_task(pvp.run_forever(lambda: 200))
        await asyncio.sleep(2.3)                   # 2 s de espera inicial: 1 ciclo; depois dorme
        base = len(ticks)
        await asyncio.sleep(1.5)
        assert len(ticks) == base                  # desligado: não acorda a cada segundo
        pvp.auto = True                            # ligar acorda o laço
        await asyncio.sleep(1.5)
        assert len(ticks) > base
        task.cancel()
    asyncio.run(go())


def test_padrao_continua_igual_snapshot_completo_a_cada_envio(store, tmp_path, monkeypatch):
    from tests.test_auth import make, PW
    c, _ = make(store, tmp_path, monkeypatch)
    c.post("/api/auth/setup", json={"password": PW})
    assert config.economy_mode() is False
    with c.websocket_connect("/ws/telemetry") as ws:
        a, b = ws.receive_json(), ws.receive_json()
    for m in (a, b):
        assert m["type"] == "snapshot" and "delta" not in m and m["economy"] is False


def test_pvp_padrao_confere_a_cada_segundo():
    async def go():
        pvp = PvpManager("acc", {}, auto=False)
        ticks = []

        async def fake_tick(level):
            ticks.append(level)

        async def noop():
            return None
        pvp._tick = fake_tick                      # type: ignore[method-assign]
        pvp.request_info = noop                    # type: ignore[method-assign]
        task = asyncio.create_task(pvp.run_forever(lambda: 200))
        await asyncio.sleep(5.2)                   # 2 s iniciais + ~3 ciclos de 1 s
        assert len(ticks) >= 3
        task.cancel()
    asyncio.run(go())


def test_configuracao_do_painel_liga_e_desliga(store, tmp_path, monkeypatch):
    from tests.test_auth import make, PW
    c, _ = make(store, tmp_path, monkeypatch)
    c.post("/api/auth/setup", json={"password": PW})
    assert c.get("/api/settings").json()["economy_mode"] is False
    assert c.put("/api/settings", json={"economy_mode": True}).json()["economy_mode"] is True
    assert config.economy_mode() is True
    assert c.put("/api/settings", json={"economy_mode": False}).json()["economy_mode"] is False
    assert config.economy_mode() is False
