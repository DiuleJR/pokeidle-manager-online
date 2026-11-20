import { call } from "./admin";

// ------------------------------------------------------------ tabuleiro
/** As 30 casas do tabuleiro do PVP (as mesmas do jogo): fileiras de 6, 8, 8, 4 e 4 casas, a fileira 0 junto do adversário. */
const ROWS: [cy: number, from: number, to: number][] = [
  [13, 12, 17],
  [14, 11, 18],
  [15, 11, 18],
  [16, 13, 16],
  [17, 13, 16],
];
export interface House {
  house: number;
  row: number;
  /** Coluna no grid de 8 colunas (0 a 7). */
  col: number;
}
export const COL_MIN = 11;
export const GRID_COLS = 8;
export const GRID_ROWS = ROWS.length;
export const HOUSES: House[] = (() => {
  const out: House[] = [];
  ROWS.forEach(([, from, to], row) => {
    for (let cx = from; cx <= to; cx++) out.push({ house: out.length, row, col: cx - COL_MIN });
  });
  return out;
})();
export const TOTAL_HOUSES = HOUSES.length;
export const TEAM_MAX = 5;

const F0 = [2, 3, 1, 4, 0, 5];
const F1 = [9, 10, 8, 11, 7, 12, 6, 13];
const F2_MID = [17, 18, 16, 19];
const F2_SIDES = [15, 20];
const F2_ENDS = [14, 21];
const F2 = [...F2_MID, ...F2_SIDES, ...F2_ENDS];
const F3 = [23, 24, 22, 25];
const F4 = [27, 28, 26, 29];
const PRIORITY: Record<number, number[]> = {
  1: [...F0, ...F1, ...F2, ...F3, ...F4],
  2: [...F1, ...F2, ...F0, ...F3, ...F4],
  3: [...F2_MID, ...F3, ...F2_SIDES, ...F4, ...F2_ENDS, ...F1, ...F0],
  4: [...F3, ...F2, ...F4, ...F1, ...F0],
};

/** Casa de cada Pokémon: respeita as pedidas (válidas, sem repetir) e põe as demais pela prioridade do alcance (igual ao jogo). */
export function fillHouses(requested: (number | null | undefined)[], ranges: number[]): number[] {
  const n = Math.min(TEAM_MAX, requested.length);
  const out: (number | null)[] = new Array(n).fill(null);
  const used = new Set<number>();
  for (let i = 0; i < n; i++) {
    const c = requested[i];
    if (typeof c === "number" && Number.isInteger(c) && c >= 0 && c < TOTAL_HOUSES && !used.has(c)) {
      out[i] = c;
      used.add(c);
    }
  }
  for (let i = 0; i < n; i++) {
    if (out[i] != null) continue;
    const order = PRIORITY[Math.max(1, Math.min(4, ranges[i] ?? 1))];
    const free = order.find((c) => !used.has(c)) as number;
    out[i] = free;
    used.add(free);
  }
  return out as number[];
}

export const RANGE_MELEE = "🗡️";
export const RANGE_RANGED = "🏹";
export const rangeBadge = (r: number) => (r > 1 ? `${r}${RANGE_RANGED}` : RANGE_MELEE);
export const rangeText = (r: number) => (r > 1 ? `a distância (alcance ${r})` : "corpo a corpo");

// ------------------------------------------------------------------ API
export interface RosterRow {
  id: number;
  speciesId: number;
  name: string;
  level: number;
  looktype: number | null;
  shiny: boolean;
  types: string[];
  pvpPower: number;
  pvpLevel: number;
  power: number | null;
  quality: number | null;
  potency: number | null;
  grade: number | null;
  ivTotal: number;
  range: number;
  hunting: boolean;
  inTeam: boolean;
  refined: boolean;
}
export interface RosterPage {
  total: number;
  owned: number;
  offset: number;
  items: RosterRow[];
}
export interface RosterQuery {
  q: string;
  tipo: string;
  iv: number;
  shiny: boolean;
  local: "todos" | "equipe" | "colecao";
  ord: "poder" | "nivel" | "nota" | "iv" | "qualidade" | "pve";
}
export interface TeamView {
  ids: number[];
  casas: Record<string, number>;
  members: RosterRow[];
}

export interface Attack {
  name: string;
  power: number;
  type: string;
  category: "PHYSICAL" | "SPECIAL";
  cooldownMs: number;
  learnLevel?: number;
}
export interface Species {
  pokeId: number;
  name: string;
  looktype: number | null;
  type1: string;
  type2?: string;
  rarity: string;
  baseHp: number;
  baseAtk: number;
  baseDef: number;
  baseSpAtk: number;
  baseSpDef: number;
  baseSpeed: number;
  huntLevel: number;
  evolvesToId: number;
  evolveLevel: number;
  priceNpc?: number;
  sellValue?: number;
  experience: number;
  loot: { name: string; chance: number; minCount: number; maxCount: number }[];
  attacks: Attack[];
}
export interface EvolutionBrief {
  pokeId: number;
  name: string;
  looktype: number | null;
}
export interface SpeciesPayload {
  species: Species | null;
  range: number;
  evolution: { prev: EvolutionBrief | null; next: EvolutionBrief | null; level: number; prevLevel: number };
  pokedex: { defeated: number | null; captured: number | null };
  foundIn: { slug: string; name: string; level: number; points: number }[];
}
/** Calculadora da ficha: nota de nascença, potencial na evolução final e peso de cada fator (porta da calculadora do jogo). */
export interface CalcFinal {
  pokeId: number;
  name: string;
  looktype: number | null;
  nota: number;
  faixa: string;
  mercado: boolean;
}
export interface CalcPayload {
  lendario: boolean;
  ivTotal: number;
  mercadoMin: number;
  /** Ausentes em lendário/mítico: a nota não se aplica a eles. */
  nota?: number;
  faixa?: string;
  eixos?: { iv: number; qualidade: number; potencia: number; shiny: number };
  proxima?: { faixa: string; falta: number } | null;
  mercado?: boolean;
  stats?: { key: string; valor: number; pct: number }[];
  finais?: CalcFinal[];
  combate: { mult: number; potencia: number; shiny: number | null; lendario: number | null; poderRanking: number; poderGinasio: number; nivelGinasio: number };
}

/** O anúncio de onde a ficha veio (preço e moeda). */
export interface SheetListing {
  id: number;
  price: number;
  currency: "gold" | "orb";
  qty: number;
}
export interface PokemonSheetPayload extends SpeciesPayload {
  pokemon: {
    id: number;
    speciesId: number;
    nome: string;
    looktype: number | null;
    lookShiny: number | null;
    tipos: string[];
    level: number;
    xp: number;
    /** Fichas de outros jogadores (mercado, chat) não trazem os limites do nível. */
    xpNivel?: number;
    xpProximo?: number;
    quality: number;
    potencia: number;
    shiny: boolean;
    slot: number | null;
    hp?: number;
    maxHp: number;
    poder: number;
    nota: number;
    ivs: Record<string, number>;
    stats: Record<string, number>;
    refino?: Record<string, number>;
    refinoTotal?: number;
    tmElemental: string | null;
    caughtAt: number;
    caughtBy?: boolean | string;
    apelido?: string | null;
  };
  /** Dono do Pokémon quando não é de uma das suas contas (jogador do chat ou vendedor do anúncio). */
  owner?: string | null;
  /** Só quando a ficha veio de um anúncio do mercado. */
  listing?: SheetListing;
  combatHp: number;
  /** null quando a ficha não tem dados para calcular (espécie fora do catálogo, ex.: Mega). */
  calc: CalcPayload | null;
  pvpPower: number;
  pvpLevel: number;
  pvePower: number;
  bases: Record<string, number> | null;
}

const qs = (o: Record<string, string | number | boolean>) =>
  Object.entries(o)
    .filter(([, v]) => v !== "" && v !== false && v !== 0)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");

export const teamApi = {
  roster: (acc: number, query: RosterQuery, offset: number, limit = 60) =>
    call<RosterPage>("GET", `/api/pvp/${acc}/roster?${qs({ ...query, offset, limit })}`),
  teamView: (acc: number) => call<TeamView>("GET", `/api/pvp/${acc}/team-view`),
  save: (acc: number, ids: number[], casas: Record<string, number>) =>
    call<{ ok: boolean; ids: number[]; casas: Record<string, number> }>("POST", `/api/pvp/${acc}/team`, { ids, casas }),
  pokemon: (acc: number, id: number) => call<PokemonSheetPayload>("GET", `/api/pvp/${acc}/pokemon/${id}`),
  fromPokemon: (pokemon: Record<string, unknown>, listing?: SheetListing) => call<PokemonSheetPayload>("POST", "/api/pokemon/sheet", { pokemon, listing }),
  publicPokemon: (nick: string, pid: number) => call<PokemonSheetPayload>("GET", `/api/pokemon/public?nick=${encodeURIComponent(nick)}&pid=${pid}`),
  listing: (id: number) => call<PokemonSheetPayload>("GET", `/api/pokemon/listing/${id}`),
  species: (id: number, acc?: number) => call<SpeciesPayload>("GET", `/api/pvp/species/${id}${acc ? `?account=${acc}` : ""}`),
};
