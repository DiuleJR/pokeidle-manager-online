import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "./admin";
import { everyWhileVisible } from "./visible";

export type BossPrize = "tm" | "mega" | "tickets";
export const PRIZE_LABEL: Record<BossPrize, string> = { tm: "TM", mega: "MEGA", tickets: "Tickets" };

export interface BossDrop {
  itemId: number | null;
  name: string;
  icon: string | null;
  /** Chance por vitória (0 a 1); null = sempre cai. */
  chance: number | null;
  qty: [number, number] | null;
}
export interface BossDay {
  prize: BossPrize | null;
  drops: BossDrop[];
}
export interface BossEntry {
  itemId: number | null;
  name: string;
  icon: string | null;
  qty: number;
}
export interface Boss {
  key: string;
  name: string;
  level: number;
  region: string | null;
  regionName: string;
  trio: string | null;
  position: number | null;
  looktype: number | null;
  img: string | null;
  pokeId: number | null;
  types: string[];
  playable: boolean;
  minTrainerLevel: number;
  teamLevel: number | null;
  idealTeam: number | null;
  entry: BossEntry | null;
  /** Hoje, amanhã e depois (o prêmio gira todo dia às 18h). */
  days: BossDay[];
  dropNames: string[];
}
export interface BossTeamMember {
  id: number;
  name: string;
  level: number;
  looktype: number | null;
  shiny: boolean;
  hp: number;
  maxHp: number;
}
export interface BossResult {
  won: boolean;
  key: string | null;
  name: string | null;
  at: number;
  auto: boolean;
  xpTrainer?: number;
  xpPokemon?: number;
  drops: { itemId: number | null; name: string | null; qty: number }[];
}
export interface BossSeriesItem {
  itemId: number | null;
  name: string;
  icon: string | null;
  qty: number;
}
/** Série de lutas (o "Resumo dos bosses" do jogo): tudo o que foi lutado desde a primeira entrada até parar. */
export interface BossSeries {
  key: string | null;
  name: string | null;
  startedAt: number;
  endedAt?: number;
  reason?: string;
  wins: number;
  losses: number;
  entries: number;
  /** Fichas de entrada gastas. */
  tokens: number;
  /** Revives usados pelo auto-revive durante a série. */
  revives: number;
  items: BossSeriesItem[];
}
export type BossPhase = "healing" | "entering" | "fighting" | "returning" | "failed";
export interface BossRun {
  key: string;
  phase: BossPhase;
  error: string | null;
  returnSlug: string | null;
  stopping: boolean;
  finished: boolean;
  startedAt: number;
}
export interface BossAccount {
  id: number;
  nick: string;
  level: number;
  online: boolean;
  /** Quantidade que a conta tem de cada item citado nos bosses (fichas de entrada e drops). */
  items: Record<string, number>;
  arena: { key: string | null; name: string | null } | null;
  auto: boolean;
  autoKey: string | null;
  wins: Record<string, number>;
  team: BossTeamMember[];
  session: { wins: number; losses: number };
  recent: BossResult[];
  /** Em arena, repetindo, com a orquestração rodando ou com uma série aberta. */
  active: boolean;
  run: BossRun | null;
  /** Vida do boss que está sendo enfrentado. */
  hp: { hp: number; maxHp: number; name: string | null } | null;
  series: BossSeries | null;
  summary: BossSeries | null;
  buyRevive: boolean;
  revives: number;
  raid: RaidMine | null;
}
export interface RaidMove {
  n: string;
  t: string;
}
export interface RaidInfo {
  agora: number;
  /** Relógio do servidor menos o do navegador no momento da leitura (ms). */
  offset: number;
  edicao: {
    id: string;
    numero: number;
    dia: string;
    inscricoesDe: number;
    inscricoesAte: number;
    equipeAte: number;
    batalhaEm: number;
    transmissaoEm: number;
    fimEm: number;
  };
  gigantamax: { dex: number; nome: string; tipos: string[]; golpes: { gmax: RaidMove; max: RaidMove; onda: RaidMove }; sprite: string; quadro?: number; hpMax: number };
  token: { itemId: number; qtd: number };
  maxEquipe: number;
  bonus: { max: number; xpMax: number; farmMax: number; horas: number; tabela: { resto: number; bonus: number; xp: number; farm: number }[] };
  inscritos: number;
  hasResult: boolean;
}
export interface RaidMine {
  inscrito?: boolean;
  equipeIds?: number[];
  dano?: number;
  posicao?: number;
}
export type RaidPhase = "antes" | "inscricoes" | "preparo" | "portal" | "batalha" | "resultado" | "fim";

/** Mesmas fases do jogo, calculadas com o relógio do servidor. */
export function raidPhase(r: RaidInfo, now: number): RaidPhase {
  const e = r.edicao;
  if (now < e.inscricoesDe) return "antes";
  if (now < e.inscricoesAte) return "inscricoes";
  if (now < e.batalhaEm) return "preparo";
  if (now < e.transmissaoEm) return "portal";
  if (now >= e.fimEm) return "fim";
  return r.hasResult ? "resultado" : "batalha";
}

/** "5d 12:36:46", como o relógio do jogo. */
export function raidClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return d > 0 ? `${d}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

/** "5d 12h", curto, para a lista. */
export function raidShort(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export interface BossOverview {
  ts: number;
  nextRotation: number;
  catalog: Boss[];
  raid: RaidInfo | null;
  /** Nome e ícone do Revive que o painel compra. */
  revive: { itemId: number; name: string; icon: string | null } | null;
  accounts: BossAccount[];
}

export const bossApi = {
  overview: () => call<BossOverview>("GET", "/api/bosses"),
  enter: (id: number, key: string) => call<{ ok: boolean }>("POST", `/api/bosses/${id}/enter`, { key }),
  leave: (id: number) => call<{ ok: boolean }>("POST", `/api/bosses/${id}/leave`),
  enrollRaid: (id: number) => call<{ ok: boolean }>("POST", `/api/bosses/${id}/raid/enroll`),
  revive: (id: number, on: boolean) => call<{ ok: boolean }>("POST", `/api/bosses/${id}/revive`, { on }),
  auto: (id: number, key: string, on: boolean) => call<{ ok: boolean }>("POST", `/api/bosses/${id}/auto`, { key, on }),
};

/** Lê os bosses a cada 2 s com a aba aberta e visível; `refresh()` força uma leitura depois de uma ação. */
export function useBosses() {
  const [data, setData] = useState<BossOverview | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const d = await bossApi.overview();
      if (alive.current) {
        setData(d);
        setError("");
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Falha ao ler os bosses");
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const stop = everyWhileVisible(() => void refresh(), 2000, { always: true });
    return () => {
      alive.current = false;
      stop();
    };
  }, [refresh]);

  return { data, error, refresh };
}

export type Rarity = "comum" | "incomum" | "rara" | "mitica" | "lendaria";
export const RARITY_LABEL: Record<Rarity, string> = { comum: "COMUM", incomum: "INCOMUM", rara: "RARA", mitica: "MÍTICA", lendaria: "LENDÁRIA" };
export const RARITY_COLOR: Record<Rarity, string> = { comum: "#8c8c8c", incomum: "#5aa83a", rara: "#3d8bff", mitica: "#b66bff", lendaria: "#f3b13a" };

/** Mesmas faixas do jogo. */
export function rarityOf(chance: number | null): Rarity {
  if (chance == null || chance >= 0.25) return "comum";
  if (chance >= 0.02) return "incomum";
  if (chance >= 0.005) return "rara";
  if (chance >= 0.001) return "mitica";
  return "lendaria";
}

export const PHASE_LABEL: Record<BossPhase, string> = {
  healing: "Curando no Centro",
  entering: "Entrando na arena",
  fighting: "Lutando",
  returning: "Curando e voltando à hunt",
  failed: "Não foi possível lutar",
};

export function chanceLabel(chance: number): string {
  const pct = chance * 100;
  const digits = pct > 0 && pct < 0.1 ? 4 : 2;
  return `${pct.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",")}%`;
}

/** Penalidade de equipe fraca, igual à do jogo: cada "membro" que falta para o nível do boss triplica o dano recebido. */
export function teamPenalty(team: BossTeamMember[], boss: Pick<Boss, "teamLevel" | "idealTeam">) {
  const lvl = boss.teamLevel ?? 0;
  const strength = lvl > 0 ? team.reduce((s, k) => s + Math.min(1, k.level / lvl), 0) : team.length;
  const deficit = Math.max(0, (boss.idealTeam ?? 5) - strength);
  return { strength, deficit, mult: Math.pow(3, deficit), strong: lvl > 0 ? team.filter((k) => k.level >= lvl).length : team.length };
}
