from maps import DEFAULT_TIERS, effective_tier, normalize_tiers, region_of_hunt


def test_tier_follows_chosen_when_level_allows():
    t = normalize_tiers(None)
    assert effective_tier(t, 2, 1000)["tier"] == 2
    assert effective_tier(t, 3, 1500)["tier"] == 2          # nível não alcança o 3: cai para o maior liberado
    assert effective_tier(t, 8, 36000)["tier"] == 8
    assert effective_tier(t, None, 10)["tier"] == 1          # abaixo de tudo: o primeiro
    assert effective_tier(t, "x", "y")["tier"] == 1


def test_normalize_tiers_uses_welcome_and_falls_back():
    assert normalize_tiers([]) == DEFAULT_TIERS
    got = normalize_tiers([{"tier": 2, "nivel": 5, "mult": 2}, {"tier": 1, "rotulo": "O1", "nivel": 1}, "lixo", {}])
    assert [t["tier"] for t in got] == [1, 2] and got[1]["rotulo"] == "Outland 2"


def test_region_of_hunt():
    assert region_of_hunt({"regiao": "hoenn"}) == "hoenn"
    assert region_of_hunt({"regiao": "outland2"}) == "outland"
    assert region_of_hunt({"area": "outland"}) == "outland"
    assert region_of_hunt({"area": "kanto", "especies": [{"pokeId": 160, "pontos": 3}, {"pokeId": 1, "pontos": 1}]}) == "johto"
    assert region_of_hunt({"area": "orre", "especies": [{"pokeId": 13000 + 261, "pontos": 2}]}) == "hoenn"
    assert region_of_hunt({"area": "kanto"}) == "kanto"
    assert region_of_hunt(None) is None
