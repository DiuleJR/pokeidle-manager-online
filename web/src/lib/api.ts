import { useEffect, useState } from "react";
import type { PokemonRow, SellDepotResult } from "./types";

/** Resolve as URLs do backend a partir de VITE_TELEMETRY_URL (ws://host/ws/telemetry?token=..)
 *  ou, se vazio, da mesma origem (em dev o Vite faz proxy de /ws e /api). */
/** Token: ?token= na URL da página (vira localStorage e some da barra) ou o salvo antes. */
function pageToken(): string | null {
  try {
    const u = new URL(location.href);
    const t = u.searchParams.get("token");
    if (t) {
      localStorage.setItem("pokeidle-token", t);
      u.searchParams.delete("token");
      history.replaceState(null, "", u.pathname + u.search + u.hash);
      return t;
    }
    return localStorage.getItem("pokeidle-token");
  } catch {
    return null;
  }
}
const PAGE_TOKEN = pageToken();

function parts() {
  const explicit = import.meta.env.VITE_TELEMETRY_URL as string | undefined;
  const u = new URL(explicit || `${location.origin}/ws/telemetry`, location.href);
  if (!u.searchParams.get("token") && PAGE_TOKEN) u.searchParams.set("token", PAGE_TOKEN);
  const secure = u.protocol === "wss:" || u.protocol === "https:";
  return {
    ws: `${secure ? "wss:" : "ws:"}//${u.host}${u.pathname}${u.search}`,
    http: `${secure ? "https:" : "http:"}//${u.host}`,
    token: u.searchParams.get("token"),
  };
}

export const wsUrl = () => parts().ws;

export function apiUrl(path: string, params: Record<string, string> = {}) {
  const { http, token } = parts();
  const q = new URLSearchParams(params);
  if (token) q.set("token", token);
  const qs = q.toString();
  return `${http}${path}${qs ? `?${qs}` : ""}`;
}

/**
 * Lista de Pokémons (pesada: busca sob demanda e atualiza a cada 15s enquanto
 * montado). `refreshNonce` força uma busca imediata quando muda (ex.: depois
 * de vender o Depot) sem esperar o próximo ciclo de 15s.
 */
export function usePokemons(account: string, refreshNonce = 0) {
  const [rows, setRows] = useState<PokemonRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(apiUrl("/api/pokemons", account === "all" ? {} : { account }));
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (alive) {
          setRows(j.pokemons as PokemonRow[]);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "erro");
      }
    };
    if (refreshNonce === 0) setRows(null); // só mostra "Carregando…" na troca de conta, não no refresh pós-venda
    void load();
    const i = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(i);
    };
  }, [account, refreshNonce]);

  return { rows, error };
}

/**
 * Vende o Depot (shop.sellAllPokemons) de uma conta ("acc1") ou de todas ("all").
 * AÇÃO IRREVERSÍVEL no jogo — o chamador deve confirmar com o usuário antes.
 */
export async function sellDepot(account: string): Promise<SellDepotResult[]> {
  const r = await fetch(apiUrl("/api/sell-depot", account === "all" ? {} : { account }), { method: "POST" });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return (j?.results as SellDepotResult[]) ?? [];
}

// ------------------------------------------------------------ sprites de Pokémon

export interface Atlas {
  cell: number;
  cols: number;
  rows: number;
  image: string;
  slots: Record<string, [number, number]>;
}

let atlas: Atlas | null = null;
let atlasPromise: Promise<void> | null = null;
const atlasListeners = new Set<() => void>();

function loadAtlas() {
  atlasPromise ??= fetch(apiUrl("/api/sprite-atlas"))
    .then((r) => r.json())
    .then((j: Atlas) => {
      atlas = j;
      atlasListeners.forEach((l) => l());
    })
    .catch(() => {
      atlasPromise = null; // tenta de novo na próxima montagem
    });
}

/** Índice de retratos (looktype -> célula do atlas do jogo), carregado uma vez. */
export function useAtlas(): Atlas | null {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    atlasListeners.add(l);
    loadAtlas();
    return () => {
      atlasListeners.delete(l);
    };
  }, []);
  return atlas;
}
