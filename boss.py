"""Bosses (arenas lendárias): catálogo, rodízio de prêmios, entrar/sair/repetir e o histórico das lutas.

Protocolo (lido do cliente do jogo; ver docs/13-boss.md):
    Cliente -> Servidor   boss.entrar {key}          entra na arena do boss (paga a entrada)
                          boss.sair                  abandona a luta
                          boss.auto {ativo, key}     "Repetir automaticamente": cura no Centro e volta
    Servidor -> Cliente   welcome.bossesCatalogo     todos os bosses (nome, nível, região, tipos, drops)
                          welcome.bossesJogaveis     os que já têm arena (entrada, equipe ideal, drops por prêmio)
                          batalha.ev k=bossEntrou / bossMorto / bossPerdeu / bossSaiu / bossAuto
                          estado.boss {arena, auto, autoKey, vitorias}

O prêmio de cada boss de uma região gira todo dia às 18h (Brasília): o rodízio abaixo é o mesmo cálculo do jogo
(`shared/bosses-lendarios.mjs`), então a tela mostra o prêmio de hoje, de amanhã e de depois sem perguntar ao servidor.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone

log = logging.getLogger("boss")

PREMIOS = ("tm", "mega", "tickets")          # PREMIOS_DA_TRINCA
ROTACAO_DIA_ZERO = "2026-11-17"             # ROTACAO_BOSS_DIA_ZERO
DIA_MS = 86_400_000
# O dia do rodízio vira às 18h de Brasília: UTC-3 menos a antecipação de 6 h do "dia sazonal" do jogo.
DESLOCAMENTO_MS = 3 * 3_600_000 - 6 * 3_600_000
RECENT_KEEP = 20

TRIOS = {
    "kanto": "Trio Aves Lendárias", "johto": "Trio Bestas Lendárias", "hoenn": "Trio Climático",
    "sinnoh": "Trio da Criação", "unova": 'Trio "Tao"', "kalos": "Trio da Aura", "alola": "Trio da Luz",
    "galar": "Trio do Combate", "paldea": "Trio da Lealdade",
}


def _dias(chave: str) -> int:
    return round(datetime.fromisoformat(chave).replace(tzinfo=timezone.utc).timestamp() * 1000 / DIA_MS)


def _chave_do_dia(t_ms: float) -> str:
    return datetime.fromtimestamp((t_ms - DESLOCAMENTO_MS) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def rotation_day(t_ms: float) -> int:
    """Dia do ciclo de 3 dias (0, 1 ou 2) em `t_ms`."""
    return (_dias(_chave_do_dia(t_ms)) - _dias(ROTACAO_DIA_ZERO)) % len(PREMIOS)


def prize_for(position, day: int) -> str:
    try:
        p, d = int(position), int(day)
    except (TypeError, ValueError):
        return PREMIOS[0]
    return PREMIOS[(p - d) % len(PREMIOS)]


def next_rotation_ms(t_ms: float) -> int:
    inicio = ((int(t_ms) - DESLOCAMENTO_MS) // DIA_MS) * DIA_MS + DESLOCAMENTO_MS
    return inicio + DIA_MS


def _num(v, default=0):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else default


REVIVE_ID = 205              # Revive (600 gold); o Max Revive (206) custa 2.500: o mais barato é sempre o 205
REVIVE_BATCH = 100           # compra de 100 em 100 quando o estoque zera
REVIVE_RETRY_S = 30.0        # não repete a compra/ativação antes disso (ex.: gold insuficiente)
TOKEN_ID = 70000             # Bronze Boss Token
SETTLE_S = 1.5               # parado esse tempo (sem arena nem repetir), a série acabou
HEAL_LOCK_MAX_S = 90.0       # espera máxima pela trava de combate antes de ir ao Centro
HEAL_WAIT_S = 20.0           # espera pelo Centro (e, antes de entrar no boss, pela vida cheia)
ENTER_RETRY_S = 3.0          # reenvia boss.entrar enquanto a arena não abre
ENTER_WAIT_S = 20.0          # sem arena nesse tempo depois de boss.entrar, desiste
STUCK_S = 25.0               # repetir ligado, sem arena e sem fichas: desliga e encerra
HUNT_BACK_S = 10.0           # espera pela confirmação da volta à hunt
POLL_S = 0.5

PHASES = ("healing", "entering", "fighting", "returning")


class BossManager:
    """Um por conta: orquestra a luta (cura, entra, repete, cura, volta à hunt), acompanha a série em andamento
    (vitórias, drops, fichas gastas), a vida do boss e o histórico da sessão."""

    def __init__(self, account_name: str, estado: dict, conn=None, buy_revive: bool = False) -> None:
        self.account_name = account_name
        self.estado = estado
        self.conn = conn                 # AccountConnection (cura, hunt, loja, automação); None nos testes
        self.buy_revive = buy_revive
        self._ws = None
        self._task = None
        self.recent: list[dict] = []     # lutas desta sessão (mais recente primeiro)
        self.wins = 0
        self.losses = 0
        self.series: dict | None = None  # série em andamento: vitórias, derrotas, entradas e drops acumulados
        self.summary: dict | None = None # última série encerrada (o "Resumo dos bosses" do jogo)
        self.run: dict | None = None     # orquestração em andamento: {key, phase, returnSlug, error}
        self._mobs: dict[int, dict] = {}
        self._revive_at = 0.0
        self._auto_revive_at = 0.0
        self.raid: dict | None = None    # última resposta do `raid.info` (Raid semanal Gigantamax)
        self.raid_at = 0.0               # monotonic do último pedido
        self.raid_offset = 0             # relógio do servidor menos o local (ms)

    # --------------------------------------------------------------- conexão
    def bind(self, ws) -> None:
        self._ws = ws

    def unbind(self) -> None:
        self._ws = None
        self.cancel()

    # ----------------------------------------------------------------- estado
    @property
    def state(self) -> dict:
        b = self.estado.get("boss")
        return b if isinstance(b, dict) else {}

    @property
    def arena(self) -> dict | None:
        a = self.state.get("arena")
        return a if isinstance(a, dict) else None

    @property
    def auto(self) -> bool:
        return bool(self.state.get("auto"))

    @property
    def auto_key(self) -> str | None:
        k = self.state.get("autoKey")
        return k if isinstance(k, str) else None

    def victories(self) -> dict[str, int]:
        v = self.state.get("vitorias")
        return {str(k): int(n) for k, n in v.items() if isinstance(n, (int, float))} if isinstance(v, dict) else {}

    @property
    def busy(self) -> bool:
        return bool(self._task and not self._task.done())

    def _items(self) -> dict:
        it = self.estado.get("items")
        return it if isinstance(it, dict) else {}

    def stock(self, item_id: int) -> int:
        return int(_num(self._items().get(str(item_id), self._items().get(item_id)), 0))

    # ----------------------------------------------------------------- vida do boss
    def hp_view(self) -> dict | None:
        """Vida do boss em luta: o `campo` do jogo manda `hp`/`mhp` de cada mob; os golpes atualizam `hpAlvo`."""
        a = self.arena
        if not a:
            return None
        mob = self._mobs.get(a.get("slot")) if a.get("slot") is not None else None
        if mob is None and self._mobs:
            mob = max(self._mobs.values(), key=lambda m: m.get("maxHp") or 0)
        if not mob or not mob.get("maxHp"):
            return None
        return {"hp": max(0, int(mob.get("hp", mob["maxHp"]))), "maxHp": int(mob["maxHp"]), "name": mob.get("name")}

    # ----------------------------------------------------------------- frames
    def handle_frame(self, msg: dict) -> None:
        t = msg.get("t")
        if self.run and self.run.get("phase") == "entering" and t not in ("campo",):
            seen = self.run.setdefault("seen", [])         # diagnóstico: o que o jogo respondeu ao pedido
            if len(seen) < 12:
                seen.append(t if t != "batalha" else "batalha:" + ",".join(str(e.get("k")) for e in msg.get("ev") or [] if isinstance(e, dict)))
        if t == "batalha":
            for ev in msg.get("ev") or []:
                if not isinstance(ev, dict):
                    continue
                k = str(ev.get("k", ""))
                if k.startswith("boss"):
                    self._on_event(ev)
                elif k == "revive" and self.series is not None:
                    self.series["revives"] += 1          # o auto-revive do jogo usou um Revive
                    self.series["touchedAt"] = time.monotonic()
                elif k == "ataque" and ev.get("slot") in self._mobs and isinstance(ev.get("hpAlvo"), (int, float)):
                    self._mobs[ev["slot"]]["hp"] = ev["hpAlvo"]
        elif t == "raid":
            self.raid = msg
            if isinstance(msg.get("agora"), (int, float)):
                self.raid_offset = int(msg["agora"]) - int(time.time() * 1000)
        elif t in ("campo", "campo.init"):
            if t == "campo.init":
                self._mobs.clear()
            if t == "campo.init" or self.arena:
                self._track_mobs(msg.get("mobs"))
        elif t == "erro" and self.run and self.run.get("phase") in ("entering", "healing"):
            log.warning("[%s] o jogo recusou: %s", self.account_name, json.dumps(msg, ensure_ascii=False)[:300])
            self.run["error"] = str(msg.get("msg") or msg.get("chave") or "O jogo recusou o desafio")

    def _track_mobs(self, mobs) -> None:
        for m in mobs or []:
            if not isinstance(m, dict) or m.get("s") is None:
                continue
            e = self._mobs.setdefault(m["s"], {})
            if "mhp" in m:
                e["maxHp"] = m["mhp"]
            if "hp" in m:
                e["hp"] = m["hp"]
            if "n" in m:
                e["name"] = m["n"]
            if m.get("x"):
                e["hp"] = 0
        if len(self._mobs) > 60:                      # só guarda os mais recentes
            for k in list(self._mobs)[:-60]:
                del self._mobs[k]

    def _entry_qty(self, key) -> int:
        if self.conn is not None:
            for b in getattr(self.conn, "boss_playable", []):
                if b.get("key") == key:
                    return int(_num((b.get("entrada") or {}).get("qtd"), 1)) or 1
        return 1

    def _new_series(self, key, name) -> dict:
        return {"key": key, "name": name, "startedAt": int(time.time() * 1000), "wins": 0, "losses": 0,
                "entries": 0, "tokens": 0, "revives": 0, "items": {}, "touchedAt": time.monotonic()}

    def _on_event(self, ev: dict) -> None:
        k = ev.get("k")
        key = ev.get("key") or (self.arena or {}).get("key") or (self.run or {}).get("key") or self.auto_key
        name = ev.get("nome")
        if k == "bossEntrou":
            if self.series is None:
                self.series = self._new_series(key, name)
            self.series["key"] = key or self.series["key"]
            self.series["name"] = name or self.series["name"]
            self.series["entries"] += 1
            self.series["tokens"] += self._entry_qty(key)
            self.series["touchedAt"] = time.monotonic()
            log.info("[%s] entrou na arena de %s", self.account_name, name)
        elif k == "bossMorto":
            self.wins += 1
            boss = self.estado.get("boss")
            if isinstance(key, str) and isinstance(boss, dict):
                v = boss.setdefault("vitorias", {})
                if isinstance(v, dict):
                    v[key] = int(_num(v.get(key))) + 1
            drops = [{"itemId": d.get("itemId"), "name": d.get("nome"), "qty": int(_num(d.get("qtd"), 1))}
                     for d in (ev.get("drops") or []) if isinstance(d, dict)]
            if self.series is None:
                self.series = self._new_series(key, name)
            s = self.series
            s["wins"] += 1
            s["touchedAt"] = time.monotonic()
            for d in drops:
                row = s["items"].setdefault(str(d["itemId"]), {"itemId": d["itemId"], "name": d["name"], "qty": 0})
                row["qty"] += d["qty"]
            self._remember({"won": True, "key": key, "name": name, "drops": drops,
                            "xpTrainer": int(_num(ev.get("xpTreinador"), _num(ev.get("xp")))),
                            "xpPokemon": int(_num(ev.get("xpPokemon"), _num(ev.get("xp")))),
                            "auto": bool(ev.get("auto"))})
            log.info("[%s] boss derrotado: %s (%d itens)", self.account_name, name, len(drops))
        elif k == "bossPerdeu":
            self.losses += 1
            if self.series is not None:
                self.series["losses"] += 1
                self.series["touchedAt"] = time.monotonic()
            self._remember({"won": False, "key": key, "name": name, "drops": [], "auto": False})
            log.info("[%s] perdeu para o boss %s", self.account_name, name)
        elif k == "bossSaiu":
            if self.series is not None:
                self.series["touchedAt"] = time.monotonic()
            log.info("[%s] saiu da arena do boss", self.account_name)
        elif k == "bossAuto":
            log.info("[%s] repetir boss %s", self.account_name, "ligado" if ev.get("ativo") else "desligado")

    def _remember(self, row: dict) -> None:
        row["at"] = int(time.time() * 1000)
        self.recent.insert(0, row)
        del self.recent[RECENT_KEEP:]

    # ------------------------------------------------------------------ série
    def settle(self) -> None:
        """Encerra a série quando o jogo parou (sem arena, sem repetir) há alguns segundos: vira o "Resumo dos bosses"."""
        s = self.series
        if s is None or self.arena or self.auto or self._running():
            return
        if time.monotonic() - s["touchedAt"] < SETTLE_S:
            return
        self._finish_series("done")

    def _finish_series(self, reason: str) -> None:
        s, self.series = self.series, None
        if s is None:
            return
        s["endedAt"] = int(time.time() * 1000)
        s["reason"] = reason
        s.pop("touchedAt", None)
        self.summary = s
        log.info("[%s] série de boss encerrada: %d vitórias, %d fichas, %d tipos de item",
                 self.account_name, s["wins"], s["tokens"], len(s["items"]))

    def _running(self) -> bool:
        return bool(self.run and not self.run.get("finished"))

    def active(self) -> bool:
        return bool(self.arena or self.auto or self._running() or self.series)

    # --------------------------------------------------------------- comandos
    async def _send(self, frame: dict) -> None:
        if self._ws is None:
            raise RuntimeError("conta offline")
        await self._ws.send(json.dumps(frame))

    async def enter(self, key: str) -> None:
        await self._send({"t": "boss.entrar", "key": key})
        log.info("[%s] boss.entrar %s", self.account_name, key)

    async def leave(self) -> None:
        await self._send({"t": "boss.sair"})
        log.info("[%s] boss.sair", self.account_name)

    def raid_now_ms(self) -> int:
        return int(time.time() * 1000) + self.raid_offset

    async def request_raid(self, max_age: float = 5.0) -> None:
        """Pede o estado do Raid semanal (edição, inscritos, a minha inscrição). Só leitura."""
        if self._ws is None or time.monotonic() - self.raid_at < max_age:
            return
        self.raid_at = time.monotonic()
        await self._send({"t": "raid.info"})

    async def enroll_raid(self) -> None:
        """Inscreve a conta no Raid da semana (gasta 1 Bronze Boss Token; sem volta, como no jogo)."""
        await self._send({"t": "raid.inscrever"})
        self.raid_at = 0.0
        log.info("[%s] raid.inscrever", self.account_name)

    async def set_auto(self, on: bool, key: str) -> None:
        await self._send({"t": "boss.auto", "ativo": bool(on), "key": key})
        log.info("[%s] boss.auto ativo=%s key=%s", self.account_name, on, key)

    # -------------------------------------------------------------- orquestração
    def start(self, key: str) -> None:
        """Começa a luta do jeito do jogador: Centro (cura), boss, e depois cura de novo e volta à hunt."""
        if self.busy:
            raise RuntimeError("já há uma luta em andamento nesta conta")
        slug = self.estado.get("huntSlug") or (getattr(getattr(self.conn, "acc", None), "hunt_slug", None))
        self.summary = None
        self.series = None
        self.run = {"key": key, "phase": "healing", "returnSlug": slug, "error": None,
                    "startedAt": int(time.time() * 1000)}
        self._task = asyncio.create_task(self._run(key))

    def cancel(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
        self._task = None
        self.run = None

    async def stop(self) -> None:
        """Para: abandona a luta, desliga o repetir e deixa a orquestração curar e voltar à hunt."""
        key = (self.run or {}).get("key") or self.auto_key or (self.arena or {}).get("key")
        if self.auto and key:
            await self.set_auto(False, key)
        if self.arena:
            await self.leave()
        if self.run:
            self.run["stopping"] = True

    async def _run(self, key: str) -> None:
        run = self.run
        try:
            await self.ensure_revive()
            await self._heal()
            run["phase"] = "entering"
            if not self.arena:
                await self.enter(key)
                t0 = last = time.monotonic()
                while not self._entered():
                    if run.get("error"):
                        raise RuntimeError(run["error"])
                    now = time.monotonic()
                    if now - t0 > ENTER_WAIT_S:
                        log.warning("[%s] arena não abriu; frames vistos: %s", self.account_name, run.get("seen"))
                        raise RuntimeError("O jogo não abriu a arena. Confira fichas, nível e a equipe.")
                    if now - last >= ENTER_RETRY_S:          # o jogo às vezes ignora o pedido logo depois da cura
                        last = now
                        await self.enter(key)
                    await asyncio.sleep(POLL_S / 2)
            run["phase"] = "fighting"
            await self._fight(key)
            self._finish_series("done")
            run["phase"] = "returning"
            await self._heal(wait_hp=False)          # o resumo já saiu: vai ao Centro e volta, sem esperar mais nada
            await self._return_to_hunt(run.get("returnSlug"))
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - o erro vira mensagem na tela, a conta continua
            log.warning("[%s] luta de boss interrompida: %s", self.account_name, e)
            run["error"] = str(e)
            run["phase"] = "failed"
            self._finish_series("failed")
            try:
                await self._return_to_hunt(run.get("returnSlug"))
            except Exception:  # noqa: BLE001
                pass
        finally:
            if self.run is run:
                if run.get("phase") != "failed":
                    self.run = None
                else:
                    run["finished"] = True           # a tela mostra o erro até a próxima luta

    def _entered(self) -> bool:
        return bool(self.arena or (self.series and self.series.get("entries")))

    async def _fight(self, key: str) -> None:
        idle_since = None
        stuck_since = None
        while True:
            await asyncio.sleep(POLL_S)
            await self.ensure_revive()
            if self.arena:
                idle_since = stuck_since = None
                continue
            if self.auto:
                # entre uma luta e outra o servidor cura e volta: só desiste se faltarem fichas por muito tempo
                have = self.stock(TOKEN_ID)
                if have >= self._entry_qty(key):
                    stuck_since = None
                    continue
                stuck_since = stuck_since or time.monotonic()
                if time.monotonic() - stuck_since > STUCK_S:
                    await self.set_auto(False, self.auto_key or key)
                continue
            idle_since = idle_since or time.monotonic()
            if time.monotonic() - idle_since >= SETTLE_S:
                return

    async def _heal(self, wait_hp: bool = True) -> None:
        """Vai ao Pokémon Center (espera a trava de combate acabar) e pede a cura à enfermeira, que é instantânea.
        `wait_hp` espera a vida cheia chegar (antes de entrar no boss); na volta para a hunt não espera."""
        c = self.conn
        if c is None or not c.can_send:
            return
        t0 = time.monotonic()
        while c.combat_lock_ms() > 0 and time.monotonic() - t0 < HEAL_LOCK_MAX_S:
            await asyncio.sleep(min(2.0, c.combat_lock_ms() / 1000 + 0.3))
        if not self.estado.get("noCentro"):
            await c.hunt.go_to_center()
            t1 = time.monotonic()
            while not self.estado.get("noCentro") and time.monotonic() - t1 < HEAL_WAIT_S:
                await asyncio.sleep(0.2)
        if self._team_full():
            return
        await self._send({"t": "centro.curar"})      # a enfermeira cura na hora
        log.info("[%s] centro.curar", self.account_name)
        if not wait_hp:
            return                                   # a cura é instantânea: já pode voltar para a hunt
        t2 = time.monotonic()
        while not self._team_full() and time.monotonic() - t2 < HEAL_WAIT_S:
            await asyncio.sleep(0.2)

    def _team_full(self) -> bool:
        team = [p for p in (self.estado.get("pokemons") or []) if isinstance(p, dict) and p.get("slot") is not None]
        return all((p.get("hp") or 0) >= (p.get("maxHp") or 0) for p in team)

    async def _return_to_hunt(self, slug) -> None:
        c = self.conn
        if c is None or not slug or not c.can_send:
            return
        for _ in range(2):
            if self.estado.get("huntSlug") == slug and not self.estado.get("noCentro"):
                return
            await c.hunt.select_hunt(slug)
            t0 = time.monotonic()
            while time.monotonic() - t0 < HUNT_BACK_S:
                if self.estado.get("huntSlug") == slug and not self.estado.get("noCentro"):
                    return
                await asyncio.sleep(0.2)
        log.warning("[%s] não consegui voltar para a hunt %s depois do boss", self.account_name, slug)

    # ------------------------------------------------------------------ revive
    async def ensure_revive(self) -> None:
        """Com a opção ligada: liga o auto-revive do jogo se estiver desligado e compra 100 Revives quando zerar."""
        c = self.conn
        if not self.buy_revive or c is None or not c.can_send:
            return
        now = time.monotonic()
        auto = self.estado.get("automation") or {}
        if not auto.get("autoRevive") and now - self._auto_revive_at > REVIVE_RETRY_S:
            self._auto_revive_at = now
            await c.set_automation({"autoRevive": True})
        if self.stock(REVIVE_ID) <= 0 and now - self._revive_at > REVIVE_RETRY_S and not c.shop.awaiting_confirmation:
            self._revive_at = now
            if await c.shop.buy("item", REVIVE_ID, REVIVE_BATCH):
                log.info("[%s] Revive zerou: comprando %d", self.account_name, REVIVE_BATCH)
