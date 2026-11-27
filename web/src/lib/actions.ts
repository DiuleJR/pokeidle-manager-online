import { useEffect, useState } from "react";
import { call } from "./admin";
import { economyMode, everyWhileVisible } from "./visible";

/** "acc3" -> 3 (as rotas de ação usam o id numérico da conta). */
export const numId = (accId: string) => Number(accId.replace(/\D/g, ""));

export interface EquipResult {
  ok: boolean;
  stock: number;
  /** O bot vai comprar agora (estoque abaixo do mínimo e reposição ligada). */
  willBuy: boolean;
  restockEnabled: boolean;
  buyable: boolean;
}
export interface HuntResult {
  ok: boolean;
  /** O jogo confirmou a troca (evento `hunt`). false = ignorou (em combate, nível baixo...). */
  confirmed: boolean;
  slug: string;
  /** A conta estava em combate: a troca ficou na fila e o bot faz sozinho quando a trava acabar. */
  queued?: boolean;
  waitMs?: number;
}

/** O Pokémon equipado de uma conta, como a calculadora de hunt precisa. */
export interface PokemonSheet {
  id: number;
  speciesId: number;
  nome: string;
  looktype?: number | null;
  level: number;
  shiny: boolean;
  quality: number;
  potencia: number;
  stats: Record<string, number>;
  ivs: Record<string, number>;
  tmAoe: boolean;
  trainerLevel: number;
}

export interface AutoHuntSettings {
  enabled: boolean;
  metric: "xp" | "ouro";
  min_gain_pct: number;
  cooldown_minutes: number;
}
export interface AutoHuntAdvice {
  ok: boolean;
  action: "queued" | "skipped";
  reason?: string;
  slug?: string;
}

export const actions = {
  getAutoHunt: (accId: string) =>
    call<AutoHuntSettings>("GET", `/api/accounts/${numId(accId)}/autohunt`),
  setAutoHunt: (accId: string, patch: Partial<AutoHuntSettings>) =>
    call<AutoHuntSettings>("PATCH", `/api/accounts/${numId(accId)}/autohunt`, patch),
  suggestAutoHunt: (accId: string, suggestion: {
    metric: "xp" | "ouro"; source_slug: string; target_slug: string;
    pokemon_id: number; pokemon_level: number; current_rate: number; target_rate: number;
  }) => call<AutoHuntAdvice>("POST", `/api/accounts/${numId(accId)}/autohunt/suggest`, suggestion),
  equip: (accId: string, kind: "ball" | "potion", id: number) =>
    call<EquipResult>("POST", `/api/accounts/${numId(accId)}/equip`, { kind, id }),
  selectHunt: (accId: string, slug: string) => call<HuntResult>("POST", `/api/accounts/${numId(accId)}/hunt`, { slug }),
  selectOutlandTier: (accId: string, tier: number) =>
    call<{ ok: boolean; confirmed: boolean; tier: number }>("POST", `/api/accounts/${numId(accId)}/outland-tier`, { tier }),
  sheet: (accId: string) => call<PokemonSheet>("GET", `/api/accounts/${numId(accId)}/sheet`),
  resetSession: () => call<{ ok: boolean; reset: string[] }>("POST", "/api/session/reset"),
  cancelHuntQueue: (accId: string) => call<{ ok: boolean }>("DELETE", `/api/accounts/${numId(accId)}/hunt/queue`),
};

export interface HuntSpecies {
  pokeId: number;
  nome: string;
  pontos: number;
}
export interface Hunt {
  slug: string;
  nome: string;
  area: string;
  nivel: number;
  regiao?: string | null;
  pixel?: [number, number] | null;
  looktype?: number | null;
  totalSpawns: number;
  especies: HuntSpecies[];
}
/** Um nível (tier) de Outland: `nivel` é o nível de treinador que libera, `mult` o multiplicador de itens raros. */
export interface OutlandTier {
  tier: number;
  rotulo: string;
  nivel: number;
  mult: number;
}
export interface HuntCatalog {
  account: string | null;
  level: number;
  current: string | null;
  hunts: Hunt[];
  outland?: { tiers: OutlandTier[]; tier: number };
}
/** Dados do jogo por espécie: nome, tipos, nomes do loot e looktype. */
export interface Creature {
  n: string;
  t: string[];
  l: string[];
  lk: number | null;
}

/** Catálogo de hunts (vem do `welcome` de uma conta conectada). */
export function useHuntCatalog(account: string | null) {
  const [data, setData] = useState<HuntCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let okAt = 0; // quando o catálogo veio com hunts pela última vez
    const load = () =>
      call<HuntCatalog>("GET", `/api/hunts${account ? `?account=${account}` : ""}`)
        .then((d) => {
          if (!alive) return;
          setData(d);
          setError(null);
          okAt = d.hunts.length ? Date.now() : 0;
        })
        .catch((e) => alive && setError(e instanceof Error ? e.message : "Erro inesperado"));
    void load();
    // Catálogo vazio (contas ainda conectando): tenta de novo logo. No modo economia, com hunts, só renova a cada minuto.
    const stop = everyWhileVisible(() => {
      if (!economyMode() || !okAt || Date.now() - okAt > 60_000) void load();
    }, 6000);
    return () => {
      alive = false;
      stop();
    };
  }, [account]);
  return { data, error };
}

let creaturesCache: Promise<Record<string, Creature>> | null = null;
/** Tipos e loot das espécies (um download só, guardado enquanto a página estiver aberta). */
export function useCreatures() {
  const [data, setData] = useState<Record<string, Creature> | null>(null);
  useEffect(() => {
    let alive = true;
    creaturesCache ??= call<Record<string, Creature>>("GET", "/api/creatures").catch((e) => {
      creaturesCache = null;
      throw e;
    });
    creaturesCache.then((d) => alive && setData(d)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return data;
}
