import { useCallback, useEffect, useRef, useState } from "react";
import { Coin } from "@/components/ui";
import { Notice } from "@/components/SettingsView";
import { type Moeda } from "@/lib/market";
import { useAccountIds, useAccountsMap } from "@/lib/telemetry";
import { fmtInt, fmtShort } from "@/lib/utils";

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado");

/** Chamada assíncrona com carregando/erro e recarga (opcionalmente periódica). */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], opts: { every?: number; skip?: boolean } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!opts.skip);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const load = useCallback(async (silent = false) => {
    const mine = ++seq.current;
    if (!silent) setLoading(true);
    try {
      const r = await fnRef.current();
      if (mine === seq.current) {
        setData(r);
        setError(null);
      }
    } catch (e) {
      if (mine === seq.current) setError(errMsg(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (opts.skip) return;
    setData(null);
    void load();
    if (!opts.every) return;
    const t = setInterval(() => void load(true), opts.every);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, opts.skip, opts.every]);

  return { data, error, loading, reload: () => load(), setData };
}

/** Relógio que atualiza a cada segundo (contagem regressiva dos anúncios). */
export function useTick(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function Money({ v, moeda, short = false, className = "" }: { v: number | null | undefined; moeda: Moeda; short?: boolean; className?: string }) {
  if (v == null) return <span className="text-mute">—</span>;
  return (
    <span className={`inline-flex items-center gap-1 tnum ${className}`} title={`${fmtInt(v)} ${moeda === "orb" ? "Gemas" : "Gold"}`}>
      <Coin kind={moeda === "orb" ? "gem" : "gold"} size={14} />
      {short ? fmtShort(v) : fmtInt(v)}
    </span>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="space-y-2">
      <Notice tone="warn">{error}</Notice>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Tentar de novo
        </button>
      )}
    </div>
  );
}

export function Loading({ text = "Carregando…" }: { text?: string }) {
  return <p className="card p-6 text-center text-sm text-mute">{text}</p>;
}

/** Escolhe a conta que consulta/compra (só as online). O valor é o número da conta (acc1 → 1). */
export function useOnlineAccounts() {
  const ids = useAccountIds();
  const map = useAccountsMap();
  return ids
    .filter((i) => map[i]?.status === "online")
    .map((i) => ({ id: Number(i.replace(/\D/g, "")), key: i, nick: map[i]?.nick ?? i, gold: map[i]?.gold ?? 0, gems: map[i]?.gems ?? 0 }));
}

export function AccountPicker({ value, onChange, label = "Conta" }: { value: number | undefined; onChange: (v: number | undefined) => void; label?: string }) {
  const accs = useOnlineAccounts();
  useEffect(() => {
    if (accs.length && (value === undefined || !accs.some((a) => a.id === value))) onChange(accs[0].id);
  }, [accs, value, onChange]);
  if (!accs.length) return <span className="text-sm text-mute">Nenhuma conta online</span>;
  return (
    <label className="flex items-center gap-2">
      <span className="text-sm font-semibold text-mute">{label}</span>
      <select className="field" value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))}>
        {accs.map((a) => (
          <option key={a.id} value={a.id}>
            {a.nick}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CurrencyToggle({ value, onChange }: { value: Moeda; onChange: (m: Moeda) => void }) {
  return (
    <div className="flex gap-1.5" role="group" aria-label="Moeda">
      {(["gold", "orb"] as Moeda[]).map((m) => (
        <button key={m} className="btn" data-active={value === m} aria-pressed={value === m} onClick={() => onChange(m)}>
          <Coin kind={m === "orb" ? "gem" : "gold"} size={16} />
          {m === "orb" ? "Gemas" : "Gold"}
        </button>
      ))}
    </div>
  );
}

export function Pager({ page, onPage, hasMore }: { page: number; onPage: (p: number) => void; hasMore: boolean }) {
  return (
    <div className="flex items-center justify-center gap-3 pt-1">
      <button className="btn" disabled={page <= 0} onClick={() => onPage(page - 1)}>
        ‹ Anterior
      </button>
      <span className="tnum text-sm text-mute">Página {page + 1}</span>
      <button className="btn" disabled={!hasMore} onClick={() => onPage(page + 1)}>
        Próxima ›
      </button>
    </div>
  );
}

const dayLabel = (d: string) => d.slice(5).replace("-", "/");

/** Gráfico de linha simples em SVG: série(s) com rótulos mínimo/máximo. */
export function LineChart({ series, height = 140 }: { series: { name: string; color: string; points: { x: string; y: number }[] }[]; height?: number }) {
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) return <p className="text-sm text-mute">Ainda não há pontos suficientes para o gráfico.</p>;
  const xs = Array.from(new Set(all.map((p) => p.x))).sort();
  const ys = all.map((p) => p.y);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const W = 600;
  const pad = 8;
  const px = (x: string) => pad + (xs.indexOf(x) / Math.max(xs.length - 1, 1)) * (W - pad * 2);
  const py = (y: number) => pad + (1 - (y - min) / span) * (height - pad * 2);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label="Gráfico de preços">
        {[0, 0.5, 1].map((t) => (
          <line key={t} x1={pad} x2={W - pad} y1={pad + t * (height - pad * 2)} y2={pad + t * (height - pad * 2)} stroke="#3b2b17" strokeWidth="1" />
        ))}
        {series.map((s) => (
          <polyline
            key={s.name}
            fill="none"
            stroke={s.color}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={s.points.map((p) => `${px(p.x)},${py(p.y)}`).join(" ")}
          />
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-mute">
        <span className="tnum">
          {fmtShort(min)} – {fmtShort(max)}
        </span>
        <span className="flex gap-3">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1">
              <span className="inline-block size-2 rounded-full" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </span>
        <span>
          {dayLabel(xs[0])} → {dayLabel(xs[xs.length - 1])}
        </span>
      </div>
    </div>
  );
}

export const fmtWhen = (ms: number | undefined | null) => (ms ? new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

export const fmtCountdown = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`);

/** "2d 3h", "5h 10m", "12m": duração curta a partir de segundos. */
export function secondsLabel(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
