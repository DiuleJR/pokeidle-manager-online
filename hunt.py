"""Módulo de hunt/combate, baseado exclusivamente em spec do protocolo.

IMPORTANTE (leia antes de estender): a spec não documenta nenhum frame
Cliente → Servidor de "atacar". O combate contra o selvagem é narrado pelo
servidor via envelopes `batalha` (eventos `ataque` e `morte`) — é um idle
game, o cliente não decide o golpe nem quando atacar. Os únicos comandos
Cliente → Servidor confirmados neste doc são `hunt.select` e `centro.ir`.
Por isso este módulo **seleciona a hunt** e **consome/loga** os eventos de
batalha; não fabrica uma ação de "ataque" que a captura não comprova.

Responsabilidades:
    - Merge de patches `estado` (incluindo `pkMud`, que é mesclado por `id`
      em `estado.pokemons`, nunca substituído — campos ausentes mantêm o
      valor anterior, conforme a spec).
    - Processar envelopes `batalha.ev[]`: `hunt` (confirmação/início de
      sessão), `ataque` (HP do selvagem) e `morte` (kill, xp, gold, drops).
    - Expor `select_hunt()` / `go_to_center()` (os 2 comandos documentados).
    - Montar a linha de status por ciclo (Pokémon ativo, HP, XP/h, Gold/h,
      progresso da hunt).
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field

log = logging.getLogger("hunt")


@dataclass
class HuntSession:
    """Sessão de hunt corrente.

    Reinicia SOMENTE quando o servidor confirma `batalha.ev[].k == "hunt"`
    (spec: "Duração da Hunt no Dashboard") — reconexão, `estado.huntSlug`
    parcial ou `campo.init` isolados não reiniciam a duração.
    """
    slug: str | None
    nome: str | None = None
    started_at: float = field(default_factory=time.monotonic)
    kills: int = 0
    xp_ganho: int = 0
    gold_ganho: int = 0

    @property
    def elapsed_h(self) -> float:
        return max((time.monotonic() - self.started_at) / 3600, 1e-9)

    @property
    def xp_por_hora(self) -> float:
        return self.xp_ganho / self.elapsed_h

    @property
    def gold_por_hora(self) -> float:
        return self.gold_ganho / self.elapsed_h


class HuntManager:
    """Um HuntManager por conta.

    `estado` é o dict compartilhado da AccountConnection (mutado in-place).
    `hunts_catalog` é a lista `welcome.hunts` (usada só para exibir o
    progresso contra `totalSpawns`; a spec marca o significado exato de
    `pontos`/`totalSpawns` como ainda não confirmado, então tratamos esse
    progresso como aproximado/inferido nos logs).
    """

    def __init__(self, account_name: str, estado: dict, hunts_catalog: list):
        self.account_name = account_name
        self.estado = estado
        self.hunts_catalog = hunts_catalog
        self.session: HuntSession | None = None
        self._wild_hp: dict[int, int] = {}  # slot -> hpAlvo mais recente do selvagem
        self._ws = None  # setado por bind() a cada nova sessão de WebSocket
        self.on_kill = None  # callback(xp, gold) opcional, chamado a cada kill

    def bind(self, ws) -> None:
        """Associa a conexão WebSocket ativa (chamar a cada reconexão)."""
        self._ws = ws

    # ------------------------------------------------------------ comandos
    async def select_hunt(self, slug: str) -> None:
        """Cliente → Servidor: hunt.select (✅ confirmado por captura real)."""
        if self._ws is None:
            raise RuntimeError("HuntManager.bind(ws) não foi chamado")
        await self._ws.send(json.dumps({"t": "hunt.select", "slug": slug}))
        log.info("[%s] hunt.select slug=%s enviado", self.account_name, slug)

    async def go_to_center(self) -> None:
        """Cliente → Servidor: centro.ir (✅ confirmado por captura real)."""
        if self._ws is None:
            raise RuntimeError("HuntManager.bind(ws) não foi chamado")
        await self._ws.send(json.dumps({"t": "centro.ir"}))
        log.info("[%s] centro.ir enviado", self.account_name)

    # --------------------------------------------------------- bootstrap
    def on_welcome(self) -> None:
        """No primeiro welcome, usa estado.huntSlug como referência inicial
        (spec: "Duração da Hunt no Dashboard")."""
        self.session = HuntSession(slug=self.estado.get("huntSlug"))
        self._wild_hp.clear()

    # ------------------------------------------------------------ frames
    def handle_frame(self, msg: dict) -> None:
        """Chamar para cada frame recebido com `t` relevante a hunt/combate."""
        t = msg.get("t")
        if t == "estado":
            self._merge_estado_patch(msg.get("estado", {}))
        elif t == "batalha":
            for ev in msg.get("ev", []):
                self._handle_battle_event(ev)
        elif t == "campo.init":
            log.info("[%s] campo.init mapa=%s slug=%s", self.account_name,
                     msg.get("mapa"), msg.get("slug"))

    def _merge_estado_patch(self, patch: dict) -> None:
        """Merge parcial de `estado`; `pkMud` é tratado à parte (merge por id,
        nunca substitui a lista inteira de pokemons) e `pkFora` remove da lista
        local os Pokémon que o servidor parou de reportar (venda em massa do
        Depot — spec do protocolo §17.4 — e possivelmente outras
        saídas; a doc não confirma que o campo é exclusivo de venda, mas uma
        vez que o servidor para de enviar patches para esses IDs, mantê-los
        na lista local produz uma contagem de inventário errada)."""
        patch = dict(patch)  # não mutar o frame original
        pk_mud = patch.pop("pkMud", None)
        pk_fora = patch.pop("pkFora", None)
        self.estado.update(patch)
        if pk_mud:
            self._apply_pk_mud(pk_mud)
        if pk_fora:
            self._apply_pk_fora(pk_fora)

    def _apply_pk_mud(self, patches: list) -> None:
        pokemons = self.estado.setdefault("pokemons", [])
        by_id = {p.get("id"): p for p in pokemons if isinstance(p, dict)}
        for patch in patches:
            pid = patch.get("id")
            existing = by_id.get(pid)
            if existing is not None:
                existing.update(patch)  # mescla campo a campo; ausentes mantêm valor anterior
            else:
                pokemons.append(dict(patch))

    def _apply_pk_fora(self, ids: list) -> None:
        out_ids = {i for i in ids if isinstance(i, int)}
        pokemons = self.estado.get("pokemons")
        if not out_ids or not isinstance(pokemons, list):
            return
        before = len(pokemons)
        pokemons[:] = [p for p in pokemons if not (isinstance(p, dict) and p.get("id") in out_ids)]
        removed = before - len(pokemons)
        if removed:
            log.info("[%s] pkFora: %d pokémon removidos da lista local (%d ids recebidos)",
                      self.account_name, removed, len(out_ids))

    def _handle_battle_event(self, ev: dict) -> None:
        k = ev.get("k")
        if k == "hunt":
            # Única confirmação que reinicia a duração/sessão (spec).
            self.session = HuntSession(slug=ev.get("slug"), nome=ev.get("nome"))
            self._wild_hp.clear()
            log.info("[%s] Hunt confirmada: %s (%s)", self.account_name,
                     ev.get("nome"), ev.get("slug"))
        elif k == "ataque":
            slot, hp_alvo = ev.get("slot"), ev.get("hpAlvo")
            if slot is not None and hp_alvo is not None:
                self._wild_hp[slot] = hp_alvo
        elif k == "morte" and ev.get("quem") == "selvagem":
            self._on_wild_death(ev)
        elif k == "centro":
            log.info("[%s] centro.ir confirmado (motivo=%s)", self.account_name,
                     ev.get("motivo"))

    def _on_wild_death(self, ev: dict) -> None:
        if self.session is None:
            self.session = HuntSession(slug=self.estado.get("huntSlug"))
        s = self.session
        s.kills += 1
        s.xp_ganho += ev.get("xpTreinador", ev.get("xp", 0)) or 0
        s.gold_ganho += (ev.get("ouro", 0) or 0) + (ev.get("ouroVendaAuto", 0) or 0)
        if self.on_kill:
            self.on_kill(ev.get("xpTreinador", ev.get("xp", 0)) or 0,
                         (ev.get("ouro", 0) or 0) + (ev.get("ouroVendaAuto", 0) or 0))
        slot = ev.get("slot")
        if slot is not None:
            self._wild_hp.pop(slot, None)
        log.info("[%s] %s morreu (slot=%s) xp=%s gold=%s drops=%s",
                 self.account_name, ev.get("nome"), slot,
                 ev.get("xpTreinador", ev.get("xp")), ev.get("ouro"),
                 [d.get("nome") for d in ev.get("drops", [])])

    # ------------------------------------------------------------- status
    def active_pokemon(self) -> dict | None:
        """estado.activeId só é usado quando há correspondência inequívoca
        com estado.pokemons[].id (spec); não assume o primeiro da lista."""
        active_id = self.estado.get("activeId")
        if active_id is None:
            return None
        for p in self.estado.get("pokemons", []):
            if isinstance(p, dict) and p.get("id") == active_id:
                return p
        return None

    def _hunt_total_spawns(self, slug: str | None) -> int | None:
        if not slug:
            return None
        for h in self.hunts_catalog:
            if isinstance(h, dict) and h.get("slug") == slug:
                return h.get("totalSpawns")
        return None

    def status_line(self) -> str:
        """Linha de log por ciclo: Pokémon ativo, HP, XP/h, Gold/h, progresso."""
        pk = self.active_pokemon()
        if pk:
            pk_desc = (f"{pk.get('nome', '?')} Lv{pk.get('level', '?')} "
                      f"HP {pk.get('hp', '?')}/{pk.get('maxHp', '?')}")
        else:
            pk_desc = "Pokémon ativo desconhecido (activeId sem correspondência)"

        s = self.session
        if s is None:
            return f"{pk_desc} | hunt=? (sem sessão ainda)"

        total = self._hunt_total_spawns(s.slug)
        progresso = f"{s.kills}/{total} (aprox.)" if total else f"{s.kills} kills"

        return (f"{pk_desc} | hunt={s.slug or '?'} progresso={progresso} "
               f"xp/h={s.xp_por_hora:,.0f} gold/h={s.gold_por_hora:,.0f} "
               f"({s.elapsed_h * 60:.1f}min)")
