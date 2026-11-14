/**
 * Contrato do backend (telemetry.py).
 *   WS   /ws/telemetry  -> { type:"snapshot", ts, accounts: AccountSnapshot[] }
 *   GET  /api/pokemons  -> { ts, pokemons: PokemonRow[] }   (sob demanda; lista grande)
 */
export type AccountStatus = "online" | "paused_cooldown" | "blocked" | "offline";

export interface ActivePokemon {
  name: string;
  hp: number;
  maxHp: number;
  level?: number | null;
  looktype?: number | null;
  shiny?: boolean;
}

export interface InventoryItem {
  id: number;
  name: string;
  qty: number;
  category?: string;
  rare?: boolean;
  icon?: string | null;
}

export interface EquippedItem {
  id: number;
  name: string;
  qty: number;
  icon?: string | null;
}

export interface SessionInfo {
  startedAt: number | null;
  items: { boss: number; key: number; shinyStone: number; bike: number };
  shinies?: { seen: number; captured: number } | null;
}

export interface AccountSnapshot {
  id: string;
  nick: string;
  level: number;
  status: AccountStatus;
  state?: string;
  blocked?: { kind: string; detail: string } | null;
  lastReason?: string;
  vip?: boolean;
  session?: SessionInfo;
  pokemon: ActivePokemon | null;
  xpPerHour: number;
  goldPerHour: number;
  hunt?: { slug: string | null; kills: number; minutes: number } | null;
  huntName?: string | null;
  /** Em combate a conta não troca de hunt: tempo (ms) até poder, e a hunt que está esperando na fila. */
  combatLockMs?: number;
  huntPending?: { slug: string; name: string } | null;
  gold: number;
  gems: number;
  diamonds?: number;
  potions: number;
  balls: number;
  equipped?: {
    potion: EquippedItem | null;
    ball: EquippedItem | null;
    /** Tudo que dá para equipar (com o estoque da conta): alimenta o seletor do card. */
    options?: { potion: EquippedItem[]; ball: EquippedItem[] };
  };
  captured?: { session: number; failed: number; total: number; shiny: number };
  inventory?: {
    balls: { id: number; name: string; qty: number; icon?: string | null }[];
    items: InventoryItem[];
    pokedexSpecies: number;
  };
}

export interface SnapshotMessage {
  type: "snapshot";
  ts: number;
  accounts: AccountSnapshot[];
}

export interface PokemonRow {
  id: number;
  account: string;
  speciesId: number;
  name: string;
  types: string[];
  level: number;
  shiny: boolean;
  quality: number | null;
  power: number | null;
  grade: number | null;
  slot: number | null;
  ivTotal: number;
  caughtAt: number | null;
  looktype?: number | null;
}

export type ConnectionState = "connecting" | "open" | "reconnecting";

/** Resultado de POST /api/sell-depot (shop.sellAllPokemons), por conta. */
export interface SellDepotResult {
  account: string;
  nick: string;
  ok: boolean;
  label?: string;
  qty?: number;
  gained?: number;
  error?: string;
}
