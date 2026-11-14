"""Itens raros coletados na sessão (soma dos aumentos de quantidade em estado.items).

Só conta aumentos: gastar/vender não desconta o que já foi coletado. O baseline é
refeito a cada `welcome` (reconexão), sem zerar os acumulados.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import time

log = logging.getLogger(__name__)

# chave exposta no snapshot -> itemIds somados
TRACKED: dict[str, frozenset[int]] = {
    "boss": frozenset({70000}),   # Bronze Boss Token
    "key": frozenset({70011}),    # Fragmento de Chave
    "shinyStone": frozenset({70012}),  # Fragmento de Shiny Stone
    "bike": frozenset({70013}),   # Fragmento de Bicicleta
}


ITEM_LABELS: dict[str, str] = {
    "boss": "Bronze Boss Token",
    "key": "Fragmento de Chave",
    "shinyStone": "Fragmento de Shiny Stone",
    "bike": "Fragmento de Bicicleta",
}


def _counts(estado: dict) -> dict[str, int]:
    items = estado.get("items") or {}
    out = {}
    for key, ids in TRACKED.items():
        total = 0
        for iid in ids:
            try:
                total += int(items.get(str(iid), items.get(iid, 0)) or 0)
            except (TypeError, ValueError):
                pass
        out[key] = total
    return out


class SessionItems:
    def __init__(self) -> None:
        self.gained = {k: 0 for k in TRACKED}
        self._last: dict[str, int] | None = None

    def reset(self, estado: dict) -> None:
        """Novo baseline (welcome); mantém o acumulado."""
        self._last = _counts(estado)

    def update(self, estado: dict) -> None:
        now = _counts(estado)
        if self._last is not None:
            for k, v in now.items():
                if v > self._last[k]:
                    self.gained[k] += v - self._last[k]
        self._last = now


def hunt_is_outland(hunts: list, slug: str | None) -> bool | None:
    """True/False se a hunt é de Outland; None se não dá para saber (hunt fora do catálogo ou sem área)."""
    hunt = next((h for h in hunts if isinstance(h, dict) and h.get("slug") == slug), None)
    if not hunt:
        return None
    area, region = hunt.get("area"), hunt.get("regiao")
    if not (area or region):
        return None
    return any(str(v or "").lower().startswith("outland") for v in (area, region))

class ShinyTracker:
    """Conta resultados por slot e associa uma fuga à tentativa falha correspondente."""
    def __init__(self) -> None:
        self.encounters = {}
        self.seen = 0
        self.captured = 0

    def handle(self, event: dict) -> tuple[bool, bool]:
        now = time.monotonic()
        self.encounters = {k: v for k, v in self.encounters.items() if now - v["time"] < 60}
        kind, slot = event.get("k"), event.get("slot")
        if kind == "morte" and event.get("quem") == "selvagem" and slot is not None:
            self.encounters[slot] = {"name": event.get("nome"), "seen": False, "captured": False, "failed": None, "time": now}
        elif kind == "bola" and slot is not None:
            e = self.encounters.setdefault(slot, {"name": event.get("nome"), "seen": False, "captured": False, "failed": None, "time": now})
            e["time"] = now
            shiny, success = event.get("shiny") is True, event.get("sucesso") is True
            seen, captured = shiny and not e["seen"], shiny and success and not e["captured"]
            e["seen"] |= shiny
            e["captured"] |= captured
            e["failed"] = now if shiny and not success else None
            self.seen += seen
            self.captured += captured
            return seen, captured
        elif kind == "fugiu" and event.get("shiny") is True:
            name = str(event.get("nome") or "").strip().casefold()
            matches = [e for k, e in self.encounters.items() if e["seen"] and e["failed"] is not None
                       and now - e["failed"] < 10 and ((slot is not None and k == slot and
                       (not e["name"] or str(e["name"]).strip().casefold() == name)) or
                       (slot is None and name and e["name"] and str(e["name"]).strip().casefold() == name))]
            if len(matches) == 1:
                matches[0]["failed"] = None
            else:
                self.seen += 1
                return True, False
        return False, False


class SessionStore:
    """Persiste a sessão de cada conta (início + itens coletados) em um JSON, para
    sobreviver a reinícios do bot/VPS. Escrita atômica (arquivo temporário + replace).
    Caminho: env SESSION_FILE (padrão: session_state.json ao lado do código)."""

    _shared: "SessionStore | None" = None

    def __init__(self, path: str | None = None) -> None:
        self.path = path or os.getenv("SESSION_FILE") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "session_state.json")
        self._data: dict[str, dict] = {}
        try:
            with open(self.path, encoding="utf8") as fh:
                loaded = json.load(fh)
            if isinstance(loaded, dict):
                self._data = loaded
        except FileNotFoundError:
            pass
        except (OSError, ValueError) as e:
            log.warning("session_state ilegível (%s); começando do zero", e)

    @classmethod
    def shared(cls) -> "SessionStore":
        if cls._shared is None:
            cls._shared = cls()
        return cls._shared

    def get(self, key: str) -> dict | None:
        v = self._data.get(key)
        return v if isinstance(v, dict) else None

    def delete(self, key: str) -> None:
        if self._data.pop(key, None) is not None:
            self._write()

    def save(self, key: str, started_at: float | None, gained: dict[str, int], shinies: dict | None = None) -> None:
        self._data[key] = {"started_at": started_at, "gained": dict(gained), "shinies": dict(shinies or {})}
        self._write()

    def _write(self) -> None:
        try:
            fd, tmp = tempfile.mkstemp(dir=os.path.dirname(self.path), suffix=".tmp")
            with os.fdopen(fd, "w", encoding="utf8") as fh:
                json.dump(self._data, fh)
            os.replace(tmp, self.path)
        except OSError as e:
            log.warning("não consegui gravar %s: %s", self.path, e)
