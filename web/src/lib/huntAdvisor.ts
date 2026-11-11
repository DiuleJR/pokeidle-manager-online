import { useCallback, useEffect, useRef, useState } from "react";
import { actions, type PokemonSheet } from "./actions";

/**
 * "Melhor hunt" para o Pokémon equipado. O cálculo é o motor da calculadora de hunt do PokéIdle Hub
 * (https://pokeidle-gg.pages.dev), que roda num worker (public/hunt-worker.js) carregando o código do site deles.
 * O Pokémon vem direto do estado do jogo (sem colar ficha) e nada dele sai do navegador.
 */
export type HuntOrder = "xp" | "ouro";

export interface HuntLine {
  slug: string;
  nome: string;
  regiao: string | null;
  nivel: number;
  liberada: boolean;
  inviavel: boolean;
  xpPokemonH: number;
  ouroH: number;
  kph: number;
  mortesH: number;
  umHit: boolean;
  hitPct: number;
  melhorGolpe: { nome: string; tipo: string } | null;
}
interface Result {
  versao: string | null;
  total: number;
  linhas: HuntLine[];
}
export interface BestHunts {
  sheet: PokemonSheet;
  lines: HuntLine[];
  versao: string | null;
}

const metric = (l: HuntLine, o: HuntOrder) => (o === "ouro" ? l.ouroH : l.xpPokemonH);
/** As hunts que a conta já pode fazer e que o motor acha viáveis, da que mais rende para a que menos rende. */
export const rankLines = (lines: HuntLine[] | undefined, order: HuntOrder) =>
  (lines ?? []).filter((l) => l.liberada && !l.inviavel && metric(l, order) > 0).sort((a, b) => metric(b, order) - metric(a, order) || a.nivel - b.nivel);
export const lineMetric = metric;

// ----------------------------------------------------------------- worker
let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { ok: (r: Result) => void; fail: (e: Error) => void }>();

function failAll(msg: string) {
  for (const w of waiting.values()) w.fail(new Error(msg));
  waiting.clear();
  worker?.terminate();
  worker = null;
}
function run(entrada: { sheet: PokemonSheet; nivelTreinador: number }): Promise<Result> {
  if (!worker) {
    worker = new Worker(`${import.meta.env.BASE_URL}hunt-worker.js`, { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; dados?: Result; erro?: string }>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.ok && e.data.dados) w.ok(e.data.dados);
      else w.fail(new Error(e.data.erro ?? "Falha no cálculo"));
    };
    worker.onerror = () => failAll("Não consegui carregar a calculadora de hunt.");
  }
  const id = ++seq;
  return new Promise((ok, fail) => {
    waiting.set(id, { ok, fail });
    worker?.postMessage({ id, entrada });
  });
}

// ----------------------------------------------------------------- hook
const cache = new Map<string, BestHunts>();
const keyOf = (s: PokemonSheet) => [s.speciesId, s.level, s.potencia, s.quality, s.shiny, s.trainerLevel, Object.values(s.stats).join("-")].join("|");
const RECALC_MS = 45_000; // subir de nível muda os stats: recalcula, mas sem exagero

/** `trigger` muda quando o Pokémon equipado ou o nível da conta muda; `enabled` só com a conta online. */
export function useBestHunts(accId: string | null, trigger: string, enabled: boolean) {
  const [data, setData] = useState<BestHunts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const last = useRef({ acc: "", at: 0 });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!accId || !enabled) return;
    let alive = true;
    const switched = last.current.acc !== accId;
    if (switched) setData(null);
    const wait = switched || !last.current.at ? 300 : Math.max(300, last.current.at + RECALC_MS - Date.now());
    const t = setTimeout(async () => {
      try {
        const sheet = await actions.sheet(accId);
        const key = keyOf(sheet);
        const hit = cache.get(key);
        if (hit) {
          if (alive) (setData(hit), setError(null));
          return;
        }
        if (alive) setLoading(true);
        const r = await run({ sheet, nivelTreinador: sheet.trainerLevel });
        const out: BestHunts = { sheet, lines: r.linhas, versao: r.versao };
        cache.set(key, out);
        if (cache.size > 12) cache.delete(cache.keys().next().value as string);
        last.current = { acc: accId, at: Date.now() };
        if (alive) (setData(out), setError(null));
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Erro inesperado");
      } finally {
        if (alive) setLoading(false);
      }
    }, wait);
    last.current.acc = accId;
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [accId, trigger, enabled, nonce]);

  return { data, error, loading, reload };
}
