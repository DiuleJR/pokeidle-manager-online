import asyncio
import json
import time

import pytest
from fastapi.testclient import TestClient

import chat
from auth import Auth
from chat import ChatError, ChatHub, normalize
from config import build_account_config
from connection import AccountConnection, State
from manager import AccountManager
from notify import DailyStats, Notifier
from telemetry import create_app

KEY = "chave-de-teste"
H = {"Authorization": f"Bearer {KEY}"}
TOKEN = "tok_" + "z" * 30


class FakeWS:
    def __init__(self):
        self.sent = []

    async def send(self, raw):
        self.sent.append(json.loads(raw))


def msg(i, texto="oi", canal="mundo", **extra):
    return {"t": "chat", "id": i, "ts": 1000 + i, "canal": canal, "idioma": "pt", "de": "Ash", "nivel": 50, "texto": texto, **extra}


@pytest.fixture
def env(store, tmp_path, monkeypatch):
    mgr = AccountManager(store, Notifier(""), DailyStats(path=str(tmp_path / "d.json")))

    def fake_spawn(self, row):
        conn = AccountConnection(build_account_config(row), self.settings(), self.notifier, self.daily)
        conn.on_chat = self.chat.handle_frame
        self._conns[conn.acc.index] = conn

    monkeypatch.setattr(AccountManager, "_spawn", fake_spawn)
    acc_id = mgr.add({"nick": "Ash", "token": TOKEN, "device_id": "dev-12345678"})
    conn = mgr.get(acc_id)
    conn.state = State.ONLINE
    conn.hunt._ws = FakeWS()
    conn.estado.update({"level": 300})
    app = create_app(mgr.connections, Auth(store, exposed=False, env_token=KEY), manager=mgr, store=store)
    return TestClient(app), conn, acc_id, mgr


# ------------------------------------------------------------ leitura
def test_normalize_plain_and_specials():
    assert normalize(msg(1))["text"] == "oi"
    assert normalize(msg(2, texto=None, shinyCaptura={"nick": "Ana", "nome": "Eevee"}))["kind"] == "shiny"
    ad = normalize(msg(3, texto=None, anuncioChat={"id": 9, "nome": "Common Bicycle", "qtd": 1, "preco": 1157, "moeda": "orb"}))
    assert ad["kind"] == "ad" and "1.157 Gemas" in ad["text"] and ad["text"].startswith("estou anunciando")
    assert ad["ad"] == {"qtd": 1, "nome": "Common Bicycle", "preco": "1.157", "moeda": "gemas"}


def test_normalize_keeps_role_and_guild_colour_but_only_safe_values():
    m = normalize(msg(1, cargo="VIP", guildTag="DL", guildTagCor="#ff8800"))
    assert m["cargo"] == "vip" and m["guild"] == "DL" and m["guildColor"] == "#ff8800"
    bad = normalize(msg(2, cargo="vip\" onclick=\"x", guildTagCor="red;background:url(x)"))
    assert bad["cargo"] == "viponclickx" and bad["guildColor"] is None      # nada que escape de uma classe/cor


def test_normalize_drops_junk():
    assert normalize({"t": "chat", "texto": "sem id", "canal": "mundo"}) is None
    assert normalize(msg(1, canal="guild")) is None              # guild fica de fora
    assert normalize(msg(1, idioma="en")) is None                # só português
    assert normalize(msg(1, texto="   ")) is None
    assert normalize(msg(1, apagada=True)) is None


def test_hub_dedupes_across_accounts_and_caps_buffer(env):
    _, conn, _, mgr = env
    hub = mgr.chat
    for _ in range(3):                                           # a mesma mensagem chega por várias contas
        hub.handle_frame(conn, msg(1))
    assert len(hub.messages("mundo")) == 1
    for i in range(2, chat.BUFFER_MAX + 20):
        hub.handle_frame(conn, msg(i))
    assert len(hub.messages("mundo")) == chat.BUFFER_MAX
    hub.handle_frame(conn, msg(chat.BUFFER_MAX + 19))            # id repetido segue ignorado
    assert len(hub.messages("mundo")) == chat.BUFFER_MAX


def test_history_merges_and_sorts_and_delete(env):
    _, conn, _, mgr = env
    hub = mgr.chat
    hub.handle_frame(conn, msg(10))
    hub.handle_frame(conn, {"t": "chat.historico", "canal": "mundo", "mensagens": [msg(3), msg(5), msg(10)]})
    assert [m["id"] for m in hub.messages("mundo")] == [3, 5, 10]
    hub.handle_frame(conn, {"t": "chat.del", "id": 5})
    assert [m["id"] for m in hub.messages("mundo")] == [3, 10]


def test_subscribers_get_events_and_slow_ones_are_dropped(env):
    _, conn, _, mgr = env
    hub = mgr.chat
    q = hub.subscribe()
    hub.handle_frame(conn, msg(1))
    assert q.get_nowait()["type"] == "chat"
    for i in range(2, chat.SUB_QUEUE_MAX + 5):
        hub.handle_frame(conn, msg(i))
    assert q not in hub._subs                                    # fila cheia: assinante removido


def test_history_requested_once_per_empty_channel(env):
    _, conn, _, mgr = env
    asyncio.run(mgr.chat.on_online(conn))
    asyncio.run(mgr.chat.on_online(conn))                        # logo depois: não repete
    pedidos = [f for f in conn.hunt._ws.sent if f["t"] == "chat.historico"]
    assert sorted(f["canal"] for f in pedidos) == sorted(chat.CHANNELS)


# ------------------------------------------------------------ envio
def test_send_validations(env):
    _, conn, _, mgr = env
    hub = mgr.chat
    ok = lambda t, **k: hub.check_send(conn, k.get("canal", "mundo"), t, now=k.get("now", 1000.0))
    assert ok("  olá   mundo ") == "olá mundo"
    for texto, code in (("", "empty"), ("x" * 201, "long"), ("veja https://x.com", "link"), ("entra em discord.gg/abc", "link"),
                        ("meu site é foo.com", "link")):
        with pytest.raises(ChatError) as e:
            ok(texto)
        assert e.value.code == code
    with pytest.raises(ChatError) as e:
        ok("oi", canal="guild")
    assert e.value.code == "channel"


def test_send_level_mute_offline(env):
    _, conn, _, mgr = env
    hub = mgr.chat
    conn.estado["level"] = 9
    with pytest.raises(ChatError, match="nível"):
        hub.check_send(conn, "mundo", "oi")
    conn.estado["level"] = 50
    conn.chat_mute_until = time.time() * 1000 + 60_000
    with pytest.raises(ChatError) as e:
        hub.check_send(conn, "mundo", "oi")
    assert e.value.code == "muted"
    conn.chat_mute_until = 0
    conn.state = State.DISCONNECTED
    with pytest.raises(ChatError) as e:
        hub.check_send(conn, "mundo", "oi")
    assert e.value.code == "offline" and e.value.status == 409


def test_rate_limit_and_duplicates(env):
    _, conn, _, mgr = env
    hub = mgr.chat
    asyncio.run(hub.send(conn, "mundo", "primeira"))
    with pytest.raises(ChatError) as e:
        hub.check_send(conn, "mundo", "segunda")                 # logo em seguida: rígido
    assert e.value.code == "rate" and e.value.wait > 0
    later = time.monotonic() + chat.SEND_GAP_S + 0.1
    with pytest.raises(ChatError) as e:
        hub.check_send(conn, "mundo", "PRIMEIRA", now=later)     # mesma frase em 30 s
    assert e.value.code == "dup"
    assert hub.check_send(conn, "mundo", "outra frase", now=later) == "outra frase"


def test_send_goes_to_the_game_with_language(env):
    _, conn, _, mgr = env
    asyncio.run(mgr.chat.send(conn, "comercio", "vendo item"))
    assert conn.hunt._ws.sent[-1] == {"t": "chat.send", "canal": "comercio", "idioma": "pt", "texto": "vendo item"}


def test_mute_frame_blocks_that_account_only(env):
    _, conn, _, mgr = env
    mgr.chat.handle_frame(conn, {"t": "chat.mute", "ate": time.time() * 1000 + 60_000})
    with pytest.raises(ChatError) as e:
        mgr.chat.check_send(conn, "mundo", "oi")
    assert e.value.code == "muted"


# ------------------------------------------------------------ rotas
def test_routes_require_login(env):
    c, _, acc_id, _ = env
    assert c.get("/api/chat").status_code == 401
    assert c.post("/api/chat/send", json={"account": acc_id, "canal": "mundo", "texto": "oi"}).status_code == 401


def test_history_route(env):
    c, conn, _, mgr = env
    mgr.chat.handle_frame(conn, msg(1, "olá"))
    j = c.get("/api/chat?canal=mundo", headers=H).json()
    assert j["messages"][0]["text"] == "olá" and j["limits"]["gapS"] == chat.SEND_GAP_S
    assert c.get("/api/chat?canal=guild", headers=H).status_code == 400


def test_send_route(env):
    c, conn, acc_id, _ = env
    r = c.post("/api/chat/send", json={"account": acc_id, "canal": "mundo", "texto": "oi gente"}, headers=H)
    assert r.json() == {"ok": True} and conn.hunt._ws.sent[-1]["texto"] == "oi gente"
    r = c.post("/api/chat/send", json={"account": acc_id, "canal": "mundo", "texto": "de novo"}, headers=H)
    assert r.status_code == 429 and r.json()["code"] == "rate"
    r = c.post("/api/chat/send", json={"account": 99, "canal": "mundo", "texto": "oi"}, headers=H)
    assert r.status_code == 404


def test_ws_sends_init_and_live_messages(env):
    c, conn, _, mgr = env
    mgr.chat.handle_frame(conn, msg(1, "antes"))
    with c.websocket_connect(f"/ws/chat?token={KEY}") as ws:
        init = ws.receive_json()
        assert init["type"] == "init" and init["messages"]["mundo"][0]["text"] == "antes"
        mgr.chat.handle_frame(conn, msg(2, "agora"))
        ev = ws.receive_json()
        assert ev["type"] == "chat" and ev["msg"]["text"] == "agora"


def test_community_reads_invite_and_survives_failure(env, monkeypatch):
    c, _, _, _ = env

    class Boom:
        def __init__(self, *a, **k):
            raise OSError("sem rede")

    import aiohttp
    monkeypatch.setattr(aiohttp, "ClientSession", Boom)
    j = c.get("/api/community", headers=H).json()
    assert j["url"] == "https://discord.gg/pFVashEjtH" and j["online"] is None
