import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "./admin";

/** Ordem e nomes das faixas do PVP ranqueado (as mesmas do jogo). */
export const TIER_NAME: Record<string, string> = {
  bronze: "Bronze",
  prata: "Prata",
  ouro: "Ouro",
  platina: "Platina",
  diamante: "Diamante",
  mestre: "Mestre",
  graomestre: "Grão-Mestre",
  challenger: "Challenger",
};
/** Cor de cada faixa (aro do emblema, barra de progresso). */
export const TIER_COLOR: Record<string, string> = {
  bronze: "#c98a55",
  prata: "#b9c4d0",
  ouro: "#f3c04a",
  platina: "#5fd6c8",
  diamante: "#7cb8ff",
  mestre: "#c48bff",
  graomestre: "#ff7aa8",
  challenger: "#ffd56b",
};
export const rankIcon = (tier: string) => `https://pokeidle.io/img/ranks/${tier}.webp`;
export const PLACEMENT_MATCHES = 5;

export interface PvpRank {
  pontos: number;
  pico?: number;
  vitorias: number;
  derrotas: number;
  partidas: number;
  sequencia?: number;
  escudo?: number;
  tierId: string;
  divisaoNum?: string;
  de?: number;
  ate?: number | null;
  progresso?: number | null;
  naFaixa?: number;
  larguraFaixa?: number | null;
  posicao?: number | null;
}
export interface PvpTeamMember {
  id: number;
  missing?: boolean;
  name?: string;
  level?: number;
  looktype?: number | null;
  shiny?: boolean;
  types?: string[];
  power?: number;
}
export interface PvpMatch {
  id: number | null;
  won: boolean;
  delta: number;
  opponent: string;
  at: number | string | null;
}
export type PvpBlocker = "offline" | "level" | "team" | null;
export interface PvpAccount {
  id: number;
  nick: string;
  level: number;
  online: boolean;
  vip: boolean;
  auto: boolean;
  nativeAuto: boolean;
  levelMin: number;
  blocker: PvpBlocker;
  blockerText: string | null;
  rank: PvpRank | null;
  position: number | null;
  totalRanked: number | null;
  team: PvpTeamMember[];
  queue: { on: boolean; since: number; size: number; waitMs: number };
  refusal: { msg: string; at: number } | null;
  session: { wins: number; losses: number; delta: number; matches: PvpMatch[] };
  history: PvpMatch[];
}
export interface PvpOverview {
  ts: number;
  accounts: PvpAccount[];
}
export interface LadderRow {
  pos: number;
  nick: string;
  tier: string;
  division: string;
  points: number;
  wins: number;
  losses: number;
}
export interface LadderPage {
  page: number;
  pages: number;
  week: string;
  rows: LadderRow[];
  at: number;
}

export const pvpApi = {
  overview: () => call<PvpOverview>("GET", "/api/pvp"),
  ladder: (page: number) => call<LadderPage>("GET", `/api/pvp/ladder?pagina=${page}`),
  queue: (id: number, action: "enter" | "leave") => call<{ ok: boolean }>("POST", `/api/pvp/${id}/queue`, { action }),
  auto: (id: number, on: boolean) => call<{ ok: boolean }>("POST", `/api/pvp/${id}/auto`, { on }),
  autoAll: (on: boolean) => call<{ ok: boolean; accounts: number }>("POST", "/api/pvp/auto", { on }),
};

/**
 * Painel do PVP ao vivo: consulta a API a cada 2 s enquanto a aba está aberta e a página visível.
 * `refresh()` força uma leitura logo após uma ação (entrar na fila, ligar a automática).
 */
export function usePvp() {
  const [data, setData] = useState<PvpOverview | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const d = await pvpApi.overview();
      if (alive.current) {
        setData(d);
        setError("");
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Falha ao ler o PVP");
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const i = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 2000);
    return () => {
      alive.current = false;
      clearInterval(i);
    };
  }, [refresh]);

  return { data, error, refresh };
}

/** "m:ss" a partir de milissegundos. */
export const clockMs = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Nome da faixa com a divisão: "Ouro II"; as faixas de elite não têm divisão. */
export const rankLabel = (r: Pick<PvpRank, "tierId" | "divisaoNum">) =>
  `${TIER_NAME[r.tierId] ?? r.tierId}${r.divisaoNum ? ` ${r.divisaoNum}` : ""}`;
