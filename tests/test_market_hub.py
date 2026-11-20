import asyncio

import pytest

import market_hub as mh

RESUMO = {
    "dias": 7, "diasComDados": 7,
    "totais": {"vendas": 1000, "ouro": 5_000_000, "gema": 900},
    "maisVendidos": [
        {"nome": "Earth Stone", "moeda": "ouro", "categoria": "item", "vendas": 600, "unidades": 3000, "volume": 3_000_000,
         "mediana": 1000.0, "p25": 900.0, "p75": 1100.0},
        {"nome": "Furious Scizor", "moeda": "gema", "categoria": "pokemon", "vendas": 50, "unidades": 50, "volume": 500,
         "mediana": 10, "p25": 9, "p75": 15},
        {"nome": "Earth Stone", "moeda": "gema", "categoria": "item", "vendas": 5, "unidades": 5, "volume": 50,
         "mediana": 10, "p25": 9, "p75": 11},
    ],
    "tendencias": {
        "sobem": [{"nome": "Fire Stone", "moeda": "ouro", "categoria": "item", "antes": 100, "depois": 150, "variacao": 0.5,
                   "vendas": 40, "serie": [100, 110, 150]},
                  {"nome": "Raro", "moeda": "ouro", "categoria": "item", "antes": 1, "depois": 9, "variacao": 8, "vendas": 2, "serie": []}],
        "caem": [{"nome": "Sun Stone", "moeda": "ouro", "categoria": "item", "antes": 200, "depois": 100, "variacao": -0.5,
                  "vendas": 30, "serie": [200, 150, 100]}],
        "todas": [{"nome": "Earth Stone", "moeda": "ouro", "categoria": "item", "antes": 1000, "depois": 1100, "variacao": 0.1,
                   "vendas": 600, "serie": [1000, 1050, 1100]}],
    },
    "inflacao": {"itensOuro": [{"dia": "2026-11-14", "indice": 100, "coisas": 20}, {"dia": "2026-11-20", "indice": 105.5, "coisas": 20}],
                 "itensGema": []},
    "cobertura": {"ws": {"min": 1_000, "max": 2_000}, "total": 1_670_000},
}
PREV = {"totais": {"vendas": 1800, "ouro": 8_000_000, "gema": 1500}}


def test_normalize_gold_uses_site_numbers():
    o = mh.normalize(RESUMO, PREV, "gold", "7d", 7, {"Furious Scizor": 60212}, lambda n: f"icon:{n}", 5)
    assert o["source"] == "hub" and o["priceKind"] == "median" and o["hourly"] is False
    assert o["totals"] == {"sales": 1000, "volume": 5_000_000, "prevSales": 800, "prevVolume": 3_000_000}
    assert [g["name"] for g in o["groups"]] == ["Earth Stone"]                      # só a moeda pedida
    g = o["groups"][0]
    assert (g["typical"], g["low"], g["high"], g["icon"]) == (1000.0, 900.0, 1100.0, "icon:Earth Stone")
    assert g["change"] == 10.0 and g["spark"] == [1000, 1050, 1100]                # variação em %
    assert [m["name"] for m in o["up"]] == ["Fire Stone"]                          # "Raro" tem poucas vendas
    assert o["up"][0]["change"] == 50.0 and o["down"][0]["change"] == -50.0
    assert o["index"]["change"] == 5.5 and o["coverage"]["count"] == 1_670_000


def test_normalize_gems_and_missing_pieces():
    o = mh.normalize(RESUMO, None, "orb", "30d", 30, {"Furious Scizor": 60212}, lambda n: None, 5)
    assert o["totals"]["volume"] == 900 and o["totals"]["prevSales"] == 0
    sc = next(g for g in o["groups"] if g["name"] == "Furious Scizor")
    assert sc["kind"] == "pokemon" and sc["look"] == 60212 and sc["icon"] is None
    assert o["index"] is None                                                       # sem série de inflação em Gemas


def test_normalize_serie_skips_bad_points():
    pts = mh.normalize_serie({"pontos": [{"dia": "2026-11-01", "mediana": 10, "p25": 8, "p75": 12, "vendas": 3, "unidades": 5, "volume": 50},
                                         {"dia": "2026-11-02"}, "x"]})
    assert pts == [{"k": "2026-11-01", "sales": 3, "units": 5, "volume": 50, "avg": 10.0, "min": 8.0, "max": 12.0}]


def test_client_caches_and_falls_back_to_stale(monkeypatch):
    hub = mh.HubClient()
    calls = []

    async def ok(self, url):
        calls.append(url)
        return RESUMO

    monkeypatch.setattr(mh.HubClient, "_fetch", ok)

    async def go():
        a, b = await asyncio.gather(hub.resumo(7), hub.resumo(7))
        assert a is b and len(calls) == 1                                           # duas telas, uma consulta
        await hub.resumo(7)
        assert len(calls) == 1
        for k, (t, d) in list(hub._cache.items()):
            hub._cache[k] = (t - 10_000, d)                                         # vence o cache

        async def down(self, url):
            raise mh.HubError("fora")

        monkeypatch.setattr(mh.HubClient, "_fetch", down)
        assert (await hub.resumo(7)) is RESUMO                                      # site fora: usa a resposta guardada
        with pytest.raises(mh.HubError):
            await hub.resumo(30)                                                    # nada guardado: erro

    asyncio.run(go())


def test_client_rejects_unexpected_shape(monkeypatch):
    async def bad(self, url):
        return {"oi": 1}

    monkeypatch.setattr(mh.HubClient, "_fetch", bad)
    with pytest.raises(mh.HubError):
        asyncio.run(mh.HubClient().resumo(7))
