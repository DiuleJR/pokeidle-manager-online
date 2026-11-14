import asyncio
import json

import pytest

import connection
from config import AccountConfig, Settings
from connection import AccountBlocked, AccountConnection, NetworkFull

ACC = AccountConfig(index=1, nick="Ash", token="tok_" + "a" * 20, device_id="dev-12345678", proxy=None)
SET = Settings("wss://x.example", frozenset({4001}), [])


class FakeWS:
    def __init__(self, frames):
        self._frames = frames

    def __aiter__(self):
        async def gen():
            for f in self._frames:
                yield json.dumps(f)
        return gen()


@pytest.fixture
def conn():
    return AccountConnection(ACC, SET)


@pytest.mark.parametrize("chave,kind", [
    ("auth.sessaoInvalida", "invalid"), ("auth.precisaLogin", "invalid"),
    ("auth.contaBanida", "banned"), ("auth.ipBanido", "net_banned"),
    ("auth.provedorBanido", "net_banned"), ("auth.contaExcluida", "deleted"),
    ("login.precisaNick", "needs_nick"),
])
def test_blocking_error_frames(conn, chave, kind):
    with pytest.raises(AccountBlocked) as e:
        conn._check_erro({"t": "erro", "chave": chave})
    assert e.value.kind == kind


def test_ban_reason_is_included(conn):
    with pytest.raises(AccountBlocked) as e:
        conn._check_erro({"t": "erro", "chave": "auth.contaBanida", "motivoBan": "uso de bug"})
    assert "uso de bug" in e.value.detail


def test_network_full_and_ignored_frames(conn):
    with pytest.raises(NetworkFull):
        conn._check_erro({"t": "erro", "chave": "login.limiteOnlineIp"})
    conn._check_erro({"t": "erro", "chave": "chat.espera"})  # erro de chat não bloqueia
    conn._check_erro({"t": "welcome"})
    conn._check_erro({})


def test_token_renewal_is_saved_and_used_in_next_hello(conn):
    seen = []
    conn.on_token_renewed = lambda i, t: seen.append((i, t))
    new = "novo_" + "b" * 20
    asyncio.run(conn._recv_loop(FakeWS([{"t": "sessao.renovada", "token": new}])))
    assert conn.acc.token == new and seen == [(1, new)]
    assert json.loads(conn._hello())["token"] == new


def test_error_frame_after_welcome_blocks(conn):
    with pytest.raises(AccountBlocked):
        asyncio.run(conn._recv_loop(FakeWS([{"t": "erro", "chave": "auth.contaBanida"}])))


def test_hello_shape():
    h = json.loads(connection.build_hello(ACC))
    assert h == {"t": "hello", "nick": "Ash", "token": ACC.token, "delta": 1, "dispositivo": "dev-12345678"}


def test_server_rare_item_notifies_once_per_gain(conn):
    sent = []
    conn.notifier = type("N", (), {"send": lambda self, *a, **k: sent.append((a, k))})()
    conn.itens_nossos = {70091: {"name": "Mystery Egg P2", "rare": True, "category": "special", "icon": "/img/egg.png"},
                         70050: {"name": "Pedra comum", "rare": True, "category": "stone"}}
    conn.estado["items"] = {"70091": 5, "70050": 1, "70000": 3}      # 70000 = Boss Token (não avisa)
    conn._rare_last = conn._rare_counts()
    conn._check_server_rares()
    assert sent == []                                                  # sem aumento: nada
    conn.estado["items"] = {"70091": 6, "70050": 9, "70000": 4}
    conn._check_server_rares()
    assert len(sent) == 1 and "1× Mystery Egg P2" in sent[0][0][1]
    assert sent[0][1]["thumbnail"].endswith("/img/egg.png")
    conn._check_server_rares()                                         # mesmo estado: não repete
    assert len(sent) == 1
    conn.estado["items"]["70091"] = 3                                  # gastar não avisa
    conn._check_server_rares()
    assert len(sent) == 1


class ClosableWS:
    def __init__(self):
        self.closed = None

    async def close(self, code=1000, reason=""):
        self.closed = (code, reason)


def test_frame_watchdog_reconnects_silent_session(conn, monkeypatch):
    """Sessão 'zumbi' (ping ok, nenhum frame do jogo com hunt ativa) é fechada para o supervisor reconectar."""
    monkeypatch.setattr(connection.config, "FRAME_CHECK_S", 0.01)
    monkeypatch.setattr(connection.config, "FRAME_SILENCE_S", 0.05)
    conn.estado["huntSlug"] = "larvitar"
    ws = ClosableWS()
    asyncio.run(asyncio.wait_for(conn._frame_watchdog(ws), 2))
    assert ws.closed and ws.closed[0] == 4000


def test_frame_watchdog_ignores_account_without_hunt(conn, monkeypatch):
    monkeypatch.setattr(connection.config, "FRAME_CHECK_S", 0.01)
    monkeypatch.setattr(connection.config, "FRAME_SILENCE_S", 0.05)
    ws = ClosableWS()
    with pytest.raises(asyncio.TimeoutError):
        asyncio.run(asyncio.wait_for(conn._frame_watchdog(ws), 0.3))
    assert ws.closed is None
