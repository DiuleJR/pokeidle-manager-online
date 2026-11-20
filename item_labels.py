"""Nomes e ícones de itens como o jogo mostra hoje.

O items.json do site ainda traz "TM Disk Piece" e o ícone antigo, mas o cliente do jogo reescreve na tela
(shared/nome-zmove.mjs e app.js do pokeidle.io): o fragmento vira "Fragmento de Z-Move", os discos elementais
viram "Z-Move TIPO" e os três itens de TM têm ícones novos em /img/itens/zmove/. Aqui fica a mesma regra, para
o painel mostrar o mesmo que o jogo. As tabelas geradas (game_data.py) continuam com os nomes originais, que
são os que o servidor usa nas vendas.
"""
from __future__ import annotations

import re

from game_data import ITEM_NAMES, item_icon_path as _raw_icon, item_name as _raw_name

NOME_FRAGMENTO = "Fragmento de Z-Move"
_PECA = re.compile(r"(AoE )?\bTM Disk Piece\b")
_DISCO = re.compile(r"\b([A-Za-z]+)-Type TM Disk\b( Piece)?")

_ZMOVE_DIR = "/img/itens/zmove"
_TIPOS = {"normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground", "flying", "psychic",
          "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy"}

ICONES: dict[int, str] = {
    59194: f"{_ZMOVE_DIR}/fragmento.png",   # Fragmento de Z-Move (era "TM Disk Piece")
    40530: f"{_ZMOVE_DIR}/aoe-peca.png",    # AoE TM Disk Piece
    40575: f"{_ZMOVE_DIR}/aoe-disco.png",   # AoE TM Disk
}
for _id, _nome in ITEM_NAMES.items():       # discos elementais: um ícone por tipo
    _m = re.fullmatch(r"([A-Za-z]+)-Type TM Disk", str(_nome))
    if _m and _m.group(1).lower() in _TIPOS:
        ICONES[int(_id)] = f"{_ZMOVE_DIR}/{_m.group(1).lower()}.png"


def display_name(text: str | None) -> str:
    """"TM Disk Piece" -> "Fragmento de Z-Move"; "Fire-Type TM Disk" -> "Z-Move FIRE"; o resto passa igual.
    Aceita também uma descrição inteira ("6× TM Disk Piece")."""
    s = str(text or "")
    if "TM Disk" not in s:
        return s
    s = _PECA.sub(lambda m: m.group(0) if m.group(1) else NOME_FRAGMENTO, s)
    return _DISCO.sub(lambda m: m.group(0) if m.group(2) else f"Z-Move {m.group(1).upper()}", s)


def item_name(item_id) -> str:
    return display_name(_raw_name(item_id))


def item_icon_path(item_id) -> str | None:
    return ICONES.get(int(item_id)) or _raw_icon(item_id)
