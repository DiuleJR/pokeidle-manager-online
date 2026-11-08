"""Visão de inventário por conta, baseada exclusivamente em
spec do protocolo (+ IDs de Balls/Potions já confirmados em
spec do protocolo e spec do protocolo).

Não introduz nenhum comando novo Cliente → Servidor: o inventário já
chega via `welcome`/patches `estado` (consumidos e mesclados pelo
HuntManager em hunt.py). Este módulo só lê `estado` e monta relatórios
legíveis: `estado.items` (itemId -> qtd), `estado.balls` (ballId -> qtd),
`estado.pokemons` (lista de instâncias) e `estado.pokedex`
(speciesId -> {k, c}, significado de k/c ainda não confirmado pela spec).

Nomes vêm de game_data.py (gerado dos JSONs do frontend do jogo). IDs que
nem o frontend conhece aparecem como "Item #<id>".
"""
from __future__ import annotations

from game_data import ball_name, item_name

POTION_IDS = frozenset({200, 201, 202, 203, 204, 70070})
POTION_NAMES = {i: item_name(i) for i in POTION_IDS}  # usado por telemetry.py


class InventoryView:
    """Somente leitura: `estado` é o dict compartilhado da AccountConnection
    (o mesmo mutado por HuntManager); este módulo nunca escreve nele."""

    def __init__(self, estado: dict):
        self.estado = estado

    # ------------------------------------------------------------ balls
    def balls(self) -> list[tuple[int, str, int]]:
        """[(ballId, nome, qtd), ...] ordenado por ballId."""
        raw = self.estado.get("balls", {})
        return sorted(
            ((int(bid), ball_name(bid), qtd)
             for bid, qtd in raw.items()),
            key=lambda t: t[0],
        )

    # ------------------------------------------------------------ items
    def items(self) -> list[tuple[int, str, int]]:
        """[(itemId, nome, qtd), ...] ordenado por quantidade desc."""
        raw = self.estado.get("items", {})
        return sorted(
            ((int(iid), item_name(iid), qtd)
             for iid, qtd in raw.items()),
            key=lambda t: -t[2],
        )

    def potions(self) -> list[tuple[int, str, int]]:
        """Subconjunto de items() que são Potions conhecidas."""
        return [t for t in self.items() if t[0] in POTION_IDS]

    # ---------------------------------------------------------- pokemons
    def pokemons(self) -> list[dict]:
        return [p for p in self.estado.get("pokemons", []) if isinstance(p, dict)]

    def pokemon_summary(self) -> dict:
        pks = self.pokemons()
        shiny = sum(1 for p in pks if p.get("shiny"))
        in_team = sum(1 for p in pks if p.get("slot") is not None)
        top = max(pks, key=lambda p: p.get("poder") or 0, default=None)
        return {
            "total": len(pks),
            "shiny": shiny,
            "no_time": in_team,
            "maior_poder": (top.get("nome"), top.get("poder")) if top else None,
        }

    # ----------------------------------------------------------- pokedex
    def pokedex_species_count(self) -> int:
        """Quantidade de espécies com entrada em estado.pokedex (k/c sem
        significado confirmado pela spec; só contamos presença)."""
        return len(self.estado.get("pokedex", {}))

    # ------------------------------------------------------------ report
    def summary_line(self) -> str:
        """Linha compacta pra juntar ao log de status por ciclo."""
        balls_txt = " ".join(f"{nome}={qtd}" for _, nome, qtd in self.balls())
        potions_txt = " ".join(f"{nome}={qtd}" for _, nome, qtd in self.potions())
        pk = self.pokemon_summary()
        return (f"balls[{balls_txt}] potions[{potions_txt}] "
               f"pokemons={pk['total']} shiny={pk['shiny']}")

    def full_report(self) -> str:
        """Relatório detalhado em várias linhas (uso sob demanda/periódico
        mais espaçado, não a cada ciclo de status)."""
        lines = ["== Inventário =="]
        lines.append("Balls: " + (", ".join(f"{n}={q}" for _, n, q in self.balls()) or "-"))
        lines.append("Items: " + (", ".join(f"{n}={q}" for _, n, q in self.items()) or "-"))
        pk = self.pokemon_summary()
        lines.append(f"Pokémons: total={pk['total']} shiny={pk['shiny']} "
                     f"no_time={pk['no_time']} maior_poder={pk['maior_poder']}")
        lines.append(f"Pokédex: {self.pokedex_species_count()} espécies registradas")
        return "\n".join(lines)
