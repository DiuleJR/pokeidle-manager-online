import type React from "react";
import { ItemSprite, PokemonSprite } from "@/components/Sprites";
import type { Boss } from "@/lib/boss";

export const EASE = [0.22, 1, 0.36, 1] as const;
export const pt = new Intl.NumberFormat("pt-BR");
export const VIOLET = "#b66bff";

export function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200 disabled:opacity-40"
      style={{ borderColor: on ? VIOLET : "#3b2b17", background: on ? "rgba(182,107,255,.35)" : "#16100a" }}
    >
      <span className="absolute left-0.5 top-0.5 size-4 rounded-full transition-transform duration-200" style={{ background: on ? VIOLET : "#b39a6e", transform: on ? "translateX(20px)" : "none" }} />
    </button>
  );
}

export function BossArt({ boss, size }: { boss: Boss; size: number }) {
  if (boss.looktype != null) return <PokemonSprite looktype={boss.looktype} species={boss.pokeId} size={size} />;
  if (boss.img) return <ItemSprite icon={`/assets/site${boss.img}`} size={size} alt={boss.name} />;
  return <PokemonSprite species={boss.pokeId} size={size} />;
}

export function hms(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

/** Vida do boss em barra, com a cor do verde ao vermelho como no jogo. */
export function HpBar({ hp, maxHp, label = "Vida do boss" }: { hp: number; maxHp: number; label?: string }) {
  const pct = maxHp ? Math.min(100, Math.max(0, (hp / maxHp) * 100)) : 0;
  const color = pct > 50 ? "#6fd47c" : pct > 20 ? "#f3c04a" : "#ef6b5b";
  return (
    <div>
      <div className="h-3 overflow-hidden rounded-full bg-black/50 ring-1 ring-line" role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}aa, ${color})` }} />
      </div>
      <div className="tnum mt-0.5 flex justify-between text-[11px] font-semibold text-mute">
        <span>{pt.format(Math.round(hp))} / {pt.format(maxHp)}</span>
        <span>{pct < 10 && pct > 0 ? pct.toFixed(1).replace(".", ",") : Math.round(pct)}%</span>
      </div>
    </div>
  );
}

/** Opção ligar/desligar com título, descrição curta e o interruptor no mesmo bloco clicável. */
export function OptionTile({ on, icon, title, desc, disabled, onChange }: { on: boolean; icon: React.ReactNode; title: string; desc: string; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={`flex items-start gap-3 rounded-lg border p-3 transition-colors duration-200 ${on ? "border-[#b66bff] bg-[#2e1f45]" : "border-line bg-tile"}`}>
      <div className="min-w-0 flex-1">
        <b className="flex items-center gap-1.5 text-sm">{icon}{title}</b>
        <p className="mt-1 text-xs leading-snug text-mute">{desc}</p>
      </div>
      <Switch on={on} label={title} disabled={disabled} onChange={onChange} />
    </div>
  );
}
