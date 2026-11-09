import { useEffect, useState } from "react";
import { call } from "./admin";

export interface Valuation {
  usdPerGem: number | null;
  days: number;
  items: Record<string, { gems: number; sold?: number | null }>;
  shinies: { account: number; id: number; name: string; gems: number | null }[];
  pending: number;
}

/** Valor estimado (em Gemas) dos itens e shinies. Atualiza a cada 5 min (e a cada 8 s enquanto faltam preços de shiny). */
export function useValuation(enabled = true) {
  const [data, setData] = useState<Valuation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const v = await call<Valuation>("GET", "/api/market/valuation");
        if (!alive) return;
        setData(v);
        setError(null);
        setLoading(false);
        timer = setTimeout(load, v.pending > 0 ? 8000 : 300000);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Erro");
        setLoading(false);
        timer = setTimeout(load, 60000);
      }
    };
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [enabled]);

  return { data, error, loading };
}

export const gemsToUsd = (gems: number, v: Valuation | null) => (v?.usdPerGem ? gems * v.usdPerGem : null);
export const fmtUsd = (n: number) => `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
