import { call } from "./admin";
import { serverNow } from "./telemetry";

/**
 * Recompensas do PVP: a virada semanal (domingo 00:00 de Brasília), o Top mensal (dia 1º, 00:00 de Brasília) e as
 * tabelas de prêmio. As regras são as do jogo (shared/pvp-rank e shared/pvp-mensal).
 */
const SITE = "https://pokeidle.io";
const FUSO_BRASILIA_MS = 3 * 3_600_000;
const DIA_MS = 86_400_000;
const SEMANA_MS = 7 * DIA_MS;
export const APURANDO_SEMANA_MS = 90_000;
export const APURANDO_MES_MS = 5 * 60_000;

export type ClockKind = "week" | "month";
export interface Clock {
  start: number;
  end: number;
  /** ms que faltam para a virada */
  left: number;
  /** quanto do período já passou (0 a 1) */
  progress: number;
  /** a virada acabou de acontecer e o jogo ainda está apurando o resultado */
  counting: boolean;
  /** "" | "perto" (menos de 1 dia) | "brasa" (menos de 1 hora) | "apurando" */
  mood: "" | "perto" | "brasa" | "apurando";
}

export function clockOf(kind: ClockKind, now = serverNow()): Clock {
  const b = new Date(now - FUSO_BRASILIA_MS);
  const start =
    kind === "week"
      ? Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate() - b.getUTCDay()) + FUSO_BRASILIA_MS
      : Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 1) + FUSO_BRASILIA_MS;
  const end = kind === "week" ? start + SEMANA_MS : Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + 1, 1) + FUSO_BRASILIA_MS;
  const left = end - now;
  const since = now - start;
  const counting = since < (kind === "week" ? APURANDO_SEMANA_MS : APURANDO_MES_MS);
  const mood = counting ? "apurando" : left < 3_600_000 ? "brasa" : left < DIA_MS ? "perto" : "";
  return { start, end, left, progress: Math.max(0, Math.min(1, since / (end - start))), counting, mood };
}

/** "1d 21:44:38" ou "21:44:38". */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const p = (n: number) => String(n).padStart(2, "0");
  const hms = `${p(Math.floor((s % 86_400) / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  return d ? `${d}d ${hms}` : hms;
}

/** "novembro de 2026" a partir de "2026-11". */
export function monthName(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  if (!a || !m) return "";
  return new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
}

// ------------------------------------------------------------------ prêmios da semana
export type BoostKey = "shiny" | "captura" | "xp" | "pokexp";
export const BOOSTS: Record<BoostKey, { name: string; icon: string }> = {
  shiny: { name: "Shiny Secret Lure", icon: `${SITE}/assets/site/assets/loja/shinysecretlure.png` },
  captura: { name: "Capture Boost", icon: `${SITE}/assets/site/assets/loja/catch.png` },
  xp: { name: "XP Boost Trainer", icon: `${SITE}/assets/site/assets/loja/exp.png` },
  pokexp: { name: "XP Boost Pokemon", icon: `${SITE}/assets/site/assets/loja/boost.png` },
};
export const EGGS = {
  p2: { name: "Mystery Egg P2", icon: `${SITE}/img/itens/ovo-p2.png` },
  p3: { name: "Mystery Egg P3", icon: `${SITE}/img/itens/ovo-p3.png` },
  p4: { name: "Mystery Egg P4", icon: `${SITE}/img/itens/ovo-p4.png` },
} as const;
export type EggId = keyof typeof EGGS;
export type Eggs = Partial<Record<EggId, number>>;
export const DIAMOND_ICON = `${SITE}/img/moeda-diamante.png`;
export const GEM_ICON = `${SITE}/img/moeda-gema.png`;
export const TROPHY_ICON = `${SITE}/assets/site/assets/ui/trofeu-1.png`;
export const MEDAL_ICON: Record<number, string> = {
  1: TROPHY_ICON,
  2: `${SITE}/img/medalha-2.png`,
  3: `${SITE}/img/medalha-3.png`,
};

export interface WeeklyPrize {
  to: number;
  from: number;
  key: "campeao" | "podio" | "top10" | "top20" | "top50" | "top100";
  label: string;
  sub: string;
  hours: Partial<Record<BoostKey, number>>;
  diamonds: number;
  /** emblema da faixa (mesmos ícones do jogo) */
  art: { medal?: number; tier?: string };
}
const all = (h: number): WeeklyPrize["hours"] => ({ shiny: h, captura: h, xp: h, pokexp: h });
export const WEEKLY_PRIZES: WeeklyPrize[] = [
  { from: 1, to: 1, key: "campeao", label: "1º", sub: "Campeão", hours: all(72), diamonds: 300, art: { medal: 1 } },
  { from: 2, to: 3, key: "podio", label: "2º e 3º", sub: "Pódio", hours: all(48), diamonds: 200, art: { medal: 2 } },
  { from: 4, to: 10, key: "top10", label: "4º ao 10º", sub: "Top 10", hours: all(24), diamonds: 100, art: { tier: "challenger" } },
  { from: 11, to: 20, key: "top20", label: "11º ao 20º", sub: "Top 20", hours: all(18), diamonds: 50, art: { tier: "challenger" } },
  { from: 21, to: 50, key: "top50", label: "21º ao 50º", sub: "Top 50", hours: { xp: 18, pokexp: 18 }, diamonds: 25, art: { tier: "challenger" } },
  { from: 51, to: 100, key: "top100", label: "51º ao 100º", sub: "Top 100", hours: { xp: 12, pokexp: 12 }, diamonds: 0, art: { tier: "challenger" } },
];
export const TOP_AWARDED = 100;
export const TOP_EGGS: Eggs = { p4: 2 };
/** Ovos que cada faixa leva na virada (para quem fica fora do Top 100). */
export const TIER_EGGS: Record<string, Eggs> = {
  prata: { p2: 1 },
  ouro: { p2: 2 },
  platina: { p2: 2, p3: 1 },
  diamante: { p2: 1, p3: 2 },
  mestre: { p3: 1, p4: 1 },
  graomestre: { p3: 2, p4: 1 },
};
/** Do mais alto para o mais baixo, como na tela do jogo. */
export const EGG_TIER_ORDER = ["graomestre", "mestre", "diamante", "platina", "ouro", "prata", "bronze"] as const;

export const prizeAt = (pos: number): WeeklyPrize | null => (pos >= 1 ? (WEEKLY_PRIZES.find((p) => pos <= p.to) ?? null) : null);

/** Ovos da virada: Top 100 leva o pacote do topo; os demais, o do seu tier (elite fora do Top 100 vale como Diamante). */
export function eggsOf(pos: number, tier: string): Eggs | null {
  if (pos >= 1 && pos <= TOP_AWARDED) return TOP_EGGS;
  const elite = tier === "mestre" || tier === "graomestre" || tier === "challenger";
  if (elite && (pos < 1 || tier === "challenger")) return TIER_EGGS.diamante;
  return TIER_EGGS[tier] ?? null;
}

export const boostTime = (h: number) => (h === 24 ? "1 dia" : h % 24 === 0 ? `${h / 24} dias` : `${h} horas`);
export const rankLine = (pos: number) => `${new Intl.NumberFormat("pt-BR").format(pos)}º lugar`;

// ------------------------------------------------------------------ Top mensal
export interface MonthlyBand {
  de: number;
  ate: number;
  bp: number;
  porPosicao: number;
  posicoes?: number;
  fatia?: number;
}
/** [posição, vaga, nick, pontos, vitórias, derrotas, válidas, motivo] */
export type MonthlyRow = [number, number, string, number, number, number, number, string];
export interface MonthlyTop {
  account: number;
  mes: string;
  arrecadado: number;
  vendas: number;
  pool: number;
  pctBp: number;
  partidasMin?: number;
  contaDiasMin?: number;
  faixas: MonthlyBand[];
  eu?: { pos?: number; vaga?: number | null; pontos?: number; validas?: number; motivo?: string | null } | null;
  tabela?: { pagina: number; porPagina: number; total: number; linhas: MonthlyRow[] };
  anterior?: {
    status?: string;
    arrecadado: number;
    gemas: number;
    premiados: number;
    top?: { nick: string; gemas: number }[];
    meuPremio?: { posicao: number; gemas: number; creditado?: boolean } | null;
  } | null;
  at: number;
}

/** Os mesmos números que o jogo usa: faixas pelo `bp` (centésimos de %), por posição = fatia / vagas, sem arredondar para cima. */
export const MONTHLY_BANDS = [
  { de: 1, ate: 100, bp: 2500 },
  { de: 101, ate: 500, bp: 1250 },
  { de: 501, ate: 2000, bp: 1250 },
];
export function simulateBands(collected: number): MonthlyBand[] {
  const c = Math.max(0, Math.floor(collected));
  return MONTHLY_BANDS.map((f) => {
    const fatia = Math.floor((c * f.bp) / 10_000);
    const posicoes = f.ate - f.de + 1;
    return { ...f, posicoes, fatia, porPosicao: Math.floor(fatia / posicoes) };
  });
}

export const MONTHLY_MIN_MATCHES = 10;
export const MONTHLY_MIN_DAYS = 7;
export const MONTHLY_REASON: Record<string, { label: string; hint: string }> = {
  e: { label: "Equipe", hint: "Contas da mesma equipe do jogo não concorrem ao prêmio." },
  c: { label: "Conta nova", hint: `A conta precisa ter pelo menos ${MONTHLY_MIN_DAYS} dias antes do fim do mês.` },
  p: { label: "Poucas partidas", hint: `São necessárias ${MONTHLY_MIN_MATCHES} partidas válidas no mês.` },
  z: { label: "Sem pontos", hint: "É preciso ter pontos positivos no mês." },
  "": { label: "Sem vaga", hint: "O prêmio vai para as 2.000 primeiras vagas válidas." },
};

export const monthlyApi = {
  get: (account: number, page: number) => call<MonthlyTop>("GET", `/api/pvp/monthly?conta=${account}&pagina=${page}`),
};
