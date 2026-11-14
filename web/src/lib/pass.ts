import { call } from "./admin";
import { numId } from "./actions";

/**
 * Passe de Batalha: 30 dias de prêmios, na trilha grátis e na premium (VIP).
 * A trilha e a regra do dia são as do cliente oficial (`shared/passe-batalha.mjs`); o dia vira à meia-noite de Brasília.
 */
export const PASSE_DIAS = 30;
export const PASSE_NIVEL_MIN = 10;
const FUSO_MS = 3 * 60 * 60_000;
const DIA_MS = 24 * 60 * 60_000;

export type BoostKind = "xp" | "pokexp" | "loot" | "captura" | "shiny";
export type Prize =
  | { tipo: "coins"; qtd: number }
  | { tipo: "bola"; id: number; qtd: number }
  | { tipo: "item"; id: number; qtd: number }
  | { tipo: "boost"; boost: BoostKind; horas: number }
  | { tipo: "vip"; dias: number };
export type Tier = "comum" | "incomum" | "rara" | "mitica" | "lendaria";
export interface Step {
  dia: number;
  tier: Tier;
  bau?: boolean;
  free: Prize[];
  vip: Prize[];
}

const coins = (qtd: number): Prize => ({ tipo: "coins", qtd });
const ultra = (qtd: number): Prize => ({ tipo: "bola", id: 4, qtd });
const beast = (qtd: number): Prize => ({ tipo: "bola", id: 5, qtd });
const item = (id: number, qtd: number): Prize => ({ tipo: "item", id, qtd });
const boost = (b: BoostKind, horas: number): Prize => ({ tipo: "boost", boost: b, horas });
const vip = (dias: number): Prize => ({ tipo: "vip", dias });
const REVIVE = 205, MAX_REVIVE = 206, GOLDEN = 70070, ROPE = 70010, BOSS = 70000;

export const TRILHA: Step[] = [
  { dia: 1, tier: "comum", free: [coins(250_000)], vip: [vip(3), coins(500_000)] },
  { dia: 2, tier: "comum", free: [ultra(30)], vip: [ultra(60), beast(10)] },
  { dia: 3, tier: "incomum", free: [boost("xp", 1)], vip: [boost("xp", 3)] },
  { dia: 4, tier: "comum", free: [item(REVIVE, 50)], vip: [item(REVIVE, 100), item(MAX_REVIVE, 10)] },
  { dia: 5, tier: "comum", free: [coins(500_000)], vip: [coins(1_000_000), boost("loot", 1)] },
  { dia: 6, tier: "incomum", free: [beast(10)], vip: [beast(25)] },
  { dia: 7, tier: "rara", bau: true, free: [coins(1_000_000), boost("loot", 1)], vip: [coins(3_000_000), boost("xp", 6), boost("pokexp", 6), boost("loot", 6)] },
  { dia: 8, tier: "comum", free: [ultra(50)], vip: [ultra(100), boost("captura", 1)] },
  { dia: 9, tier: "incomum", free: [boost("pokexp", 1)], vip: [boost("pokexp", 3)] },
  { dia: 10, tier: "incomum", free: [coins(750_000)], vip: [vip(3), coins(1_500_000)] },
  { dia: 11, tier: "incomum", free: [item(MAX_REVIVE, 10)], vip: [item(MAX_REVIVE, 30)] },
  { dia: 12, tier: "incomum", free: [beast(15)], vip: [beast(40)] },
  { dia: 13, tier: "rara", free: [boost("captura", 1)], vip: [boost("captura", 3), boost("shiny", 3)] },
  { dia: 14, tier: "rara", bau: true, free: [coins(1_500_000), boost("xp", 2)], vip: [coins(4_000_000), boost("loot", 6)] },
  { dia: 15, tier: "incomum", free: [item(GOLDEN, 10)], vip: [item(GOLDEN, 20), boost("xp", 3)] },
  { dia: 16, tier: "comum", free: [coins(1_000_000)], vip: [coins(2_000_000)] },
  { dia: 17, tier: "incomum", free: [beast(25)], vip: [beast(50)] },
  { dia: 18, tier: "rara", free: [boost("shiny", 1)], vip: [boost("shiny", 3)] },
  { dia: 19, tier: "comum", free: [ultra(100)], vip: [ultra(200), boost("loot", 2)] },
  { dia: 20, tier: "incomum", free: [coins(1_250_000)], vip: [vip(3), coins(2_500_000)] },
  { dia: 21, tier: "rara", bau: true, free: [coins(2_000_000), boost("captura", 2)], vip: [coins(5_000_000), boost("captura", 6), boost("loot", 6)] },
  { dia: 22, tier: "incomum", free: [beast(30)], vip: [beast(60)] },
  { dia: 23, tier: "rara", free: [boost("loot", 2)], vip: [boost("loot", 6)] },
  { dia: 24, tier: "incomum", free: [item(MAX_REVIVE, 20)], vip: [item(MAX_REVIVE, 40), item(ROPE, 5)] },
  { dia: 25, tier: "incomum", free: [coins(1_500_000)], vip: [coins(3_000_000), boost("pokexp", 6)] },
  { dia: 26, tier: "rara", free: [boost("pokexp", 2)], vip: [boost("xp", 6)] },
  { dia: 27, tier: "rara", free: [beast(40)], vip: [beast(80)] },
  { dia: 28, tier: "mitica", bau: true, free: [coins(3_000_000), boost("shiny", 2)], vip: [coins(7_000_000), boost("shiny", 6), boost("captura", 6)] },
  { dia: 29, tier: "rara", free: [item(ROPE, 3), boost("xp", 3)], vip: [vip(3), boost("captura", 6), boost("shiny", 6)] },
  { dia: 30, tier: "lendaria", bau: true, free: [item(BOSS, 1), coins(5_000_000), beast(50)], vip: [boost("shiny", 12), coins(10_000_000), beast(100), boost("captura", 12), vip(7)] },
];

// ---------------------------------------------------------------- ícones e nomes dos prêmios
const SITE = "https://pokeidle.io";
const BOOST_ICON: Record<BoostKind, string> = {
  xp: "/assets/site/assets/loja/exp.png",
  pokexp: "/assets/site/assets/loja/boost.png",
  loot: "/assets/site/assets/loja/loot.png",
  captura: "/assets/site/assets/loja/catch.png",
  shiny: "/assets/site/assets/loja/shinysecretlure.png",
};
const BOOST_NAME: Record<BoostKind, string> = { xp: "XP", pokexp: "XP do Pokémon", loot: "Loot", captura: "Captura", shiny: "Shiny" };
const BALL: Record<number, { name: string; icon: string }> = {
  4: { name: "Ultra Ball", icon: "/assets/site/assets/ui/ball-ultra.png" },
  5: { name: "Beast Ball", icon: "/img/ball-beast.png" },
};
const ITEM: Record<number, { name: string; icon: string }> = {
  [REVIVE]: { name: "Revive", icon: "/assets/site/assets/markitems/revive.png" },
  [MAX_REVIVE]: { name: "Max Revive", icon: "/assets/site/assets/markitems/max_revive.png" },
  [GOLDEN]: { name: "Golden Potion", icon: "/img/itens/golden-potion.png" },
  [ROPE]: { name: "Escape Rope", icon: "/img/itens/escape-rope.png" },
  [BOSS]: { name: "Bronze Boss Token", icon: "/assets/site/assets/items/bronze_boss_token.png" },
};
export const PASS_ICON = { free: `${SITE}/img/passe-free.png`, vip: `${SITE}/img/passe-vip.png` };

const nf = new Intl.NumberFormat("pt-BR");
/** 250000 -> "250 mil"; 1500000 -> "1,5 mi". */
export function shortQty(n: number): string {
  if (n >= 1_000_000) return `${nf.format(n / 1_000_000)} mi`;
  if (n >= 1000) return `${nf.format(n / 1000)} mil`;
  return nf.format(n);
}

export interface PrizeView {
  icon: string;
  /** Rótulo curto embaixo do ícone: "×30", "1h", "250 mil", "3d". */
  short: string;
  /** Nome completo (dica ao passar o mouse e leitor de tela). */
  name: string;
}
export function prizeView(p: Prize): PrizeView {
  switch (p.tipo) {
    case "coins":
      return { icon: `${SITE}/assets/site/assets/ui/moeda-ouro.png`, short: shortQty(p.qtd), name: `${nf.format(p.qtd)} Coins` };
    case "bola": {
      const b = BALL[p.id];
      return { icon: SITE + (b?.icon ?? ""), short: `×${nf.format(p.qtd)}`, name: `${nf.format(p.qtd)}× ${b?.name ?? `Bola #${p.id}`}` };
    }
    case "item": {
      const i = ITEM[p.id];
      return { icon: SITE + (i?.icon ?? ""), short: `×${nf.format(p.qtd)}`, name: `${nf.format(p.qtd)}× ${i?.name ?? `Item #${p.id}`}` };
    }
    case "boost":
      return { icon: SITE + BOOST_ICON[p.boost], short: `${p.horas}h`, name: `Boost de ${BOOST_NAME[p.boost]} por ${p.horas}h` };
    case "vip":
      return { icon: `${SITE}/assets/site/assets/loja/vip.png`, short: `${p.dias}d`, name: `${p.dias} dias de VIP` };
  }
}

/** Soma do que cada trilha dá no ciclo inteiro (para o resumo do Passe Premium). */
export function trackTotals(track: "free" | "vip") {
  let coinsSum = 0, beastSum = 0, boostHours = 0, vipDays = 0;
  for (const d of TRILHA)
    for (const p of d[track]) {
      if (p.tipo === "coins") coinsSum += p.qtd;
      else if (p.tipo === "bola" && p.id === 5) beastSum += p.qtd;
      else if (p.tipo === "boost") boostHours += p.horas;
      else if (p.tipo === "vip") vipDays += p.dias;
    }
  return { coins: coinsSum, beast: beastSum, boostHours, vipDays };
}

// ---------------------------------------------------------------- estado do dia
export interface PassRaw {
  ultimo?: number | null;
  degrau?: number | null;
  ultimoVip?: number | null;
  vipAte?: number | null;
  ciclos?: number | null;
  total?: number | null;
  vipPegos?: number | null;
}
export const dayOf = (ms: number) => Math.floor((ms - FUSO_MS) / DIA_MS);
/** Início (ms) do dia do passe `dia`: a meia-noite de Brasília. */
export const dayStart = (dia: number) => dia * DIA_MS + FUSO_MS;
const bit = (dia: number) => 2 ** (dia - 1);

export interface PassState {
  /** Dia da trilha que a conta resgata hoje (ou resgatou hoje). */
  degrau: number;
  jaPegouHoje: boolean;
  /** Perdeu um dia: a trilha voltou ao 1. */
  quebrou: boolean;
  /** Virou VIP depois de resgatar hoje: falta o prêmio premium do dia. */
  vipPendenteHoje: boolean;
  vipAtivo: boolean;
  vipAte: number;
  vipPegos: number;
  ciclos: number;
  total: number;
  viradaEm: number;
  /** Dias já resgatados no ciclo atual. */
  feitos: number;
}

const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);

export function passState(raw: PassRaw | null | undefined, now: number): PassState {
  const o = raw ?? {};
  const ultimo = int(o.ultimo);
  const d0 = int(o.degrau) ?? 0;
  const degrauSaved = d0 >= 0 && d0 <= PASSE_DIAS ? d0 : 0;
  const vipAte = Math.max(0, Number(o.vipAte) || 0);
  const ultimoVip = int(o.ultimoVip);
  const hoje = dayOf(now);
  let degrau: number, jaPegouHoje = false, quebrou = false;
  if (ultimo == null || degrauSaved < 1) degrau = 1;
  else if (ultimo === hoje) [degrau, jaPegouHoje] = [degrauSaved, true];
  else if (ultimo === hoje - 1) degrau = degrauSaved >= PASSE_DIAS ? 1 : degrauSaved + 1;
  else [degrau, quebrou] = [1, true];
  const vipAtivo = vipAte > now;
  const vipPegosRaw = int(o.vipPegos);
  const vipPegos = degrau === 1 && !jaPegouHoje ? 0 : vipPegosRaw != null && vipPegosRaw >= 0 ? vipPegosRaw : 0;
  return {
    degrau,
    jaPegouHoje,
    quebrou,
    vipPendenteHoje: vipAtivo && jaPegouHoje && ultimoVip !== hoje,
    vipAtivo,
    vipAte,
    vipPegos,
    ciclos: Math.max(0, int(o.ciclos) ?? 0),
    total: Math.max(0, int(o.total) ?? 0),
    viradaEm: dayStart(hoje + 1),
    feitos: jaPegouHoje ? degrau : degrau - 1,
  };
}

export type DayStatus = "pego" | "hoje" | "futuro" | "perdido";
export function freeStatus(st: PassState, dia: number): DayStatus {
  if (dia < st.degrau) return "pego";
  if (dia === st.degrau) return st.jaPegouHoje ? "pego" : "hoje";
  return "futuro";
}
export function vipStatus(st: PassState, dia: number): DayStatus {
  if (st.vipPegos & bit(dia)) return "pego";
  if (dia < st.degrau) return "perdido";
  if (dia === st.degrau && st.vipAtivo && (!st.jaPegouHoje || st.vipPendenteHoje)) return "hoje";
  return "futuro";
}

/** Próximo baú (dias 7, 14, 21, 28 e 30) e em quantos dias a conta chega nele. */
export function nextMilestone(st: PassState): { dia: number; emDias: number; tier: Tier } | null {
  const m = TRILHA.find((d) => d.bau && d.dia > st.feitos);
  return m ? { dia: m.dia, emDias: Math.max(0, m.dia - st.degrau), tier: m.tier } : null;
}

/** "1:02:09" / "4:09" até o instante `until`. */
export function clock(until: number, now: number): string {
  const s = Math.max(0, Math.floor((until - now) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Tempo restante do premium: "12 d 3 h" ou "5 h". */
export function vipLeft(vipAte: number, now: number): string {
  const ms = Math.max(0, vipAte - now);
  const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000);
  return d ? `${d} d ${h} h` : `${Math.max(1, h)} h`;
}

// ---------------------------------------------------------------- API
export interface ClaimResult {
  ok: boolean;
  confirmed: boolean;
  claim: { degrau: number; premios: (Prize & { trilha?: "free" | "vip" })[] } | null;
}
export const passApi = {
  claim: (accId: string) => call<ClaimResult>("POST", `/api/accounts/${numId(accId)}/pass/claim`),
};
