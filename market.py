"""Cliente do Mercado da Comunidade (por conta): consultas, histórico, carteira de Gemas
(somente leitura) e compra de um anúncio.

Mensagens do protocolo usadas (lidas do cliente web do jogo; as respostas de itens, item,
vitrine e compra foram confirmadas por captura, as demais seguem o código do cliente):

    market.itens          -> {t:"market", aba:"itens", resumo:{itemId:{anuncios,unidades,minGold,minOrb}}, medias}
    market.medias         -> {t:"market", aba:"medias", dias, medias:{itemId:{gold:{media,unidades}, orb:{...}}}}
    market.item           -> {t:"market", aba:"item", itemId, moeda, linhas:[anúncio]}
    market.listar         -> {t:"market", aba:"vitrine", total, pagina, porPagina, linhas:[anúncio]}
    market.historicoGlobal-> {t:"market", aba:"historicoGlobal", seq, pagina, linhas:[venda]}
    market.historico / market.historicoCompras -> idem, extrato da própria conta (abas "historico"/"historicoCompras")
    market.meus           -> {t:"market", aba:"meus", linhas:[anúncio]}
    orbs.painel           -> {t:"orbs", saldo, precos, saques, extrato, caixa, ...}  (SÓ LEITURA)
    market.comprar        -> batalha.ev: marketComprado | aviso market.sorteio / market.sorteioPerdeu

O bot NUNCA envia `orbs.sacar` nem `banco.coins`: saque e envio de dinheiro ficam de fora de
propósito (dinheiro real, sem estorno).
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections import deque

log = logging.getLogger("market")

REQUEST_TIMEOUT_S = 12
BUY_TIMEOUT_S = 20
MIN_GAP_S = 0.5            # espaço mínimo entre dois pedidos da mesma conta (a compra é exceção)
CLOCK_WINDOW_S = 300       # amostras do relógio do servidor que valem para estimar a diferença
FIRE_MARGIN_S = 0.02       # a compra sai 20 ms depois da liberação, nunca antes
VALID_MOEDAS = ("gold", "orb")


class MarketError(Exception):
    """Falha de uma consulta ao mercado (conta offline, tempo esgotado...)."""


def _match_aba(aba: str, **extra):
    def match(msg: dict) -> bool:
        if msg.get("t") != "market" or msg.get("aba") != aba:
            return False
        return all(msg.get(k) == v for k, v in extra.items())
    return match


class _Buy:
    """Uma compra no ar. A resposta do jogo não traz o ID do anúncio, então várias compras da mesma conta
    são casadas pela ordem de envio (e pelo total, quando o jogo informa)."""

    __slots__ = ("listing_id", "qty", "price", "fut", "state")

    def __init__(self, listing_id: int, qty: int, price: int, fut) -> None:
        self.listing_id, self.qty, self.price, self.fut = listing_id, qty, price, fut
        self.state = "enviada"        # -> "sorteio" quando o jogo confirma que entrou no sorteio


class MarketClient:
    def __init__(self, account_name: str, estado: dict) -> None:
        self.account_name = account_name
        self.estado = estado
        self._ws = None
        self._lock = asyncio.Lock()            # um pedido de consulta por vez
        self._waiter: tuple | None = None      # (match_fn, future)
        self._buys: list[_Buy] = []            # compras no ar (podem ser várias ao mesmo tempo)
        self._last_sent = 0.0
        self._seq = 0
        self._fixed_offset = 0                 # usado enquanto não há amostra (e nos testes)
        self._clock: deque[tuple[float, int]] = deque(maxlen=400)   # (quando, servidorAgora - relógio local)
        self.events: list = []                 # callbacks(ev) para eventos de mercado (marketVendido etc.)

    # ------------------------------------------------------------ ciclo
    def bind(self, ws) -> None:
        self._ws = ws
        self._cancel(MarketError("conexão reiniciada"))

    def unbind(self) -> None:
        self._ws = None
        self._cancel(MarketError("conta offline"))

    def _cancel(self, exc: Exception) -> None:
        if self._waiter is not None and not self._waiter[1].done():
            self._waiter[1].set_exception(exc)
        for b in self._buys:
            if not b.fut.done():
                b.fut.set_exception(exc)
        self._waiter = None
        self._buys = []

    @property
    def online(self) -> bool:
        return self._ws is not None

    # ------------------------------------------------------------ relógio do servidor
    @property
    def clock_offset_ms(self) -> int:
        """Diferença (servidor - relógio local) em ms. Cada amostra chega atrasada pela rede, o que só a
        deixa MENOR que a verdadeira: a maior das últimas amostras é a menos atrasada, a mais fiel."""
        cut = time.monotonic() - CLOCK_WINDOW_S
        best = [o for t, o in self._clock if t >= cut]
        return max(best) if best else self._fixed_offset

    @clock_offset_ms.setter
    def clock_offset_ms(self, value: int) -> None:
        self._clock.clear()
        self._fixed_offset = int(value)

    def note_server_time(self, agora_ms: float) -> None:
        self._clock.append((time.monotonic(), int(agora_ms) - int(time.time() * 1000)))

    def server_now_ms(self) -> int:
        return int(time.time() * 1000) + self.clock_offset_ms

    async def sleep_until_server(self, target_ms: float) -> None:
        """Espera até o relógio do servidor passar de `target_ms` (+ margem). Reavalia o relógio a cada
        passo, então uma amostra ruim no começo de uma espera longa não desloca o disparo."""
        goal = float(target_ms) + FIRE_MARGIN_S * 1000
        while True:
            remaining = (goal - self.server_now_ms()) / 1000
            if remaining <= 0:
                return
            await asyncio.sleep(min(remaining - 0.3, 5.0) if remaining > 0.6 else remaining)

    # ------------------------------------------------------------ frames
    def _pending(self) -> list[_Buy]:
        return [b for b in self._buys if not b.fut.done()]

    def _trace(self, what: str, data) -> None:
        """Diagnóstico: o que o servidor mandou enquanto uma compra estava no ar."""
        pend = self._pending()
        if pend:
            ids = ",".join(f"#{b.listing_id}" for b in pend)
            log.info("[%s] compras no ar %s: %s %s", self.account_name, ids, what, json.dumps(data, ensure_ascii=False)[:300])

    def handle_frame(self, msg: dict) -> None:
        t = msg.get("t")
        if t == "erro":
            self._trace("frame", {k: v for k, v in msg.items() if k != "estado"})
        if t == "estado":
            agora = (msg.get("estado") or {}).get("servidorAgora")
            if isinstance(agora, (int, float)):
                self.note_server_time(agora)
            return
        if t in ("market", "orbs"):
            w = self._waiter
            if w is not None and not w[1].done() and w[0](msg):
                w[1].set_result(msg)
            return
        if t == "erro":
            self._settle(self._oldest("enviada"), {"status": "recusado", "detail": str(msg.get("chave") or "erro")})
            return
        if t != "batalha":
            return
        for ev in msg.get("ev", []) or []:
            if not isinstance(ev, dict):
                continue
            self._handle_event(ev)

    def _oldest(self, *states: str) -> _Buy | None:
        """A compra mais antiga num dos estados (ou, se não houver, a mais antiga de todas)."""
        pend = self._pending()
        for st in states:
            for b in pend:
                if b.state == st:
                    return b
        return pend[0] if pend else None

    @staticmethod
    def _settle(b: _Buy | None, result: dict) -> None:
        if b is not None and not b.fut.done():
            b.fut.set_result(result)

    def _match_paid(self, ev: dict) -> _Buy | None:
        """De qual compra é este 'comprado'? Pelo total (quantidade × preço); sem isso, pela ordem."""
        pend = self._pending()
        total = ev.get("total")
        qm = re.match(r"\s*(\d+)\s*×", str(ev.get("descricao") or ""))
        qty = int(qm.group(1)) if qm else None
        exact = [b for b in pend if isinstance(total, (int, float)) and b.qty * b.price == int(total) and (qty is None or qty == b.qty)]
        for st in ("sorteio", "enviada"):
            for b in exact:
                if b.state == st:
                    return b
        return self._oldest("sorteio", "enviada")

    def _handle_event(self, ev: dict) -> None:
        k = ev.get("k")
        if k and (str(k).startswith(("market", "mkt")) or k == "aviso"):
            self._trace("evento", ev)
        if self._pending():
            if k == "marketComprado":
                self._settle(self._match_paid(ev), {"status": "comprado", "detail": ev.get("descricao") or "",
                                                    "total": ev.get("total"), "moeda": ev.get("moeda")})
            elif k == "aviso":
                self._handle_aviso(str(ev.get("msg") or ""))
            elif k == "mktSorteio" and ev.get("tipo") == "fim" and ev.get("levou") is False:
                # só cobre o caso de o servidor usar a janela do sorteio; o resultado final vem em marketComprado
                self._settle(self._oldest("sorteio"), {"status": "perdeu_sorteio", "detail": "perdeu o sorteio"})
        if k and str(k).startswith("market"):
            for cb in self.events:
                try:
                    cb(ev)
                except Exception:  # noqa: BLE001 - um callback ruim não derruba a conexão
                    log.exception("[%s] callback de evento de mercado falhou", self.account_name)

    def _handle_aviso(self, msg: str) -> None:
        low = msg.lower()
        if msg == "market.sorteio":                       # confirmou a entrada: o resultado vem depois
            b = self._oldest("enviada")
            if b is not None and b.state == "enviada":
                b.state = "sorteio"
        elif msg == "market.sorteioPerdeu":
            self._settle(self._oldest("sorteio", "enviada"), {"status": "perdeu_sorteio", "detail": "perdeu o sorteio"})
        elif msg.startswith("market."):
            self._settle(self._oldest("enviada"), {"status": "recusado", "detail": msg})
        elif "anúncio já saiu" in low:
            # outro jogador (ou outra conta) levou antes: o servidor avisa em texto, sem prefixo "market."
            self._settle(self._oldest("enviada"), {"status": "indisponivel", "detail": "o anúncio já foi vendido"})
        elif low.startswith("só restam"):
            n = re.search(r"\d+", msg)
            self._settle(self._oldest("enviada"), {"status": "indisponivel", "detail": msg, "restam": int(n.group()) if n else 0})

    # ------------------------------------------------------------ envio
    async def _send(self, frame: dict, urgent: bool = False) -> None:
        if self._ws is None:
            raise MarketError("conta offline")
        gap = MIN_GAP_S - (time.monotonic() - self._last_sent)
        if gap > 0 and not urgent:   # a compra não espera: cada milissegundo conta no sorteio
            await asyncio.sleep(gap)
        self._last_sent = time.monotonic()
        await self._ws.send(json.dumps(frame))

    async def request(self, frame: dict, match, timeout: float = REQUEST_TIMEOUT_S) -> dict:
        """Envia `frame` e devolve a primeira resposta que `match` aceitar."""
        async with self._lock:
            fut = asyncio.get_running_loop().create_future()
            self._waiter = (match, fut)
            try:
                await self._send(frame)
                return await asyncio.wait_for(fut, timeout)
            except asyncio.TimeoutError:
                raise MarketError("o servidor não respondeu a tempo") from None
            finally:
                if self._waiter is not None and self._waiter[1] is fut:
                    self._waiter = None

    # ------------------------------------------------------------ consultas
    async def itens(self, elementos: list[str] | None = None, categoria: str = "") -> dict:
        frame = {"t": "market.itens", "elemento": "", "categoria": categoria}
        if elementos:
            frame["elementos"] = elementos
        return await self.request(frame, _match_aba("itens"))

    async def medias(self) -> dict:
        return await self.request({"t": "market.medias"}, _match_aba("medias"))

    async def item(self, item_id: int, moeda: str) -> dict:
        moeda = _moeda(moeda)
        return await self.request({"t": "market.item", "itemId": int(item_id), "moeda": moeda},
                                  _match_aba("item", itemId=int(item_id), moeda=moeda))

    async def listar(self, *, tipo: str = "pokemon", moeda: str = "gold", ordem: str = "baratos",
                     busca: str = "", elemento: str = "", pagina: int = 0, so_shiny: bool = False,
                     so_p5: bool = False, iv_min: int | str = "", nivel_min: int | str = "",
                     potencia_min: int | str = "", qualidade_min: int | str = "") -> dict:
        frame = {"t": "market.listar", "tipo": tipo, "moeda": _moeda(moeda), "busca": busca,
                 "ordem": ordem if ordem in ("recentes", "baratos", "caros") else "baratos",
                 "criterios": [], "elemento": elemento, "categoria": "",
                 "soShiny": bool(so_shiny), "soP5": bool(so_p5), "soTmElemental": False, "soTmAoe": False,
                 "ivMin": iv_min, "potenciaMin": potencia_min, "qualidadeMin": qualidade_min,
                 "nivelMin": nivel_min, "pagina": max(0, int(pagina))}
        return await self.request(frame, _match_aba("vitrine"))

    HISTORICOS = {"global": ("market.historicoGlobal", "historicoGlobal"),
                  "vendas": ("market.historico", "historico"),
                  "compras": ("market.historicoCompras", "historicoCompras")}

    async def historico(self, modo: str = "global", pagina: int = 0, filtros: dict | None = None) -> dict:
        """global = vendas de todo o servidor (a "Tabela de preços"); vendas/compras = extrato da conta."""
        if modo not in self.HISTORICOS:
            raise MarketError(f"histórico desconhecido: {modo!r}")
        msg_t, aba = self.HISTORICOS[modo]
        self._seq += 1
        seq = self._seq
        frame = {"t": msg_t, "pagina": max(0, int(pagina)), "seq": seq, **(filtros or {})}
        return await self.request(frame, _match_aba(aba, seq=seq))

    async def meus(self) -> dict:
        return await self.request({"t": "market.meus"}, _match_aba("meus"))

    async def orbs_painel(self) -> dict:
        """Carteira de Gemas (saldo, preços, saques, extrato). SOMENTE LEITURA."""
        return await self.request({"t": "orbs.painel"}, lambda m: m.get("t") == "orbs")

    # ------------------------------------------------------------ compra
    async def comprar(self, listing_id: int, qtd: int, preco: int, moeda: str) -> dict:
        """Compra `qtd` unidades de um anúncio. Resultado: {status, detail, total?}.

        status: comprado | perdeu_sorteio | indisponivel (já vendido ou "só restam N") | recusado | timeout. Perder o sorteio não custa nada.
        `preco` é o preço por unidade que o cliente espera pagar (o servidor confere)."""
        moeda = _moeda(moeda)
        if qtd < 1 or preco < 1:
            raise MarketError("quantidade e preço precisam ser positivos")
        fut = asyncio.get_running_loop().create_future()
        buy = _Buy(int(listing_id), int(qtd), int(preco), fut)
        self._buys.append(buy)      # várias compras ao mesmo tempo na mesma conta: nenhuma espera a outra
        try:
            await self._send({"t": "market.comprar", "id": int(listing_id), "qtd": int(qtd),
                              "preco": int(preco), "moeda": moeda}, urgent=True)
            log.info("[%s] compra #%s enviada (offset do relógio %+d ms)", self.account_name, listing_id, self.clock_offset_ms)
            return await asyncio.wait_for(asyncio.shield(fut), BUY_TIMEOUT_S)
        except asyncio.TimeoutError:
            return {"status": "timeout", "detail": "sem resposta do servidor"}
        finally:
            if buy in self._buys:
                self._buys.remove(buy)


def _moeda(moeda: str) -> str:
    if moeda not in VALID_MOEDAS:
        raise MarketError(f"moeda inválida: {moeda!r}")
    return moeda
