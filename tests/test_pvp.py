import asyncio
import json
import time

import pytest
from fastapi.testclient import TestClient

from auth import Auth
from config import build_account_config
from connection import AccountConnection, State
from manager import AccountManager
from notify import DailyStats, Notifier
from pvp import PvpManager
from telemetry import create_app

KEY = "chave-de-teste"
H = {"Authorization": f"Bearer {KEY}"}
TOKEN = "tok_" + "z" * 30

INFO = {
    "t": "pvp",
    "rank": {"pontos": 745, "pico": 745, "vitorias": 20, "derrotas": 18, "partidas": 38, "tierId": "ouro", "divisaoNum": "II",
             "de": 700, "ate": 800, "progresso": 0.45},
    "posicao": None, "totalClassificados": 13509,
    "time": [11, 12, 13], "historico": [{"id": 5, "oponente": "Rival", "delta": 10, "venci": True, "criadoEm": "2026-11-14T19:33:33Z"}],
    "fila": {"na": False, "desde": 0, "tamanho": 6386, "cooldownMs": 0},
    "regras": {"nivelMin": 150, "posicionamento": 5, "entrePartidasMs": 20000},
}


class FakeWS:
    def __init__(self):
        self.sent = []

    async def send(self, raw):
        self.sent.append(json.loads(raw))


def make(auto=True, ws=None, level=300):
    pv = PvpManager("ACC1:Ash", {"level": level}, auto=auto)
    pv.bind(ws or FakeWS())
    pv.handle_frame(INFO)
    return pv


# --------------------------------------------------------------- frames
def test_info_frame_fills_rank_team_rules_and_history():
    pv = make()
    assert pv.rank["tierId"] == "ouro" and pv.team == [11, 12, 13]
    assert pv.level_min == 150 and pv.queue["tamanho"] == 6386
    assert pv.history[0]["id"] == 5


def test_welcome_snapshot_is_the_starting_point():
    pv = PvpManager("a", {"pvp": {"tierId": "bronze", "pontos": 0}, "pvpTime": [1, 2], "automation": {"pvpAutoFila": True}})
    pv.load_from_estado()
    assert pv.rank["tierId"] == "bronze" and pv.team == [1, 2] and pv.native_auto is True


def test_match_result_updates_rank_counters_and_waits_between_matches():
    async def go():
        ws = FakeWS()
        pv = make(ws=ws)
        pv.handle_frame({"t": "pvp", "partida": {"id": 77, "venci": True, "delta": 11, "pontos": 756, "oponente": {"nick": "Misty"}}})
        await asyncio.sleep(0.05)                                  # a tarefa que confirma a partida
        assert pv.rank["pontos"] == 756 and pv.rank["partidas"] == 39 and pv.rank["vitorias"] == 21
        assert (pv.wins, pv.losses, pv.delta) == (1, 0, 11)
        assert pv.matches[0]["opponent"] == "Misty" and 19_000 < pv.wait_ms() <= 20_000
        assert {"t": "pvp.partida.vista", "id": 77} in ws.sent and {"t": "pvp.info", "semLadder": 1} in ws.sent
    asyncio.run(go())


def test_refusal_backs_off_and_uses_the_time_the_game_gives():
    pv = make()
    pv.handle_frame({"t": "pvp", "filaRecusa": {"msg": "Aguarde", "restaMs": 8000}})
    assert 7_000 < pv.wait_ms() <= 8_500 and pv.refusal["msg"] == "Aguarde"
    pv2 = make()
    pv2.handle_frame({"t": "pvp", "filaRecusa": {"msg": "Sem equipe"}})
    first = pv2.wait_ms()
    pv2.wait_until = 0
    pv2.handle_frame({"t": "pvp", "filaRecusa": {"msg": "Sem equipe"}})
    assert pv2.wait_ms() > first                                    # cada recusa seguida espera mais


def test_queue_confirmation_clears_the_pending_state():
    pv = make()
    pv._pending_enter = True
    pv.handle_frame({"t": "pvp", "fila": {"na": True, "desde": 123}})
    assert pv.queue["na"] and not pv._pending_enter


# ------------------------------------------------------------ fila automática
def test_auto_enters_the_queue_when_ready():
    async def go():
        ws = FakeWS()
        pv = make(ws=ws)
        await pv._tick(300)
        assert ws.sent[-1] == {"t": "pvp.fila.entrar"}
        await pv._tick(300)                                         # espera a confirmação, não repete
        assert [f for f in ws.sent if f["t"] == "pvp.fila.entrar"] == [{"t": "pvp.fila.entrar"}]
    asyncio.run(go())


@pytest.mark.parametrize("setup", ["off", "native", "in_queue", "waiting", "no_team", "low_level"])
def test_auto_stays_quiet_when_it_should(setup):
    async def go():
        ws = FakeWS()
        pv = make(auto=setup != "off", ws=ws)
        level = 300
        if setup == "native":
            pv.native_auto = True
        elif setup == "in_queue":
            pv.queue["na"] = True
        elif setup == "waiting":
            pv.wait_until = time.monotonic() + 30
        elif setup == "no_team":
            pv.team = []
        elif setup == "low_level":
            level = 100
        pv.last_info = time.monotonic()
        await pv._tick(level)
        assert not [f for f in ws.sent if f["t"] == "pvp.fila.entrar"]
    asyncio.run(go())


def test_manual_enter_reports_why_it_cannot():
    async def go():
        pv = make()
        assert await pv.enter(100) == "level"
        pv.team = []
        assert await pv.enter(300) == "team"
        pv.unbind()
        assert await pv.enter(300) == "offline"
    asyncio.run(go())


# ------------------------------------------------------------------ rotas
@pytest.fixture
def env(store, tmp_path, monkeypatch):
    mgr = AccountManager(store, Notifier(""), DailyStats(path=str(tmp_path / "d.json")))

    def fake_spawn(self, row):
        conn = AccountConnection(build_account_config(row), self.settings(), self.notifier, self.daily)
        conn.on_pvp_table = self.pvp_ladder.handle_frame
        conn.on_ficha = self.fichas.handle_frame
        self._conns[conn.acc.index] = conn

    monkeypatch.setattr(AccountManager, "_spawn", fake_spawn)
    acc_id = mgr.add({"nick": "Ash", "token": TOKEN, "device_id": "dev-12345678"})
    conn = mgr.get(acc_id)
    conn.state = State.ONLINE
    conn.hunt._ws = FakeWS()
    conn.estado.update({"level": 300, "pokemons": [{"id": 11, "nome": "Pikachu", "level": 50, "looktype": 1}]})
    conn.pvp.bind(conn.hunt._ws)
    conn.pvp.handle_frame(INFO)
    app = create_app(mgr.connections, Auth(store, exposed=False, env_token=KEY), manager=mgr, store=store)
    return TestClient(app), conn, acc_id, mgr


def test_overview_describes_the_account(env):
    client, conn, acc_id, _ = env
    a = client.get("/api/pvp", headers=H).json()["accounts"][0]
    assert a["id"] == acc_id and a["rank"]["tierId"] == "ouro" and a["blocker"] is None and a["levelMin"] == 150
    assert a["team"][0]["name"] == "Pikachu" and a["team"][1] == {"id": 12, "missing": True}
    assert a["history"][0]["opponent"] == "Rival" and a["queue"]["size"] == 6386


def test_auto_toggle_is_saved_and_applied_without_restart(env, store):
    client, conn, acc_id, _ = env
    assert client.post(f"/api/pvp/{acc_id}/auto", json={"on": True}, headers=H).status_code == 200
    assert conn.pvp.auto and conn.acc.pvp_auto
    assert store.get_account(acc_id)["options"]["pvp_auto"] is True
    assert client.post("/api/pvp/auto", json={"on": False}, headers=H).json()["accounts"] == 1
    assert not conn.pvp.auto and store.get_account(acc_id)["options"]["pvp_auto"] is False


def test_queue_routes(env):
    client, conn, acc_id, _ = env
    assert client.post(f"/api/pvp/{acc_id}/queue", json={"action": "enter"}, headers=H).json() == {"ok": True}
    assert conn.hunt._ws.sent[-1] == {"t": "pvp.fila.entrar"}
    assert client.post(f"/api/pvp/{acc_id}/queue", json={"action": "leave"}, headers=H).status_code == 200
    assert conn.hunt._ws.sent[-1] == {"t": "pvp.fila.sair"}
    conn.pvp.team = []
    r = client.post(f"/api/pvp/{acc_id}/queue", json={"action": "enter"}, headers=H)
    assert r.status_code == 409 and r.json()["code"] == "team"


def test_routes_require_the_panel_key(env):
    client, _, acc_id, _ = env
    assert client.get("/api/pvp").status_code == 401
    assert client.post(f"/api/pvp/{acc_id}/auto", json={"on": True}).status_code == 401


def test_ladder_is_requested_once_and_cached(env):
    client, conn, _, mgr = env
    rows = [[i, f"P{i}", "diamante", "III", 5000 - i, 10, 9] for i in range(1, 4)]

    class Echo(FakeWS):
        async def send(self, raw):
            await super().send(raw)
            asyncio.get_running_loop().call_soon(
                mgr.pvp_ladder.handle_frame, conn,
                {"t": "pvpTabela", "pagina": 1, "paginas": 10, "semana": "2026-11-15", "linhas": rows})

    conn.hunt._ws = Echo()
    first = client.get("/api/pvp/ladder?pagina=1", headers=H).json()
    assert first["pages"] == 10 and first["rows"][0] == {"pos": 1, "nick": "P1", "tier": "diamante", "division": "III", "points": 4999, "wins": 10, "losses": 9}
    again = client.get("/api/pvp/ladder?pagina=1", headers=H).json()
    assert again["rows"] == first["rows"]
    assert [f for f in conn.hunt._ws.sent if f["t"] == "pvp.tabela"] == [{"t": "pvp.tabela", "pagina": 1}]


# ------------------------------------------------- poder e tabuleiro
import pvp_power as pw  # noqa: E402

TYRANITAR = {"pokeId": 248, "name": "Tyranitar", "baseHp": 100, "baseAtk": 134, "baseDef": 110, "baseSpAtk": 95, "baseSpDef": 100, "baseSpeed": 61,
             "type1": "ROCK", "type2": "DARK",
             "attacks": [{"name": "Rock Throw", "power": 96, "type": "ROCK", "category": "PHYSICAL", "cooldownMs": 29100, "learnLevel": 1},
                         {"name": "Crumbling Rain", "power": 600, "type": "ROCK", "category": "PHYSICAL", "cooldownMs": 60000, "learnLevel": 1}]}
TYR_PK = {"id": 3289961, "speciesId": 248, "level": 2064, "quality": 1.711, "potencia": 1, "shiny": False, "refino": {"atk": 1},
          "ivs": {"hp": 17, "atk": 23, "def": 20, "spAtk": 28, "spDef": 32, "speed": 32},
          "stats": {"hp": 4607, "atk": 5741, "def": 4758, "spAtk": 4789, "spDef": 5202, "speed": 4297}}


def test_pvp_power_matches_the_game_for_a_known_pokemon():
    assert pw.arena_level(2064) == 488 and pw.arena_level(100) == 100 and pw.arena_level(150) == 150
    assert pw.pvp_power(TYR_PK, TYRANITAR) == 82354          # o número que o jogo mostra ("Poder no PVP")


def test_species_range_follows_the_special_attack_gap():
    assert pw.species_range(TYRANITAR) == 1
    assert pw.species_range({"baseHp": 50, "baseAtk": 50, "baseSpAtk": 60}) == 2
    assert pw.species_range({"baseHp": 50, "baseAtk": 50, "baseSpAtk": 90}) == 3
    assert pw.species_range({"baseHp": 50, "baseAtk": 50, "baseSpAtk": 120}) == 4


def test_fill_houses_keeps_valid_picks_and_places_the_rest_by_range():
    assert len(pw.HOUSES) == 30
    out = pw.fill_houses([None, None, None], [1, 4, 1])
    assert out == [2, 23, 3] and len(set(out)) == 3                 # corpo a corpo na frente, arqueiro atrás
    assert pw.fill_houses([5, 5, 99], [1, 1, 1])[0] == 5
    assert len(set(pw.fill_houses([5, 5, 99], [1, 1, 1]))) == 3     # repetida/inválida é trocada


def test_team_save_waits_for_the_game(env):
    client, conn, acc_id, _ = env
    conn.estado["pokemons"] = [{"id": i, "nome": f"P{i}", "level": 200, "speciesId": 1, "tipos": []} for i in (11, 12)]

    class Reply(FakeWS):
        async def send(self, raw):
            await super().send(raw)
            conn.pvp.handle_frame({"t": "pvp", "timeSalvo": [11, 12], "casasSalvas": {"11": 2, "12": 3}})

    conn.hunt._ws = Reply()
    conn.pvp.bind(conn.hunt._ws)
    r = client.post(f"/api/pvp/{acc_id}/team", json={"ids": [11, 12], "casas": {"11": 2}}, headers=H)
    assert r.status_code == 200 and r.json()["casas"]["11"] == 2
    sent = [f for f in conn.hunt._ws.sent if f["t"] == "pvp.time.salvar"][0]
    assert sent["pokemonIds"] == [11, 12] and set(sent["casas"]) == {"11", "12"}
    bad = client.post(f"/api/pvp/{acc_id}/team", json={"ids": [11, 999]}, headers=H)
    assert bad.status_code == 400


def test_team_save_reports_the_games_refusal(env):
    client, conn, acc_id, _ = env
    conn.estado["pokemons"] = [{"id": 11, "nome": "P", "level": 200, "speciesId": 1}]

    class Refuse(FakeWS):
        async def send(self, raw):
            await super().send(raw)
            conn.pvp.handle_frame({"t": "pvp", "recusa": {"msg": "Nível baixo demais."}})

    conn.hunt._ws = Refuse()
    conn.pvp.bind(conn.hunt._ws)
    r = client.post(f"/api/pvp/{acc_id}/team", json={"ids": [11]}, headers=H)
    assert r.status_code == 409 and r.json()["error"] == "Nível baixo demais."


def test_roster_filters_and_sorts(env, monkeypatch):
    client, conn, acc_id, _ = env
    import pvp_team_api

    async def fake_catalog():
        return {"full": {248: TYRANITAR}}

    monkeypatch.setattr(pvp_team_api, "load_catalog", fake_catalog)
    conn.estado["pokemons"] = [
        {**TYR_PK, "nome": "Tyranitar", "tipos": ["ROCK", "DARK"], "slot": 1},
        {**TYR_PK, "id": 2, "nome": "Pequeno", "level": 50, "tipos": ["ROCK"], "slot": None, "stats": {}, "ivs": {}, "shiny": True},
    ]
    r = client.get(f"/api/pvp/{acc_id}/roster?ord=poder", headers=H).json()
    assert r["total"] == 2 and r["items"][0]["name"] == "Tyranitar" and r["items"][0]["pvpPower"] == 82354
    assert client.get(f"/api/pvp/{acc_id}/roster?shiny=true", headers=H).json()["total"] == 1
    assert client.get(f"/api/pvp/{acc_id}/roster?local=colecao", headers=H).json()["items"][0]["name"] == "Pequeno"
    assert client.get(f"/api/pvp/{acc_id}/roster?q=dark", headers=H).json()["total"] == 1


# ------------------------------------------------- ficha de Pokémon de outros (mercado, chat)
@pytest.fixture
def sheets(env, monkeypatch):
    import pokemon_sheet_api
    import pvp_team_api

    async def fake_catalog():
        return {"full": {248: TYRANITAR}}

    monkeypatch.setattr(pvp_team_api, "load_catalog", fake_catalog)
    monkeypatch.setattr(pokemon_sheet_api, "load_catalog", fake_catalog)
    return env


def test_sheet_from_a_market_pokemon(sheets):
    client, _, _, _ = sheets
    r = client.post("/api/pokemon/sheet", json={"pokemon": {**TYR_PK, "nome": "Tyranitar", "dono": "Rival"}}, headers=H)
    d = r.json()
    assert r.status_code == 200 and d["pvpPower"] == 82354 and d["owner"] == "Rival" and d["species"]["pokeId"] == 248
    assert d["pokedex"] == {"defeated": None, "captured": None}          # o Pokédex é da conta, não do dono do Pokémon
    with_price = client.post("/api/pokemon/sheet", json={"pokemon": TYR_PK, "listing": {"id": 4, "price": 900, "currency": "orb", "qty": 1}}, headers=H).json()
    assert with_price["listing"] == {"id": 4, "price": 900, "currency": "orb", "qty": 1} and "listing" not in d
    assert client.post("/api/pokemon/sheet", json={"pokemon": {"id": 1}}, headers=H).status_code == 422
    assert client.post("/api/pokemon/sheet", json={"pokemon": TYR_PK}).status_code in (401, 403)


def test_sheet_of_a_species_missing_from_the_catalog_keeps_the_shape(sheets):
    client, _, _, _ = sheets
    d = client.post("/api/pokemon/sheet", json={"pokemon": {**TYR_PK, "speciesId": 9999, "nome": "Mega Garchomp"}}, headers=H).json()
    assert d["species"] is None and d["bases"] is None
    assert d["evolution"] == {"prev": None, "next": None, "level": 0, "prevLevel": 0} and d["foundIn"] == [] and d["pokedex"]["captured"] is None


def test_sheet_without_species_id_falls_back_to_the_name(sheets):
    client, _, _, _ = sheets
    pk = {k: v for k, v in TYR_PK.items() if k != "speciesId"} | {"nome": "Tyranitar"}
    d = client.post("/api/pokemon/sheet", json={"pokemon": pk}, headers=H).json()
    assert d["species"]["pokeId"] == 248 and d["pokemon"]["speciesId"] == 248


def test_public_pokemon_is_asked_to_the_game_once_and_cached(sheets):
    client, conn, _, _ = sheets
    asked = []

    class Reply(FakeWS):
        async def send(self, raw):
            await super().send(raw)
            frame = json.loads(raw)
            if frame["t"] == "chat.verPokemon":
                asked.append(frame)
                conn.on_ficha(conn, {"t": "ranking.ficha", "pokemon": {**TYR_PK, "id": 777, "nome": "Tyranitar"}})

    conn.hunt._ws = Reply()
    r = client.get("/api/pokemon/public?nick=Bob&pid=777", headers=H)
    assert r.status_code == 200 and r.json()["pokemon"]["id"] == 777 and r.json()["owner"] == "Bob"
    assert asked == [{"t": "chat.verPokemon", "nick": "Bob", "pokemonId": 777}]
    assert client.get("/api/pokemon/public?nick=Bob&pid=777", headers=H).status_code == 200
    assert len(asked) == 1                                               # segunda abertura vem do cache
    assert client.get("/api/pokemon/public?nick=Bob", headers=H).status_code == 400


def test_public_pokemon_times_out_with_a_clear_message(sheets, monkeypatch):
    import pokemon_sheet_api
    client, _, _, _ = sheets
    monkeypatch.setattr(pokemon_sheet_api, "FICHA_WAIT_S", 0.05)
    r = client.get("/api/pokemon/public?nick=Bob&pid=888", headers=H)
    assert r.status_code == 504 and "vendido ou liberado" in r.json()["error"]


def test_public_pokemon_of_my_own_account_uses_the_full_sheet(sheets):
    client, conn, _, _ = sheets
    conn.estado["eu"] = {"nick": "Ash"}
    conn.estado["pokemons"] = [{**TYR_PK, "id": 5, "nome": "Tyranitar"}]
    r = client.get("/api/pokemon/public?nick=ash&pid=5", headers=H)
    assert r.status_code == 200 and r.json()["pokedex"] is not None and r.json()["pvpPower"] == 82354


def test_listing_sheet_reads_the_ad_from_the_market(sheets, monkeypatch):
    client, conn, _, _ = sheets
    monkeypatch.setattr(type(conn.market), "online", property(lambda self: True))
    ads = {1: {"id": 1, "estado": "aberto", "tipo": "pokemon", "vendedor": "Dona", "preco": 8000, "moeda": "orb", "qtd": 1,
               "pokemonId": 31, "ficha": {**TYR_PK, "id": None, "nome": "Tyranitar"}},
           2: {"id": 2, "estado": "aberto", "tipo": "item", "itemId": 5, "ficha": {}},
           3: {"id": 3, "estado": "vendido", "tipo": "pokemon", "ficha": {**TYR_PK}}}

    async def fake_anuncio(lid):
        return {"t": "market", "aba": "anuncio", "id": lid, "anuncio": ads.get(lid)}

    monkeypatch.setattr(conn.market, "anuncio", fake_anuncio)
    d = client.get("/api/pokemon/listing/1", headers=H).json()
    assert d["owner"] == "Dona" and d["pokemon"]["id"] == 31 and d["listing"]["price"] == 8000 and d["pvpPower"] == 82354
    assert client.get("/api/pokemon/listing/2", headers=H).json()["code"] == "item"
    gone = client.get("/api/pokemon/listing/3", headers=H)
    assert gone.status_code == 404 and gone.json()["code"] == "gone"
    assert client.get("/api/pokemon/listing/99", headers=H).status_code == 404


def test_chat_rows_carry_the_pokemon_and_listing_links():
    from chat import normalize
    base = {"id": 1, "canal": "mundo", "idioma": "pt", "de": "X"}
    share = normalize({**base, "pkShare": {"nick": "Liang", "pokemonId": 55, "nome": "Leafeon", "apelido": "Folha"}})
    assert share["pk"] == {"nick": "Liang", "id": 55, "label": "Folha"}
    shiny = normalize({**base, "id": 2, "shinyCaptura": {"nick": "yLuffyD", "pokemonId": 9, "nome": "Staravia"}})
    assert shiny["pk"] == {"nick": "yLuffyD", "id": 9, "label": "Staravia"} and "Staravia" in shiny["text"]
    assert normalize({**base, "id": 3, "texto": "oi"})["pk"] is None
    assert normalize({**base, "id": 4, "pkShare": {"nick": "A", "nome": "B"}})["pk"] is None      # sem id: sem link


# ------------------------------------------------- sprites fora do atlas (Mega, shiny)
def test_look_of_prefers_the_shiny_form_only_for_shinies():
    from sprite_outfit import look_of
    assert look_of({"looktype": 60248, "lookShiny": 70248, "shiny": True}) == 70248
    assert look_of({"looktype": 60248, "lookShiny": 70248, "shiny": False}) == 60248
    assert look_of({"looktype": 60248, "shiny": True}) == 60248            # shiny sem forma conhecida: a comum
    assert look_of(None) is None


def test_outfit_frame_is_the_first_front_frame_and_skips_masks():
    from sprite_outfit import pick_frame
    fr = lambda x: {"frames": [{"page": 0, "x": x, "y": 2, "w": 64, "h": 64}]}      # noqa: E731
    manifest = {"assets": {
        "/assets/outfits/male/9/2_1_1_1.png": fr(100),         # quadro 2 de outra direção
        "/assets/outfits/male/9/2_1_1_3.png": fr(300),         # quadro 2 de frente
        "/assets/outfits/male/9/1_1_1_3.png": fr(200),         # quadro 1 de frente  <- o escolhido
        "/assets/outfits/male/9/1_1_1_3_template.png": fr(999),  # máscara de colorização
    }}
    assert pick_frame(manifest) == {"page": 0, "x": 200, "y": 2, "w": 64, "h": 64}
    only_side = {"assets": {"/a/1_1_1_2.png": fr(7)}}
    assert pick_frame(only_side)["x"] == 7                      # sem direção de frente: usa a que houver
    assert pick_frame({"assets": {}}) is None


def test_sprite_route_serves_the_resolved_frame_and_reports_missing(sheets, monkeypatch):
    client, _, _, _ = sheets
    import sprite_outfit

    async def fake_resolve(self, looktype):
        return None if looktype == 1 else {"image": "https://pokeidle.io/x.webp", "pageW": 4094, "pageH": 34, "x": 2, "y": 2, "w": 32, "h": 32}

    monkeypatch.setattr(sprite_outfit.OutfitSprites, "_resolve", fake_resolve)
    ok = client.get("/api/sprite/80248", headers=H)
    assert ok.status_code == 200 and ok.json()["w"] == 32 and "max-age" in ok.headers["cache-control"]
    assert client.get("/api/sprite/1", headers=H).status_code == 404
    assert client.get("/api/sprite/80248").status_code in (401, 403)


def test_lists_use_the_shiny_look(sheets):
    client, conn, acc_id, _ = sheets
    conn.estado["pokemons"] = [{**TYR_PK, "id": 9, "nome": "Tyranitar", "shiny": True, "looktype": 60248, "lookShiny": 70248, "tipos": []}]
    row = client.get(f"/api/pvp/{acc_id}/roster", headers=H).json()["items"][0]
    assert row["looktype"] == 70248
