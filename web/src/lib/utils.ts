const nf = new Intl.NumberFormat("pt-BR");
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export const fmtInt = (n: number) => nf.format(Math.round(n));
/** Número curto: 9.999 -> "9.999"; 15.800 -> "15.8K"; 1.5M; 3.6B; 2T (ponto decimal, sem ".0"). */
export function fmtShort(n: number): string {
  const abs = Math.abs(n);
  if (abs < 10_000) return fmtInt(n);
  const units = ["K", "M", "B", "T"];
  let i = 0;
  let v = abs;
  do {
    v /= 1000;
    i++;
  } while (Math.round(v * 10) / 10 >= 1000 && i < units.length);
  const s = (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, "");
  return `${n < 0 ? "-" : ""}${s}${units[i - 1]}`;
}
export const fmtCompact = (n: number) => (Math.abs(n) >= 10_000 ? compact.format(n) : fmtInt(n));

export function fmtDuration(minutes: number) {
  const s = Math.max(0, Math.round(minutes * 60));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`;
}
