import asyncio
import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

import boss as bossmod
from auth import Auth
from config import build_account_config
from connection import AccountConnection, State
from manager import AccountManager
from notify import DailyStats, Notifier
from telemetry import create_app

KEY = "chave-de-teste"
H = {"Authorization": f"Bearer {KEY}"}
TOKEN = "tok_" + "y" * 30


def _ms(y, mo, d, h, mi=0):
    return int(datetime(y, mo, d, h, mi, tzinfo=timezone.utc).timestamp() * 1000)


# ------------------------------------------------------------------ rodízio
def test_rotation_turns_at_18h_brasilia():
    # 18:00 em Brasília = 21:00 UTC. O dia zero do ciclo é 2026-11-17.
    before = _ms(2026, 11, 17, 20, 59)
    after = _ms(2026, 11, 17, 21, 0)
    assert bossmod.rotation_day(before) == (bossmod.rotation_day(after) - 1) % 3
    assert bossmod.next_rotation_ms(before) == after


def test_prize_cycles_through_the_three_prizes():
    t = _ms(2026, 11, 25, 12)
    day = bossmod.rotation_day(t)
    # cada posição da trinca recebe um prêmio diferente no mesmo dia, e o dia seguinte gira
    today = {bossmod.prize_for(p, day) for p in range(3)}
    assert today == set(bossmod.PREMIOS)
    assert bossmod.prize_for(0, day + 1) == bossmod.prize_for(2, day)


def test_rotation_matches_the_game_screenshot():
    # Suicune (posição 0): "hoje" MEGA, "amanhã" TM, "depois" Tickets (dia 25/11, 14h36 antes das 18h)
    t = _ms(2026, 11, 25, 6, 24)
    d = bossmod.rotation_day(t)
    assert [bossmod.prize_for(0, d + k) for k in range(3)] == ["mega", "tm", "tickets"]


# ------------------------------------------------------------------ eventos
def _mgr():
    estado = {"boss": {"arena": None, "auto": False, "vitorias": {"suicune": 190}}}
    return bossmod.BossManager("Ash", estado), estado


def test_win_counts_and_keeps_the_drops():
    m, estado = _mgr()
    m.handle_frame({"t": "batalha", "ev": [
        {"k": "bossMorto", "key": "suicune", "nome": "Suicune", "xpTreinador": 10, "xpPokemon": 20,
         "drops": [{"itemId": 59300, "nome": "Fragmento", "qtd": 2}], "auto": True}]})
    assert m.wins == 1
    assert estado["boss"]["vitorias"]["suicune"] == 191
    assert m.victories() == {"suicune": 191}
    r = m.recent[0]
    assert r["won"] and r["name"] == "Suicune" and r["drops"] == [{"itemId": 59300, "name": "Fragmento", "qty": 2}]
    assert r["xpTrainer"] == 10 and r["auto"] is True


def test_loss_and_unrelated_frames():
    m, _ = _mgr()
    m.handle_frame({"t": "batalha", "ev": [{"k": "ataque"}, {"k": "bossPerdeu", "nome": "Suicune"}]})
    m.handle_frame({"t": "estado", "estado": {}})
    assert (m.wins, m.losses) == (0, 1)
    assert m.recent[0]["won"] is False


def test_recent_is_capped():
    m, _ = _mgr()
    for _i in range(bossmod.RECENT_KEEP + 5):
        m.handle_frame({"t": "batalha", "ev": [{"k": "bossMorto", "key": "x", "nome": "X", "drops": []}]})
    assert len(m.recent) == bossmod.RECENT_KEEP


def test_state_accessors_tolerate_missing_data():
    m = bossmod.BossManager("Ash", {})
    assert m.arena is None and m.auto is False and m.auto_key is None and m.victories() == {}


# ---------------------------------------------------------------------- API
class FakeWS:
    def __init__(self):
        self.sent = []

    async def send(self, raw):
        self.sent.append(json.loads(raw))


FICHA = {
    "key": "suicune", "level": 650, "teamLevel": 650, "equipeIdeal": 5, "minNivelTreinador": 650,
    "type1": "WATER", "type2": None, "premio": "tm", "posicao": 0,
    "entrada": {"itemId": 70000, "qtd": 1, "nome": "Bronze Boss Token"},
    "dropsPorPremio": {
        "tm": [{"itemId": 59194, "nome": "TM Disk Piece", "chance": 0.02, "qtd": [1, 3]}],
        "mega": [{"itemId": 59300, "nome": "Fragmento de MEGA Stone", "chance": 0.013}],
        "tickets": [{"itemId": 59400, "nome": "Safari Ticket", "chance": 0.005}],
    },
}
CAT = [
    {"key": "suicune", "name": "Suicune", "level": 650, "regiao": "johto", "posicao": 0, "pokeId": 245, "looktype": 60245},
    {"key": "dialga", "name": "Dialga", "level": 9750, "regiao": "sinnoh", "posicao": 0, "pokeId": 483, "drops": ["Rare Candy"]},
]


@pytest.fixture
def env(store, tmp_path, monkeypatch):
    mgr = AccountManager(store, Notifier(""), DailyStats(path=str(tmp_path / "d.json")))

    def fake_spawn(self, row):
        conn = AccountConnection(build_account_config(row), self.settings(), self.notifier, self.daily)
        self._conns[conn.acc.index] = conn

    monkeypatch.setattr(AccountManager, "_spawn", fake_spawn)
    acc_id = mgr.add({"nick": "Ash", "token": TOKEN, "device_id": "dev-87654321"})
    conn = mgr.get(acc_id)
    conn.state = State.ONLINE
    conn.hunt._ws = FakeWS()
    conn.boss.bind(conn.hunt._ws)
    conn.boss_catalog = [dict(b) for b in CAT]
    conn.boss_playable = [FICHA]
    conn.estado.update({
        "level": 700, "items": {"70000": 3}, "boss": {"arena": None, "auto": False, "vitorias": {"suicune": 7}},
        "pokemons": [{"id": 1, "nome": "Tyranitar", "level": 700, "slot": 0, "hp": 10, "maxHp": 20, "looktype": 60248},
                     {"id": 2, "nome": "Reserva", "level": 5, "slot": None}],
    })
    app = create_app(mgr.connections, Auth(store, exposed=False, env_token=KEY), manager=mgr, store=store)
    return TestClient(app), conn, acc_id


def test_bosses_requires_login(env):
    c, _, acc_id = env
    assert c.get("/api/bosses").status_code == 401
    assert c.post(f"/api/bosses/{acc_id}/enter", json={"key": "suicune"}).status_code == 401


def test_overview_has_catalog_rotation_and_account(env):
    c, conn, acc_id = env
    d = c.get("/api/bosses", headers=H).json()
    suicune = next(b for b in d["catalog"] if b["key"] == "suicune")
    assert suicune["playable"] and suicune["types"] == ["WATER"] and suicune["trio"] == "Trio Bestas Lendárias"
    assert suicune["entry"]["qty"] == 1 and suicune["entry"]["name"] == "Bronze Boss Token"
    assert [day["prize"] for day in suicune["days"]] and len({day["prize"] for day in suicune["days"]}) == 3
    assert all(day["drops"] for day in suicune["days"])
    dialga = next(b for b in d["catalog"] if b["key"] == "dialga")
    assert not dialga["playable"] and dialga["dropNames"] == ["Rare Candy"] and dialga["entry"] is None
    a = d["accounts"][0]
    assert a["id"] == acc_id and a["items"]["70000"] == 3 and a["wins"] == {"suicune": 7}
    assert [p["name"] for p in a["team"]] == ["Tyranitar"]          # só quem está na equipe (slot)
    assert d["nextRotation"] > d["ts"]


def test_enter_starts_the_run_and_not_a_bare_frame(env, monkeypatch):
    c, conn, acc_id = env
    started = []
    monkeypatch.setattr(type(conn.boss), "start", lambda self, key: started.append(key))
    r = c.post(f"/api/bosses/{acc_id}/enter", json={"key": "suicune"}, headers=H)
    assert r.status_code == 200 and started == ["suicune"]
    assert conn.hunt._ws.sent == []          # quem manda boss.entrar é a orquestração, depois de curar


@pytest.mark.parametrize("patch,code", [
    ({"level": 100}, "level"),
    ({"items": {}}, "token"),
    ({"boss": {"arena": {"key": "suicune"}}}, "busy"),
])
def test_enter_is_refused_with_a_reason(env, patch, code):
    c, conn, acc_id = env
    conn.estado.update(patch)
    r = c.post(f"/api/bosses/{acc_id}/enter", json={"key": "suicune"}, headers=H)
    assert r.status_code == 409 and r.json()["code"] == code
    assert conn.hunt._ws.sent == []


def test_enter_unknown_boss_and_offline(env):
    c, conn, acc_id = env
    assert c.post(f"/api/bosses/{acc_id}/enter", json={"key": "dialga"}, headers=H).json()["code"] == "unknown"
    conn.state = State.DISCONNECTED
    assert c.post(f"/api/bosses/{acc_id}/enter", json={"key": "suicune"}, headers=H).json()["code"] == "offline"


def test_enter_needs_a_team(env):
    c, conn, acc_id = env
    conn.estado["pokemons"] = [{"id": 2, "nome": "Reserva", "level": 5, "slot": None}]
    r = c.post(f"/api/bosses/{acc_id}/enter", json={"key": "suicune"}, headers=H)
    assert r.status_code == 409 and r.json()["code"] == "team"


def test_leave_stops_auto_and_leaves_the_arena(env):
    c, conn, acc_id = env
    conn.estado["boss"] = {"arena": {"key": "suicune"}, "auto": True, "autoKey": "suicune"}
    assert c.post(f"/api/bosses/{acc_id}/leave", headers=H).status_code == 200
    assert conn.hunt._ws.sent == [{"t": "boss.auto", "ativo": False, "key": "suicune"}, {"t": "boss.sair"}]


def test_auto_sends_the_frame_and_rejects_unknown_boss(env):
    c, conn, acc_id = env
    assert c.post(f"/api/bosses/{acc_id}/auto", json={"on": True, "key": "suicune"}, headers=H).status_code == 200
    assert conn.hunt._ws.sent == [{"t": "boss.auto", "ativo": True, "key": "suicune"}]
    assert c.post(f"/api/bosses/{acc_id}/auto", json={"on": True, "key": "dialga"}, headers=H).status_code == 409


def test_revive_option_is_saved_and_turns_on_the_game_auto_revive(env):
    c, conn, acc_id = env
    conn.estado["automation"] = {"autoRevive": False, "autoPotion": True}
    conn.estado["items"] = {"70000": 3, "205": 0}
    shop = []

    async def buy(kind, item_id, qty):
        shop.append((kind, item_id, qty))
        return True
    conn.shop.buy = buy
    assert c.post(f"/api/bosses/{acc_id}/revive", json={"on": True}, headers=H).status_code == 200
    assert conn.boss.buy_revive and conn.acc.boss_revive
    assert {"t": "auto.set", "autoRevive": True, "autoPotion": True} in conn.hunt._ws.sent
    assert shop == [("item", 205, 100)]
    assert c.get("/api/bosses", headers=H).json()["accounts"][0]["buyRevive"] is True


# ----------------------------------------------------------- orquestração
class FakeShop:
    awaiting_confirmation = False

    def __init__(self):
        self.bought = []

    async def buy(self, kind, item_id, qty):
        self.bought.append((kind, item_id, qty))
        return True


class FakeHunt:
    def __init__(self, estado, log):
        self.estado, self.log = estado, log

    async def go_to_center(self):
        self.log.append("centro")
        self.estado["noCentro"] = True

    async def select_hunt(self, slug):
        self.log.append(f"hunt:{slug}")
        self.estado.update(huntSlug=slug, noCentro=False)


class FakeConn:
    can_send = True
    boss_playable = [FICHA]

    def __init__(self, estado):
        self.log = []
        self.estado = estado
        self.hunt = FakeHunt(estado, self.log)
        self.shop = FakeShop()
        self.acc = type("A", (), {"hunt_slug": None})()

    def combat_lock_ms(self):
        return 0

    async def set_automation(self, patch):
        self.log.append(("auto.set", patch))
        self.estado.setdefault("automation", {}).update(patch)


class Sock:
    def __init__(self, log, estado):
        self.log, self.estado = log, estado

    async def send(self, raw):
        f = json.loads(raw)
        if f["t"] == "centro.curar":                       # a enfermeira cura na hora
            for p in self.estado["pokemons"]:
                p["hp"] = p["maxHp"]
        self.log.append(f["t"] + (":" + f["key"] if "key" in f else ""))


def _manager(monkeypatch, revive=False):
    monkeypatch.setattr(bossmod, "POLL_S", 0.01)
    monkeypatch.setattr(bossmod, "SETTLE_S", 0.05)
    estado = {"level": 700, "huntSlug": "shellder", "noCentro": False, "items": {"70000": 3, "205": 5},
              "boss": {"arena": None, "auto": False, "vitorias": {}},
              "pokemons": [{"id": 1, "nome": "A", "slot": 0, "hp": 5, "maxHp": 10}]}
    conn = FakeConn(estado)
    m = bossmod.BossManager("Ash", estado, conn=conn, buy_revive=revive)
    m.bind(Sock(conn.log, estado))
    return m, conn, estado


def test_run_heals_fights_heals_again_and_returns_to_the_last_hunt(monkeypatch):
    async def go():
        m, conn, estado = _manager(monkeypatch)
        m.start("suicune")
        while "boss.entrar:suicune" not in conn.log:           # curou ANTES de entrar
            await asyncio.sleep(0.01)
        assert conn.log.index("centro.curar") < conn.log.index("boss.entrar:suicune")
        assert m.run["returnSlug"] == "shellder"
        estado["boss"]["arena"] = {"key": "suicune", "slot": 7}
        estado["noCentro"] = False                              # na arena não está no Centro
        estado["noCentro"] = False                              # na arena não está no Centro
        m.handle_frame({"t": "batalha", "ev": [{"k": "bossEntrou", "nome": "Suicune", "key": "suicune"}]})
        m.handle_frame({"t": "campo.init", "mobs": [{"s": 7, "mhp": 1000, "hp": 1000, "n": "Suicune"}]})
        m.handle_frame({"t": "batalha", "ev": [{"k": "ataque", "slot": 7, "hpAlvo": 250}]})
        await asyncio.sleep(0.05)
        assert m.hp_view() == {"hp": 250, "maxHp": 1000, "name": "Suicune"}
        m.handle_frame({"t": "batalha", "ev": [{"k": "bossMorto", "nome": "Suicune", "key": "suicune",
                                                "drops": [{"itemId": 59300, "nome": "Frag", "qtd": 1}]}]})
        estado["boss"]["arena"] = None
        for p in estado["pokemons"]:
            p["hp"] = 1                                          # ficou ferido na luta
        await asyncio.wait_for(m._task, 5)
        # depois do boss: cura de novo e volta para a hunt de antes
        assert conn.log[-3:] == ["centro", "centro.curar", "hunt:shellder"]   # cura e volta na hora
        assert estado["huntSlug"] == "shellder" and not estado["noCentro"]
        assert m.run is None and m.series is None
        s = m.summary
        assert (s["wins"], s["entries"], s["tokens"]) == (1, 1, 1)
        assert s["items"]["59300"]["qty"] == 1
    asyncio.run(go())


def test_repeat_keeps_fighting_until_tokens_run_out_and_only_then_returns(monkeypatch):
    async def go():
        m, conn, estado = _manager(monkeypatch)
        estado["boss"].update(auto=True, autoKey="suicune")
        m.start("suicune")
        while "boss.entrar:suicune" not in conn.log:
            await asyncio.sleep(0.01)
        for _ in range(3):                                       # 3 lutas seguidas pelo repetir do servidor
            estado["boss"]["arena"] = {"key": "suicune", "slot": 1}
            estado["noCentro"] = False
            estado["noCentro"] = False
            m.handle_frame({"t": "batalha", "ev": [{"k": "bossEntrou", "key": "suicune", "nome": "Suicune"}]})
            await asyncio.sleep(0.03)
            m.handle_frame({"t": "batalha", "ev": [{"k": "bossMorto", "key": "suicune", "nome": "Suicune", "drops": []}]})
            estado["boss"]["arena"] = None
            await asyncio.sleep(0.08)                            # entre uma e outra: arena vazia, repetir ligado
            assert not m._task.done() and "hunt:shellder" not in conn.log
        estado["boss"]["auto"] = False                           # fichas acabaram: o servidor desliga o repetir
        await asyncio.wait_for(m._task, 5)
        assert conn.log[-1] == "hunt:shellder"
        assert (m.summary["wins"], m.summary["tokens"]) == (3, 3)
    asyncio.run(go())


def test_failed_entry_returns_to_the_hunt_and_shows_the_error(monkeypatch):
    monkeypatch.setattr(bossmod, "ENTER_WAIT_S", 0.1)

    async def go():
        m, conn, estado = _manager(monkeypatch)
        m.start("suicune")
        await asyncio.wait_for(m._task, 5)
        assert m.run["phase"] == "failed" and "arena" in m.run["error"]
        assert conn.log[-1] == "hunt:shellder"
    asyncio.run(go())


def test_revive_is_bought_when_it_hits_zero_and_auto_revive_is_turned_on(monkeypatch):
    async def go():
        m, conn, estado = _manager(monkeypatch, revive=True)
        estado["items"]["205"] = 0
        estado["automation"] = {"autoRevive": False}
        await m.ensure_revive()
        assert conn.shop.bought == [("item", 205, 100)]
        assert ("auto.set", {"autoRevive": True}) in conn.log
        await m.ensure_revive()                                  # não repete na hora (espera a confirmação)
        assert len(conn.shop.bought) == 1
        estado["items"]["205"] = 100
        m._revive_at = 0
        await m.ensure_revive()
        assert len(conn.shop.bought) == 1                        # ainda tem estoque
    asyncio.run(go())


def test_revive_does_nothing_when_the_option_is_off(monkeypatch):
    async def go():
        m, conn, estado = _manager(monkeypatch, revive=False)
        estado["items"]["205"] = 0
        await m.ensure_revive()
        assert conn.shop.bought == [] and conn.log == []
    asyncio.run(go())


def test_series_settles_into_a_summary_after_a_manual_fight():
    m = bossmod.BossManager("Ash", {"boss": {"arena": {"key": "suicune"}, "auto": False}})
    m.handle_frame({"t": "batalha", "ev": [{"k": "bossEntrou", "key": "suicune", "nome": "Suicune"},
                                            {"k": "bossMorto", "key": "suicune", "nome": "Suicune",
                                             "drops": [{"itemId": 1, "nome": "X", "qtd": 2}]}]})
    m.settle()
    assert m.series is not None and m.summary is None             # ainda dentro da arena
    m.estado["boss"]["arena"] = None
    m.series["touchedAt"] -= 10
    m.settle()
    assert m.series is None and m.summary["wins"] == 1 and m.summary["items"]["1"]["qty"] == 2


def test_revives_used_are_counted_in_the_series():
    m = bossmod.BossManager("Ash", {"boss": {"arena": {"key": "suicune"}, "auto": False}})
    m.handle_frame({"t": "batalha", "ev": [{"k": "revive"}]})            # antes da série: não conta
    m.handle_frame({"t": "batalha", "ev": [{"k": "bossEntrou", "key": "suicune", "nome": "Suicune"}, {"k": "revive"}, {"k": "revive"}]})
    assert m.series["revives"] == 2


RAID = {
    "t": "raid", "agora": 1_795_590_856_058,
    "edicao": {"id": "gx-2026-11-30", "numero": 6, "dia": "2026-11-30", "inscricoesDe": 1_795_532_400_000,
               "inscricoesAte": 1_796_065_200_000, "equipeAte": 1_796_079_600_000, "batalhaEm": 1_796_079_600_000,
               "transmissaoEm": 1_796_079_660_000, "fimEm": 1_796_137_200_000, "fase": "inscricoes"},
    "gigantamax": {"dex": 892, "nome": "Urshifu Single Strike", "tipos": ["FIGHTING", "DARK"], "hpMax": 309_600_000},
    "token": {"itemId": 70000, "qtd": 1}, "maxEquipe": 5, "inscritos": 2912, "eu": {"inscrito": False},
    "bonus": {"max": 25, "xpMax": 20, "farmMax": 5, "horas": 12, "tabela": []},
}


def test_raid_is_exposed_and_enrollment_sends_the_frame(env):
    c, conn, acc_id = env
    conn.boss.handle_frame(dict(RAID))
    d = c.get("/api/bosses", headers=H).json()
    assert d["raid"]["edicao"]["numero"] == 6 and d["raid"]["inscritos"] == 2912
    assert d["accounts"][0]["raid"]["inscrito"] is False
    r = c.post(f"/api/bosses/{acc_id}/raid/enroll", headers=H)
    assert r.status_code == 200
    assert conn.hunt._ws.sent[-1] == {"t": "raid.inscrever"}


def test_raid_enrollment_is_refused_when_closed_enrolled_or_without_token(env):
    c, conn, acc_id = env
    closed = dict(RAID, agora=RAID["edicao"]["batalhaEm"] + 1)
    conn.boss.handle_frame(closed)
    assert c.post(f"/api/bosses/{acc_id}/raid/enroll", headers=H).json()["code"] == "closed"
    conn.boss.handle_frame(dict(RAID, eu={"inscrito": True}))
    assert c.post(f"/api/bosses/{acc_id}/raid/enroll", headers=H).json()["code"] == "enrolled"
    conn.boss.handle_frame(dict(RAID))
    conn.estado["items"] = {}
    assert c.post(f"/api/bosses/{acc_id}/raid/enroll", headers=H).json()["code"] == "token"


def test_entry_is_resent_while_the_arena_does_not_open(monkeypatch):
    monkeypatch.setattr(bossmod, "ENTER_WAIT_S", 0.35)
    monkeypatch.setattr(bossmod, "ENTER_RETRY_S", 0.1)

    async def go():
        m, conn, estado = _manager(monkeypatch)
        m.start("suicune")
        await asyncio.wait_for(m._task, 5)
        assert conn.log.count("boss.entrar:suicune") >= 3          # o jogo ignorou: reenviou
        assert m.run["phase"] == "failed"
    asyncio.run(go())
