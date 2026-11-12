import { call } from "./admin";

export type Moeda = "gold" | "orb";
export const MOEDA_LABEL: Record<Moeda, string> = { gold: "Gold", orb: "Gemas" };

export type Deal = "barato" | "justo" | "caro" | null;

export interface MarketItem {
  id: number;
  name: string;
  category: string;
  icon: string | null;
  rare?: boolean;
  ads: number;
  units: number;
  minGold: number | null;
  minOrb: number | null;
  avgGold?: number | null;
  avgOrb?: number | null;
  soldGold?: number | null;
  soldOrb?: number | null;
  dealGold?: Deal;
  dealOrb?: Deal;
  fav: boolean;
}
export interface Overview {
  ts: number;
  days: number;
  items: MarketItem[];
  online: number[];
}

export interface Ficha {
  nome?: string;
  level?: number;
  shiny?: boolean;
  speciesId?: number;
  tipo?: string;
  icone?: string;
  categoria?: string;
  tipos?: string[];
  ivTotal?: number;
  potencia?: number;
  quality?: number;
  poder?: number;
  looktype?: number;
  [k: string]: unknown;
}
export interface Listing {
  id: number;
  vendedor: string;
  vendedorId?: number;
  tipo: "item" | "pokemon";
  itemId: number | null;
  pokemonId: number | null;
  qtd: number;
  preco: number;
  moeda: Moeda;
  ficha?: Ficha;
  estado?: string;
  criadoEm?: number;
  compravelEm?: number;
  expiraEm?: number | null;
  dias?: number | null;
}
export interface ItemListings {
  itemId: number;
  moeda: Moeda;
  item: { id: number; name: string; icon: string | null; category: string };
  now: number;
  listings: Listing[];
  avg: number | null;
}
export interface Vitrine {
  now: number;
  total: number | null;
  page: number;
  perPage: number | null;
  listings: Listing[];
}
export interface TapeRow {
  tipo?: string;
  descricao?: string;
  bruto?: number;
  moeda?: Moeda;
  em?: number;
  vendedor?: string;
  comprador?: string;
  anterior?: number | null;
  usdt?: number;
  rede?: string;
  status?: string;
  itemId?: number;
  itemIcon?: string | null;
  qtd?: number;
  ficha?: Ficha;
}
export interface Tape {
  mode: string;
  page: number;
  total: number | null;
  rows: TapeRow[];
  hasMore?: boolean | null;
}
export interface SalesPoint {
  day: string;
  avg: number;
  units: number;
  sales: number;
}
export interface FloorPoint {
  ts: number;
  minGold: number | null;
  minOrb: number | null;
  ads: number;
  units: number;
}
export interface Wallet {
  account: number;
  nick: string;
  balance: number | null;
  prices: { compra?: number; saque?: number; minimo?: number };
  withdrawals: { orbs: number; usdt: number; status: string; recusado?: boolean; motivoRecusa?: string; criadoEm?: number; tentadoEm?: number }[];
  ledger: { motivo: string; delta: number; saldo: number; em?: number; ts?: number }[];
  withdrawLocked: { motivo?: string } | null;
}
export interface RuleSpec {
  target: "item" | "pokemon";
  item_id?: number | null;
  name?: string;
  busca?: string;
  elemento?: string;
  so_shiny?: boolean;
  so_p5?: boolean;
  iv_min?: number | null;
  nivel_min?: number | null;
  moeda: Moeda;
  max_price: number;
  below_avg_pct: number;
  account_id?: number | null;
  /** Contas que compram (sniper). Regras antigas só têm `account_id`. */
  account_ids?: number[];
  qty_max?: number;
  budget_daily?: number;
  poll_s?: number;
}
export interface Rule {
  id: number;
  kind: "alert" | "snipe";
  enabled: boolean;
  spec: RuleSpec;
  label: string;
  spentToday: number;
  lastFire: number | null;
}
export interface LogRow {
  id: number;
  ts: number;
  accountId: number | null;
  ruleId: number | null;
  status: string;
  text: string;
}
export interface BuyResult {
  status: "comprado" | "perdeu_sorteio" | "recusado" | "timeout";
  detail?: string;
  total?: number;
}

const qs = (p: Record<string, string | number | boolean | null | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== "" && v !== false) u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
};

export const marketApi = {
  overview: (force = false) => call<Overview>("GET", `/api/market/overview${qs({ force })}`),
  item: (itemId: number, moeda: Moeda, account?: number) =>
    call<ItemListings>("GET", `/api/market/item${qs({ itemId, moeda, account })}`),
  vitrine: (p: { moeda: Moeda; ordem: string; busca: string; elemento: string; pagina: number; soShiny: boolean; soP5: boolean; ivMin?: number | null; nivelMin?: number | null; account?: number }) =>
    call<Vitrine>("GET", `/api/market/vitrine${qs(p)}`),
  tape: (p: { mode: string; page: number; tipo: string; moeda: string; itemId?: number | null; busca: string; elemento: string; soShiny: boolean; soP5: boolean; ordem?: string; account?: number }) =>
    call<Tape>("GET", `/api/market/tape${qs(p)}`),
  sales: (itemId: number, moeda: Moeda, account?: number) =>
    call<{ sales: SalesPoint[]; floor: FloorPoint[] }>("GET", `/api/market/sales${qs({ itemId, moeda, account })}`),
  mine: (account?: number) => call<{ account: number; now: number; listings: Listing[] }>("GET", `/api/market/mine${qs({ account })}`),
  wallet: (account?: number) => call<Wallet>("GET", `/api/market/wallet${qs({ account })}`),
  log: () => call<{ log: LogRow[] }>("GET", "/api/market/log"),
  setFav: (item_id: number, on: boolean) => call<{ favs: number[] }>("POST", "/api/market/favs", { item_id, on }),
  rules: () => call<{ rules: Rule[]; sniperEnabled: boolean }>("GET", "/api/market/rules"),
  addRule: (kind: "alert" | "snipe", spec: RuleSpec, enabled = true) => call<Rule>("POST", "/api/market/rules", { kind, enabled, ...spec }),
  editRule: (id: number, kind: "alert" | "snipe", spec: RuleSpec, enabled: boolean) =>
    call<Rule>("PUT", `/api/market/rules/${id}`, { kind, enabled, ...spec }),
  toggleRule: (id: number) => call<Rule>("POST", `/api/market/rules/${id}/toggle`),
  deleteRule: (id: number) => call<{ ok: boolean }>("DELETE", `/api/market/rules/${id}`),
  setSniper: (enabled: boolean) => call<{ sniperEnabled: boolean }>("PUT", "/api/market/sniper", { enabled }),
  buy: (b: { listing_id: number; qty: number; price: number; moeda: Moeda; account_id: number }) =>
    call<BuyResult>("POST", "/api/market/buy", b),
};

// ------------------------------------------------------------------ taxas (mesma regra do jogo)
/** Comissão do vendedor. Gold: 15%. Gema: item/outros 15% plano; Pokémon por faixa marginal (13% até 500,
 * 10% de 501 a 5.000, 7,5% acima), arredondada para cima uma vez só no fim. */
export function marketFee(total: number, moeda: Moeda, tipo: "item" | "pokemon"): number {
  const t = Math.floor(total);
  if (t <= 0) return 0;
  if (moeda === "gold" || tipo !== "pokemon") return Math.min(t, Math.ceil((t * 1500) / 10_000));
  const tiers: [number, number][] = [[500, 1300], [5000, 1000], [Infinity, 750]];
  let floor = 0;
  let bp = 0;
  for (const [upTo, rate] of tiers) {
    const top = Math.min(t, upTo);
    if (top <= floor) break;
    bp += (top - floor) * rate;
    floor = top;
  }
  return Math.min(t, Math.ceil(bp / 10_000));
}

/** Preço de venda (total) mínimo para o vendedor receber `liquido` — busca simples, o líquido só cresce com o preço. */
export function priceForNet(liquido: number, moeda: Moeda, tipo: "item" | "pokemon"): number {
  let lo = Math.max(1, Math.floor(liquido));
  let hi = lo * 2 + 10;
  while (hi - marketFee(hi, moeda, tipo) < liquido) hi *= 2;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (mid - marketFee(mid, moeda, tipo) >= liquido) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export const dealLabel = (d?: Deal) => (d === "barato" ? "Barato" : d === "caro" ? "Caro" : d === "justo" ? "Na média" : "");

/** Segundos até o anúncio ser liberado para compra (0 = já pode). `drift` = hora do servidor − hora local. */
export const secondsUntil = (ms: number | undefined, drift: number) =>
  ms ? Math.max(0, Math.ceil((ms - (Date.now() + drift)) / 1000)) : 0;

/** Contas de uma regra de sniper, já considerando as regras antigas (uma conta só). */
export const ruleAccountIds = (s: RuleSpec): number[] => (s.account_ids?.length ? s.account_ids : s.account_id ? [s.account_id] : []);
