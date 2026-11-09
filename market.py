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
import time

log = logging.getLogger("market")

REQUEST_TIMEOUT_S = 12
BUY_TIMEOUT_S = 20
MIN_GAP_S = 0.5            # espaço mínimo entre dois pedidos da mesma conta
VALID_MOEDAS = ("gold", "orb")


class MarketError(Exception):
    """Falha de uma consulta ao mercado (conta offline, tempo esgotado...)."""


def _match_aba(aba: str, **extra):
    def match(msg: dict) -> bool:
        if msg.get("t") != "market" or msg.get("aba") != aba:
            return False
        return all(msg.get(k) == v for k, v in extra.items())
    return match


class MarketClient:
    def __init__(self, account_name: str, estado: dict) -> None:
        self.account_name = account_name
        self.estado = estado
        self._ws = None
        self._lock = asyncio.Lock()            # um pedido de consulta por vez
        self._waiter: tuple | None = None      # (match_fn, future)
        self._buy: tuple | None = None         # (listing_id, future)
        self._last_sent = 0.0
        self._seq = 0
        self.clock_offset_ms = 0               # servidorAgora - relógio local
        self.events: list = []                 # callbacks(ev) para eventos de mercado (marketVendido etc.)

    # ------------------------------------------------------------ ciclo
    def bind(self, ws) -> None:
        self._ws = ws
        self._cancel(MarketError("conexão reiniciada"))

    def unbind(self) -> None:
        self._ws = None
        self._cancel(MarketError("conta offline"))

    def _cancel(self, exc: Exception) -> None:
        for slot in (self._waiter, self._buy):
            if slot is not None and not slot[1].done():
                slot[1].set_exception(exc)
        self._waiter = None
        self._buy = None

    @property
    def online(self) -> bool:
        return self._ws is not None

    def server_now_ms(self) -> int:
        return int(time.time() * 1000) + self.clock_offset_ms

    # ------------------------------------------------------------ frames
    def handle_frame(self, msg: dict) -> None:
        t = msg.get("t")
        if t == "estado":
            agora = (msg.get("estado") or {}).get("servidorAgora")
            if isinstance(agora, (int, float)):
                self.clock_offset_ms = int(agora) - int(time.time() * 1000)
            return
        if t in ("market", "orbs"):
            w = self._waiter
            if w is not None and not w[1].done() and w[0](msg):
                w[1].set_result(msg)
            return
        if t == "erro" and self._buy is not None and not self._buy[1].done():
            self._buy[1].set_result({"status": "recusado", "detail": str(msg.get("chave") or "erro")})
            return
        if t != "batalha":
            return
        for ev in msg.get("ev", []) or []:
            if not isinstance(ev, dict):
                continue
            self._handle_event(ev)

    def _handle_event(self, ev: dict) -> None:
        k = ev.get("k")
        b = self._buy
        if k == "marketComprado" and b is not None and not b[1].done():
            b[1].set_result({"status": "comprado", "detail": ev.get("descricao") or "",
                             "total": ev.get("total"), "moeda": ev.get("moeda")})
        elif k == "aviso" and b is not None and not b[1].done():
            msg = str(ev.get("msg") or "")
            if msg == "market.sorteioPerdeu":
                b[1].set_result({"status": "perdeu_sorteio", "detail": "perdeu o sorteio"})
            elif msg.startswith("market.") and msg != "market.sorteio":
                b[1].set_result({"status": "recusado", "detail": msg})
        elif k == "mktSorteio" and ev.get("tipo") == "fim" and b is not None and not b[1].done():
            # só cobre o caso de o servidor usar a janela do sorteio; o resultado final vem em marketComprado
            if ev.get("levou") is False:
                b[1].set_result({"status": "perdeu_sorteio", "detail": "perdeu o sorteio"})
        if k and str(k).startswith("market"):
            for cb in self.events:
                try:
                    cb(ev)
                except Exception:  # noqa: BLE001 - um callback ruim não derruba a conexão
                    log.exception("[%s] callback de evento de mercado falhou", self.account_name)

    # ------------------------------------------------------------ envio
    async def _send(self, frame: dict) -> None:
        if self._ws is None:
            raise MarketError("conta offline")
        gap = MIN_GAP_S - (time.monotonic() - self._last_sent)
        if gap > 0:
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

        status: comprado | perdeu_sorteio | recusado | timeout. Perder o sorteio não custa nada.
        `preco` é o preço por unidade que o cliente espera pagar (o servidor confere)."""
        moeda = _moeda(moeda)
        if qtd < 1 or preco < 1:
            raise MarketError("quantidade e preço precisam ser positivos")
        if self._buy is not None and not self._buy[1].done():
            raise MarketError("já há uma compra em andamento nesta conta")
        fut = asyncio.get_running_loop().create_future()
        self._buy = (int(listing_id), fut)
        try:
            await self._send({"t": "market.comprar", "id": int(listing_id), "qtd": int(qtd),
                              "preco": int(preco), "moeda": moeda})
            return await asyncio.wait_for(asyncio.shield(fut), BUY_TIMEOUT_S)
        except asyncio.TimeoutError:
            return {"status": "timeout", "detail": "sem resposta do servidor"}
        finally:
            if self._buy is not None and self._buy[1] is fut:
                self._buy = None


def _moeda(moeda: str) -> str:
    if moeda not in VALID_MOEDAS:
        raise MarketError(f"moeda inválida: {moeda!r}")
    return moeda
