"""Chat do jogo no painel: lê o chat público pelas contas conectadas e envia mensagens por uma conta à escolha.

- Leitura: TODAS as contas online alimentam o mesmo buffer. Como cada mensagem tem `id`, as repetidas se
  descartam sozinhas; se uma conta cai, as outras seguem alimentando (nenhuma "conta leitora" para eleger).
- Envio: o jogo é quem manda (`chat.send`). Antes, o painel aplica as mesmas travas do cliente oficial (nível
  mínimo, mute, link) e uma trava de frequência rígida, para nenhuma conta tomar mute por culpa do painel.
- Só os canais públicos (mundo, comércio, dúvidas) em português. Guild fica de fora desta versão.

Formato das mensagens que o jogo manda (lido do cliente oficial): `{t:"chat", id, ts, canal, idioma, de, nivel,
texto, cargo, guildTag, guildTagCor, ...}` e, no lugar do texto, objetos próprios: `shinyCaptura`, `lendarioCaptura`,
`dropLendario`/`dropMitico`, `pkShare`, `dexShare`, `anuncioChat`. Aqui tudo vira `{id, ts, canal, de, nivel, cargo,
guild, kind, text}`, com o texto já pronto para exibir.
"""
from __future__ import annotations

import asyncio
import json
import re
import time
from collections import deque
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from connection import AccountConnection

CHANNELS = ("mundo", "comercio", "duvidas")
LANG = "pt"
BUFFER_MAX = 200            # igual ao cliente oficial
MIN_LEVEL = 10              # nível mínimo da conta para falar (cliente oficial: CHAT_NIVEL_MIN)
MAX_LEN = 200               # tamanho máximo da mensagem (cliente oficial: maxLength do campo)
SEND_GAP_S = 3.0            # uma mensagem por conta a cada 3 s
DUP_WINDOW_S = 30.0         # a mesma frase na mesma conta, dentro desta janela, é recusada
HISTORY_RETRY_S = 60.0      # reaviso de histórico enquanto um canal estiver vazio
SUB_QUEUE_MAX = 200

_LINK = re.compile(r"(https?://|www\.|\b[a-z0-9-]+\.(com|net|org|io|gg|br|app|dev|xyz|gl|ly|me|co|tv|gg)\b|discord\.gg/)", re.I)


_HEX = re.compile(r"#[0-9a-fA-F]{3,8}")


class ChatError(Exception):
    """Recusa do envio. `code` é estável (a tela decide o aviso); `text` já vai em português."""

    def __init__(self, code: str, text: str, status: int = 400, wait: float = 0.0) -> None:
        super().__init__(text)
        self.code, self.text, self.status, self.wait = code, text, status, wait


def _s(v, n: int = 80) -> str:
    return str(v if v is not None else "")[:n]


def _fmt(n) -> str:
    try:
        return f"{int(n):,}".replace(",", ".")
    except (TypeError, ValueError):
        return _s(n, 20)


def _summary(m: dict) -> tuple[str, str] | None:
    """(kind, texto) das mensagens especiais; None quando não há o que mostrar."""
    if isinstance(m.get("shinyCaptura"), dict):
        s = m["shinyCaptura"]
        verbo = "chocou um ovo e veio" if s.get("ovo") else "capturou"
        return "shiny", f"✨ {_s(s.get('nick'), 20)} {verbo} um {_s(s.get('nome'), 40)} shiny!"
    for key in ("lendarioCaptura",):
        if isinstance(m.get(key), dict):
            s = m[key]
            raro = "mítico" if s.get("mitico") else "lendário"
            shiny = " shiny" if s.get("shiny") else ""
            return "rare", f"🌟 {_s(s.get('nick'), 20)} capturou o {raro}{shiny} {_s(s.get('nome'), 40)}!"
    drop = m.get("dropLendario") or m.get("dropMitico")
    if isinstance(drop, dict):
        item = "uma bicicleta" if drop.get("tipo") == "bicicleta" else "uma casa"
        raro = "lendário" if m.get("dropLendario") else "mítico"
        return "rare", f"🎁 {_s(drop.get('nick'), 20)} ganhou {item} {raro}!"
    if isinstance(m.get("pkShare"), dict):
        s = m["pkShare"]
        return "share", f"mostrou o Pokémon {_s(s.get('apelido') or s.get('nome'), 40)}"
    if isinstance(m.get("dexShare"), dict):
        return "share", f"mostrou a Pokédex de {_s(m['dexShare'].get('nome'), 40)}"
    a = m.get("anuncioChat")
    if isinstance(a, dict) and a.get("id"):
        moeda = "Gemas" if a.get("moeda") == "orb" else "Gold"
        qtd = int(a.get("qtd") or 1)
        nome = _s(a.get("nome"), 60)
        cada = " cada" if qtd > 1 else ""
        return "ad", f"estou anunciando {qtd}x {nome} por {_fmt(a.get('preco'))} {moeda}{cada}, confira meu anúncio!"
    return None


def _pokemon_link(m: dict) -> dict | None:
    """O Pokémon que a mensagem cita (compartilhado, capturado shiny/lendário): `{nick, id, label}`.
    O painel abre a ficha pedindo `chat.verPokemon` ao jogo; `label` é o trecho do texto que vira link."""
    for key, label_keys in (("pkShare", ("apelido", "nome")), ("shinyCaptura", ("nome",)), ("lendarioCaptura", ("nome",))):
        s = m.get(key)
        if not isinstance(s, dict):
            continue
        try:
            pid = int(s.get("pokemonId") or 0)
        except (TypeError, ValueError):
            continue
        nick = _s(s.get("nick"), 24)
        label = next((_s(s.get(k), 40) for k in label_keys if s.get(k)), "")
        if pid > 0 and nick and label:
            return {"nick": nick, "id": pid, "label": label}
    return None


def normalize(m: dict, canal: str | None = None) -> dict | None:
    """Mensagem do jogo -> mensagem do painel (None = descartar)."""
    if not isinstance(m, dict) or m.get("id") is None or m.get("apagada"):
        return None
    canal = canal or m.get("canal")
    if canal not in CHANNELS or (m.get("idioma") or LANG) != LANG:
        return None
    special = _summary(m)
    if special:
        kind, text = special
    elif isinstance(m.get("texto"), str) and m["texto"].strip():
        kind, text = "msg", m["texto"][:400]
    else:
        return None
    ad = None
    if kind == "ad":
        a = m["anuncioChat"]
        ad = {"qtd": int(a.get("qtd") or 1), "nome": _s(a.get("nome"), 60), "preco": _fmt(a.get("preco")),
              "moeda": "gemas" if a.get("moeda") == "orb" else "gold", "id": int(a["id"])}
    cargo = re.sub(r"[^a-z]", "", _s(m.get("cargo"), 20).lower())      # vira classe de cor na tela: só letras
    color = _s(m.get("guildTagCor"), 9)
    return {
        "id": m["id"], "ts": int(m.get("ts") or time.time() * 1000), "canal": canal, "de": _s(m.get("de"), 24),
        "nivel": m.get("nivel") if isinstance(m.get("nivel"), (int, float)) else None,
        "cargo": cargo or None, "guild": _s(m.get("guildTag"), 6) or None,
        "guildColor": color if _HEX.fullmatch(color) else None,
        "kind": kind, "text": text, "ad": ad, "pk": _pokemon_link(m),
    }


class ChatHub:
    def __init__(self) -> None:
        self.buffers: dict[str, deque] = {c: deque(maxlen=BUFFER_MAX) for c in CHANNELS}
        self._ids: dict[str, set] = {c: set() for c in CHANNELS}
        self._subs: set[asyncio.Queue] = set()
        self._asked: dict[str, float] = {}
        self._last_sent: dict[int, float] = {}
        self._last_text: dict[int, tuple[str, float]] = {}

    # ------------------------------------------------------------ leitura
    def _add(self, row: dict) -> bool:
        canal = row["canal"]
        if row["id"] in self._ids[canal]:
            return False
        buf = self.buffers[canal]
        if len(buf) == buf.maxlen:                      # a mais antiga sai: libera o id também
            self._ids[canal].discard(buf[0]["id"])
        buf.append(row)
        self._ids[canal].add(row["id"])
        return True

    def handle_frame(self, conn: "AccountConnection", msg: dict) -> None:
        """Chamado por cada conta para cada frame recebido; só mexe nos de chat."""
        t = msg.get("t")
        if not isinstance(t, str) or not t.startswith("chat"):
            return
        if t == "chat":
            row = normalize(msg)
            if row and self._add(row):
                self._publish({"type": "chat", "msg": row})
        elif t == "chat.historico":
            canal = msg.get("canal")
            if canal not in CHANNELS:
                return
            rows = [r for r in (normalize(m, canal) for m in msg.get("mensagens") or []) if r]
            novas = [r for r in sorted(rows, key=lambda r: r["ts"]) if self._add(r)]
            if novas:
                # o histórico chega por trás: reordena o buffer por horário
                ordered = sorted(self.buffers[canal], key=lambda r: r["ts"])
                self.buffers[canal].clear()
                self.buffers[canal].extend(ordered)
                self._publish({"type": "history", "canal": canal, "msgs": ordered})
        elif t == "chat.del":
            self.delete(msg.get("id"))
        elif t == "chat.mute":
            conn.chat_mute_until = float(msg.get("ate") or 0)
            self._publish({"type": "notice", "account": f"acc{conn.acc.index}", "code": "muted",
                           "text": f"{conn.acc.nick}: o chat está silenciado nesta conta."})
        elif t == "chat.aviso":
            self._publish({"type": "notice", "account": f"acc{conn.acc.index}", "code": _s(msg.get("chave"), 60),
                           "text": f"{conn.acc.nick}: o jogo recusou a mensagem ({_s(msg.get('chave'), 60)})."})

    def delete(self, msg_id) -> None:
        for canal in CHANNELS:
            if msg_id in self._ids[canal]:
                kept = [r for r in self.buffers[canal] if r["id"] != msg_id]
                self.buffers[canal].clear()
                self.buffers[canal].extend(kept)
                self._ids[canal].discard(msg_id)
                self._publish({"type": "del", "canal": canal, "id": msg_id})

    def messages(self, canal: str) -> list[dict]:
        return list(self.buffers.get(canal, ()))

    async def on_online(self, conn: "AccountConnection") -> None:
        """Uma conta ficou online: pede o histórico dos canais que ainda estão vazios (uma conta por canal)."""
        now = time.monotonic()
        for canal in CHANNELS:
            if self.buffers[canal] or now - self._asked.get(canal, -1e9) < HISTORY_RETRY_S:
                continue
            self._asked[canal] = now
            await conn.send_frame({"t": "chat.historico", "canal": canal})

    # ------------------------------------------------------------ tempo real
    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=SUB_QUEUE_MAX)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subs.discard(q)

    def _publish(self, event: dict) -> None:
        for q in list(self._subs):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:           # cliente lento: derruba o fluxo dele; ele recarrega o histórico
                self._subs.discard(q)

    # ------------------------------------------------------------ envio
    def check_send(self, conn: "AccountConnection", canal: str, texto: str, now: float | None = None) -> str:
        """Valida antes de mandar ao jogo. Devolve o texto limpo ou levanta ChatError."""
        now = time.monotonic() if now is None else now
        texto = " ".join(str(texto or "").split())
        if canal not in CHANNELS:
            raise ChatError("channel", "Canal inválido.")
        if not texto:
            raise ChatError("empty", "Escreva uma mensagem.")
        if len(texto) > MAX_LEN:
            raise ChatError("long", f"Mensagem longa demais (máximo {MAX_LEN} caracteres).")
        if not conn.can_send:
            raise ChatError("offline", "Essa conta está offline.", 409)
        if int(conn.estado.get("level") or 0) < MIN_LEVEL:
            raise ChatError("level", f"A conta precisa de nível {MIN_LEVEL} para falar no chat.")
        if conn.chat_mute_until and conn.chat_mute_until > time.time() * 1000:
            raise ChatError("muted", "O chat desta conta está silenciado pelo jogo.", 403)
        if _LINK.search(texto):
            raise ChatError("link", "Links não são permitidos no chat.")
        idx = conn.acc.index
        gap = now - self._last_sent.get(idx, -1e9)
        if gap < SEND_GAP_S:
            wait = SEND_GAP_S - gap
            raise ChatError("rate", f"Calma: aguarde {wait:.0f} s para enviar de novo.", 429, wait)
        last = self._last_text.get(idx)
        if last and last[0] == texto.lower() and now - last[1] < DUP_WINDOW_S:
            raise ChatError("dup", "Você acabou de enviar essa mensagem.", 429)
        return texto

    async def send(self, conn: "AccountConnection", canal: str, texto: str) -> None:
        texto = self.check_send(conn, canal, texto)
        now = time.monotonic()
        self._last_sent[conn.acc.index] = now
        self._last_text[conn.acc.index] = (texto.lower(), now)
        await conn.send_frame({"t": "chat.send", "canal": canal, "idioma": LANG, "texto": texto})


def frame_json(frame: dict) -> str:
    return json.dumps(frame, ensure_ascii=False)
