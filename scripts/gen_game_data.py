import json, sys, pprint
src = sys.argv[1]; out = sys.argv[2]
L = lambda f: json.load(open(f"{src}/{f}.json", encoding="utf8"))
_raw = L("items")["items"]
items = {i["id"]: i["name"] for i in _raw}
meta = {i["id"]: (i.get("category", "loot"), bool(i.get("rare"))) for i in _raw}
items.update({  # itens só do servidor (fora do items.json)
    70040: "Casa Comum", 70041: "Casa Incomum", 70042: "Casa Rara", 70043: "Casa Mítica", 70044: "Casa Lendária",
    70060: "Caixa de Fundador", 70061: "Caixa de CoFundador",
    70070: "Golden Potion",
    70080: "Bicicleta Comum", 70081: "Bicicleta Incomum", 70082: "Bicicleta Rara",
    70083: "Bicicleta Mítica", 70084: "Bicicleta Lendária",
})
for _id in list(items):
    pass
for _id in (70040,70041,70042,70043,70044): meta[_id] = ("special", True)   # casas
for _id in (70060,70061): meta[_id] = ("special", True)                     # caixas fundador
for _id in (70080,70081,70082,70083,70084): meta[_id] = ("special", True)   # bicicletas
meta[70070] = ("heal", False)                                              # Golden Potion
try:
    icons = {int(k): v for k, v in L("items-icons").items()}
except FileNotFoundError:
    icons = {}
icons.update({30: "site/assets/items/dark_gem.png", 63: "site/assets/items/goggles.png",
              47: "site/assets/items/farfetchd_stick.png", 5041: "site/assets/items/farfetchd_stick.png",
              70070: "/img/itens/golden-potion.png"})
sp = {}
for f in ("creatures", "creatures-novos", "creatures-outland-novos", "creatures-formas"):
    for c in L(f)["creatures"]:
        pid = c["pokeId"]
        if 10501 <= pid < 10501 + 58: pid -= 8500
        sp[pid] = c["name"]
def fmt(name, d):
    return f"{name} = " + pprint.pformat(dict(sorted(d.items())), width=110, sort_dicts=False) + "\n\n"
hdr = '''"""Tabelas ID -> nome do pokeidle.io, geradas por scripts/gen_game_data.py a partir de
https://pokeidle.io/assets/{items,creatures,creatures-novos,creatures-outland-novos,creatures-formas}.json
(os mesmos JSONs que o frontend baixa). IDs 70040-70084 e 70070 não estão no items.json
(itens "nossos" do servidor); os nomes vêm do i18n/ícones do frontend.
Balls têm namespace próprio (ballId != itemId; ver spec do protocolo e spec do protocolo).
"""
from __future__ import annotations

BALL_NAMES = {1: "Poké Ball", 2: "Great Ball", 3: "Super Ball", 4: "Ultra Ball", 5: "Beast Ball"}

'''
body = fmt("ITEM_NAMES", items)
body += "# itemId -> (categoria, raro). Itens 7xxxx sem entrada aqui: tratados como especiais/raros em item_meta().\n"
body += "# itemId -> caminho do ícone (relativo a https://pokeidle.io/assets/, ou absoluto se começar com /)\n"
body += fmt("ITEM_ICONS", icons) + fmt("ITEM_META", meta) + fmt("POKEMON_NAMES", sp)
body += '''
def item_name(item_id) -> str:
    return ITEM_NAMES.get(int(item_id), f"Item #{item_id}")


def item_meta(item_id) -> tuple[str, bool]:
    """(categoria, raro). IDs >= 70000 desconhecidos contam como especiais raros."""
    iid = int(item_id)
    if iid in ITEM_META:
        return ITEM_META[iid]
    return ("special", True) if iid >= 70000 else ("loot", False)


def item_icon_path(item_id) -> str | None:
    """Caminho do ícone no site do jogo (começa com /), ou None."""
    rel = ITEM_ICONS.get(int(item_id))
    if not rel:
        return None
    return rel if rel.startswith("/") else f"/assets/{rel}"


def ball_name(ball_id) -> str:
    return BALL_NAMES.get(int(ball_id), f"Ball #{ball_id}")


def pokemon_name(species_id) -> str:
    return POKEMON_NAMES.get(int(species_id), f"Pokémon #{species_id}")
'''
open(out, "w", encoding="utf8").write(hdr + body)
print(len(items), len(sp))
