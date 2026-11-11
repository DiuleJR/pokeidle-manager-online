import json

import pytest
from fastapi.testclient import TestClient

import actions_api
from auth import Auth
from config import build_account_config
from connection import AccountConnection, State
from hunt import HuntSession
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


@pytest.fixture
def env(store, tmp_path, monkeypatch):
    mgr = AccountManager(store, Notifier(""), DailyStats(path=str(tmp_path / "d.json")))

    def fake_spawn(self, row):  # conexão real do projeto, mas sem rede
        conn = AccountConnection(build_account_config(row), self.settings(), self.notifier, self.daily)
        self._conns[conn.acc.index] = conn

    monkeypatch.setattr(AccountManager, "_spawn", fake_spawn)
    acc_id = mgr.add({"nick": "Ash", "token": TOKEN, "device_id": "dev-12345678"})
    conn = mgr.get(acc_id)
    conn.state = State.ONLINE
    conn.hunt._ws = FakeWS()
    conn.shop._ws = conn.hunt._ws  # mesmo "socket": o que o shop envia cai na mesma lista
    conn.estado.update({
        "level": 300, "huntSlug": "shellder", "balls": {"1": 50, "4": 0}, "items": {"200": 9},
        "automation": {"autoPotion": True, "potionIds": [200], "ballIds": [1], "hpLimiar": 0.4, "lootTravado": [7]},
    })
    conn.hunts.extend([
        {"slug": "shellder", "nome": "Shellder", "area": "kanto", "nivel": 30,
         "especies": [{"pokeId": 90, "nome": "Shellder", "pontos": 15}], "totalSpawns": 15, "pixel": [1, 2]},
        {"slug": "lapras", "nome": "Lapras", "area": "outland", "nivel": 150, "especies": [], "totalSpawns": 5},
    ])
    conn.hunt.session = HuntSession(slug="shellder")
    app = create_app(mgr.connections, Auth(store, exposed=False, env_token=KEY), manager=mgr, store=store)
    return TestClient(app), conn, acc_id, store


def test_requires_login(env):
    c, _, acc_id, _ = env
    assert c.get("/api/hunts").status_code == 401
    assert c.post(f"/api/accounts/{acc_id}/equip", json={"kind": "ball", "id": 1}).status_code == 401


def test_hunts_catalog(env):
    c, _, _, _ = env
    j = c.get("/api/hunts", headers=H).json()
    assert j["account"] == "acc1" and j["level"] == 300 and j["current"] == "shellder"
    assert [h["slug"] for h in j["hunts"]] == ["shellder", "lapras"]
    assert j["hunts"][0]["especies"][0]["nome"] == "Shellder"


def test_select_hunt_confirmed_by_game_event(env, monkeypatch):
    c, conn, acc_id, _ = env
    monkeypatch.setattr(actions_api, "HUNT_CONFIRM_TIMEOUT_S", 1.0)
    conn.hunt.session = HuntSession(slug="lapras")  # o jogo já confirmou (k:"hunt")
    r = c.post(f"/api/accounts/{acc_id}/hunt", json={"slug": "lapras"}, headers=H).json()
    assert r == {"ok": True, "confirmed": True, "slug": "lapras"}
    assert conn.hunt._ws.sent == [{"t": "hunt.select", "slug": "lapras"}]


def test_select_hunt_not_confirmed_when_game_ignores(env, monkeypatch):
    c, conn, acc_id, _ = env
    monkeypatch.setattr(actions_api, "HUNT_CONFIRM_TIMEOUT_S", 0.5)
    r = c.post(f"/api/accounts/{acc_id}/hunt", json={"slug": "lapras"}, headers=H).json()
    assert r["ok"] is True and r["confirmed"] is False


def test_select_hunt_rejects_unknown_and_offline(env):
    c, conn, acc_id, _ = env
    assert c.post(f"/api/accounts/{acc_id}/hunt", json={"slug": "nao-existe"}, headers=H).status_code == 400
    conn.state = State.DISCONNECTED
    assert c.post(f"/api/accounts/{acc_id}/hunt", json={"slug": "lapras"}, headers=H).status_code == 409
    assert c.post("/api/accounts/99/hunt", json={"slug": "lapras"}, headers=H).status_code == 404


def test_equip_ball_sends_full_automation_and_buys_when_empty(env):
    c, conn, acc_id, store = env
    r = c.post(f"/api/accounts/{acc_id}/equip", json={"kind": "ball", "id": 4}, headers=H).json()
    assert r["ok"] and r["stock"] == 0 and r["willBuy"] is True and r["buyable"] is True
    auto = [m for m in conn.hunt._ws.sent if m["t"] == "auto.set"][0]
    # só ballIds muda; o resto da automação segue como o jogo mandou
    assert auto["ballIds"] == [4] and auto["potionIds"] == [200] and auto["lootTravado"] == [7] and auto["hpLimiar"] == 0.4
    # a reposição automática comprou a bola escolhida (sem estoque)
    buys = [m for m in conn.hunt._ws.sent if m["t"] == "shop.buy"]
    assert len(buys) == 1 and buys[0]["kind"] == "ball" and buys[0]["id"] == 4  # só a bola, não a poção
    assert conn.acc.ball_id == 4
    assert store.get_account(acc_id)["options"]["ball_id"] == 4


def test_equip_potion_with_stock_does_not_buy(env):
    c, conn, acc_id, _ = env
    conn.estado["items"]["202"] = 5000
    r = c.post(f"/api/accounts/{acc_id}/equip", json={"kind": "potion", "id": 202}, headers=H).json()
    assert r["ok"] and r["willBuy"] is False
    assert not [m for m in conn.hunt._ws.sent if m["t"] == "shop.buy"]
    assert conn.acc.potion_id == 202


def test_equip_beast_ball_is_not_buyable(env):
    c, conn, acc_id, _ = env
    r = c.post(f"/api/accounts/{acc_id}/equip", json={"kind": "ball", "id": 5}, headers=H).json()
    assert r["ok"] and r["buyable"] is False and r["willBuy"] is False


def test_equip_rejects_invalid_item(env):
    c, _, acc_id, _ = env
    assert c.post(f"/api/accounts/{acc_id}/equip", json={"kind": "ball", "id": 99}, headers=H).status_code == 400
    assert c.post(f"/api/accounts/{acc_id}/equip", json={"kind": "potion", "id": 1}, headers=H).status_code == 400


def test_snapshot_lists_equip_options(env):
    from telemetry import account_snapshot

    _, conn, _, _ = env
    opts = account_snapshot(conn)["equipped"]["options"]
    assert {o["id"] for o in opts["ball"]} == {1, 2, 3, 4, 5}
    assert 70070 in {o["id"] for o in opts["potion"]}


def test_compact_creatures():
    raw = {"creatures": [{"pokeId": 1, "name": "Bulbasaur", "type1": "GRASS", "type2": "POISON",
                          "loot": [{"name": "Leaf", "chance": 5}]}, {"name": "sem id"}]}
    assert actions_api.compact_creatures(raw) == {"1": {"n": "Bulbasaur", "t": ["GRASS", "POISON"], "l": ["Leaf"], "lk": None}}


# ------------------------------------------------------------ fila de hunt (trava de combate)
def _lock(conn, ms):
    import time

    conn.market.clock_offset_ms = 0
    conn.estado["centroLivreEm"] = int(time.time() * 1000) + ms


def test_hunt_in_combat_is_queued_not_sent(env):
    c, conn, acc_id, _ = env
    _lock(conn, 5000)
    r = c.post(f"/api/accounts/{acc_id}/hunt", json={"slug": "lapras"}, headers=H).json()
    assert r["queued"] is True and r["confirmed"] is False and 0 < r["waitMs"] <= 5000
    assert conn.pending_hunt == "lapras"
    assert conn.hunt._ws.sent == []  # nada enviado enquanto a trava dura
    from telemetry import account_snapshot

    snap = account_snapshot(conn)
    assert snap["huntPending"] == {"slug": "lapras", "name": "Lapras"} and snap["combatLockMs"] > 0


def test_queue_can_be_cancelled(env):
    c, conn, acc_id, _ = env
    _lock(conn, 5000)
    c.post(f"/api/accounts/{acc_id}/hunt", json={"slug": "lapras"}, headers=H)
    assert c.delete(f"/api/accounts/{acc_id}/hunt/queue", headers=H).json() == {"ok": True}
    assert conn.pending_hunt is None


def test_queue_sends_when_lock_ends_and_clears_on_confirmation(env):
    import asyncio

    _, conn, _, _ = env
    _lock(conn, 600)
    conn.queue_hunt("lapras")

    async def scenario():
        task = asyncio.create_task(conn._hunt_queue_loop())
        await asyncio.sleep(0.3)
        assert conn.hunt._ws.sent == []  # ainda em combate
        await asyncio.sleep(0.8)
        assert conn.hunt._ws.sent == [{"t": "hunt.select", "slug": "lapras"}]  # trava acabou: enviou
        conn.hunt.session = HuntSession(slug="lapras")  # o jogo confirmou (k:"hunt")
        await asyncio.sleep(0.6)
        task.cancel()

    asyncio.run(scenario())
    assert conn.pending_hunt is None
    assert len(conn.hunt._ws.sent) == 1  # não reenviou depois de confirmado


def test_queue_waits_again_if_a_new_hit_restarts_the_lock(env):
    import asyncio

    _, conn, _, _ = env
    _lock(conn, 400)
    conn.queue_hunt("lapras")

    async def scenario():
        task = asyncio.create_task(conn._hunt_queue_loop())
        await asyncio.sleep(0.2)
        _lock(conn, 1500)  # novo hit: a contagem reinicia
        await asyncio.sleep(0.9)
        assert conn.hunt._ws.sent == []  # não trocou enquanto havia trava
        task.cancel()

    asyncio.run(scenario())


def test_merge_catalog_inherits_sprites_and_remaps_outland():
    base = {"creatures": [
        {"pokeId": 148, "name": "Dragonair", "type1": "DRAGON", "looktype": 25},
        {"pokeId": 94, "name": "Gengar", "type1": "GHOST", "type2": "POISON", "looktype": 5},
        {"pokeId": 10501, "name": "Brave Blastoise", "type1": "WATER", "looktype": 1},   # id antigo do espelho
    ]}
    novos = {"creatures": [
        {"pokeId": 2002, "name": "Ancient Dragonair", "type1": "DRAGON", "looktype": 1},   # variante Outland
        {"pokeId": 13094, "name": "Gengar de Orre", "type1": "GHOST", "looktype": 1},      # clone de Orre
    ]}
    lab = {"patches": [{"pokeId": 148, "looktype": 60148}, {"pokeId": 94, "looktype": 60094}]}
    out = actions_api.merge_catalog([base, novos], lab)
    assert out["148"]["lk"] == 60148                       # patch do lab
    assert out["2002"]["lk"] == 60148 and out["2002"]["t"] == ["DRAGON"]   # Outland herda do Dragonair
    assert out["13094"]["lk"] == 60094                     # Orre herda do nacional (13094 - 13000)
    assert "2001" in out and "10501" not in out            # espelho antigo foi normalizado


def test_queue_survives_a_failed_send(env):
    import asyncio

    _, conn, _, _ = env
    conn.market.clock_offset_ms = 0
    conn.estado["centroLivreEm"] = 0
    calls = []

    class FlakyWS(FakeWS):
        async def send(self, raw):
            calls.append(1)
            if len(calls) == 1:
                raise ConnectionError("caiu")
            await super().send(raw)

    conn.hunt._ws = FlakyWS()
    conn.queue_hunt("lapras")

    async def scenario():
        task = asyncio.create_task(conn._hunt_queue_loop())
        await asyncio.sleep(1.8)
        task.cancel()

    asyncio.run(scenario())
    assert conn.hunt._ws.sent[0] == {"t": "hunt.select", "slug": "lapras"}  # a fila sobreviveu e reenviou


def test_reset_session_zeroes_time_and_items(env):
    c, conn, acc_id, _ = env
    assert c.post("/api/session/reset").status_code == 401
    conn.session_started = 1000.0
    conn.session_items.gained["key"] = 7
    conn.balls.caught = 3
    r = c.post("/api/session/reset", headers=H)
    assert r.status_code == 200 and r.json()["reset"] == [f"acc{acc_id}"]
    assert conn.session_started > 1000.0
    assert all(v == 0 for v in conn.session_items.gained.values()) and conn.balls.caught == 0
    assert conn.session_store.get(conn._session_key)["gained"]["key"] == 0   # persistido: sobrevive a reinício
    assert c.post("/api/session/reset?account=99", headers=H).status_code == 404


def test_pokemon_sheet_for_hunt_calculator(env):
    c, conn, acc_id, _ = env
    assert c.get(f"/api/accounts/{acc_id}/sheet").status_code == 401
    assert c.get(f"/api/accounts/{acc_id}/sheet", headers=H).status_code == 409   # sem Pokémon equipado
    conn.estado.update({"activeId": 5, "pokemons": [{
        "id": 5, "speciesId": 212, "nome": "Scizor", "level": 100, "quality": 1.796, "potencia": 3, "shiny": False,
        "stats": {"hp": 188, "atk": 264, "def": 190, "spAtk": 202, "spDef": 218, "speed": 175},
        "ivs": {"hp": 14, "atk": 10, "def": 4, "spAtk": 30, "spDef": 22, "speed": 13}}]})
    j = c.get(f"/api/accounts/{acc_id}/sheet", headers=H).json()
    assert j["speciesId"] == 212 and j["stats"]["atk"] == 264 and j["trainerLevel"] == 300 and j["potencia"] == 3
    assert c.get("/api/accounts/99/sheet", headers=H).status_code == 404
