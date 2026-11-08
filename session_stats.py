"""Itens raros coletados na sessão (soma dos aumentos de quantidade em estado.items).

Só conta aumentos: gastar/vender não desconta o que já foi coletado. O baseline é
refeito a cada `welcome` (reconexão), sem zerar os acumulados.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile

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

    def save(self, key: str, started_at: float | None, gained: dict[str, int]) -> None:
        self._data[key] = {"started_at": started_at, "gained": dict(gained)}
        try:
            fd, tmp = tempfile.mkstemp(dir=os.path.dirname(self.path), suffix=".tmp")
            with os.fdopen(fd, "w", encoding="utf8") as fh:
                json.dump(self._data, fh)
            os.replace(tmp, self.path)
        except OSError as e:
            log.warning("não consegui gravar %s: %s", self.path, e)
