from item_labels import display_name, item_icon_path, item_name


def test_fragmento_e_discos_com_o_nome_do_jogo():
    assert display_name("TM Disk Piece") == "Fragmento de Z-Move"
    assert display_name("6× TM Disk Piece") == "6× Fragmento de Z-Move"
    assert display_name("Fire-Type TM Disk") == "Z-Move FIRE"
    # o que não muda
    assert display_name("AoE TM Disk Piece") == "AoE TM Disk Piece"
    assert display_name("AoE TM Disk") == "AoE TM Disk"
    assert display_name("Cocoon Stone") == "Cocoon Stone"
    assert display_name(None) == ""


def test_nomes_por_id():
    assert item_name(59194) == "Fragmento de Z-Move"
    assert item_name(40530) == "AoE TM Disk Piece"
    assert item_name(59201) == "Z-Move FIRE"


def test_icones_novos():
    assert item_icon_path(59194) == "/img/itens/zmove/fragmento.png"
    assert item_icon_path(40530) == "/img/itens/zmove/aoe-peca.png"
    assert item_icon_path(40575) == "/img/itens/zmove/aoe-disco.png"
    assert item_icon_path(59201) == "/img/itens/zmove/fire.png"
    assert item_icon_path(59247) == "/img/itens/zmove/fairy.png"
    # item qualquer continua com o ícone do items-icons.json
    assert item_icon_path(30) == "/assets/site/assets/items/dark_gem.png"
