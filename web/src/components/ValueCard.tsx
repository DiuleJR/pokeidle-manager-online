import { useMemo } from "react";
import { ItemSprite } from "@/components/Sprites";
import { Coin } from "@/components/ui";
import { type Valuation, fmtUsd, gemsToUsd } from "@/lib/valuation";
import { useAccountIds, useAccountsMap } from "@/lib/telemetry";
import { fmtInt, fmtShort } from "@/lib/utils";

interface Line {
  key: string;
  name: string;
  icon?: string | null;
  qty: number;
  unit: number;
  total: number;
  rare: boolean;
  shiny?: boolean;
}

/** Valor estimado do inventário: itens, raros e Pokémon shiny, em Gemas e em dólar. */
export function ValueCard({ account, valuation, error }: { account: string; valuation: Valuation | null; error: string | null }) {
  const accounts = useAccountsMap();
  const ids = useAccountIds();

  const calc = useMemo(() => {
    if (!valuation) return null;
    const lines = new Map<string, Line>();
    let unpriced = 0;
    for (const id of ids) {
      if (account !== "all" && account !== id) continue;
      for (const i of accounts[id]?.inventory?.items ?? []) {
        if (i.qty <= 0 || !i.rare) continue; // itens comuns têm preço inflado por quem compra de si mesmo: ficam fora
        const unit = valuation.items[String(i.id)]?.gems;
        if (!unit) {
          unpriced++;
          continue;
        }
        const k = `i${i.id}`;
        const l = lines.get(k) ?? { key: k, name: i.name, icon: i.icon, qty: 0, unit, total: 0, rare: !!i.rare };
        l.qty += i.qty;
        l.total = l.qty * unit;
        lines.set(k, l);
      }
    }
    const all = [...lines.values()];
    const rare = all.filter((l) => l.rare).reduce((s, l) => s + l.total, 0);
    const num = (id: string) => Number(id.replace(/\D/g, ""));
    const shinyList = valuation.shinies.filter((s) => account === "all" || num(account) === s.account);
    const shiny = shinyList.reduce((s, p) => s + (p.gems ?? 0), 0);
    const shinyUnknown = shinyList.filter((p) => p.gems == null).length;
    const bySpecies = new Map<string, Line>();
    for (const p of shinyList) {
      if (p.gems == null) continue;
      const l = bySpecies.get(p.name) ?? { key: `s${p.name}`, name: p.name, qty: 0, unit: p.gems, total: 0, rare: false, shiny: true };
      l.qty += 1;
      l.total += p.gems;
      bySpecies.set(p.name, l);
    }
    const top = [...all, ...bySpecies.values()].sort((a, b) => b.total - a.total).slice(0, 5);
    return { total: rare + shiny, rare, shiny, shinyCount: shinyList.length, shinyUnknown, top, unpriced };
  }, [valuation, accounts, ids, account]);

  if (error && !valuation) {
    return <p className="card p-3 text-sm text-mute">Valor do inventário indisponível agora: {error}</p>;
  }
  if (!calc || !valuation) return <p className="card p-3 text-sm text-mute">Calculando o valor do inventário…</p>;

  const usd = gemsToUsd(calc.total, valuation);
  const parts = [
    { label: "Itens raros", v: calc.rare },
    { label: `Shiny${calc.shinyCount ? ` (${calc.shinyCount})` : ""}`, v: calc.shiny },
  ];

  return (
    <section className="card space-y-3 p-3 sm:p-4" aria-label="Valor estimado do inventário">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <div>
          <p className="label">Valor estimado</p>
          <p className="flex items-center gap-2 text-2xl font-extrabold tnum sm:text-3xl">
            <Coin kind="gem" size={28} />
            {fmtInt(Math.round(calc.total))}
          </p>
        </div>
        {usd != null && <p className="text-lg font-bold text-poke-green tnum sm:text-xl">≈ {fmtUsd(usd)}</p>}
      </div>

      <div className="grid grid-cols-2 gap-2 text-center">
        {parts.map((p) => (
          <div key={p.label} className="tile p-2">
            <p className="text-xs text-mute">{p.label}</p>
            <p className="tnum font-bold">{fmtShort(Math.round(p.v))}</p>
            {usd != null && valuation.usdPerGem ? <p className="tnum text-[11px] text-mute">{fmtUsd(p.v * valuation.usdPerGem)}</p> : null}
          </div>
        ))}
      </div>

      {calc.top.length > 0 && (
        <div>
          <p className="label mb-1.5">Os que mais valem</p>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {calc.top.map((l) => (
              <li key={l.key} className="flex items-center gap-2.5 px-2.5 py-1.5 text-sm">
                {l.shiny ? <span className="grid size-7 place-items-center text-lg">✨</span> : <ItemSprite icon={l.icon} size={28} alt="" />}
                <span className="min-w-0 flex-1 truncate font-semibold">{l.shiny ? `${l.name} (shiny)` : l.name}</span>
                <span className="tnum text-xs text-mute">
                  {fmtShort(l.qty)} × {fmtShort(Math.round(l.unit))}
                </span>
                <span className="inline-flex items-center gap-1 tnum font-bold">
                  <Coin kind="gem" size={14} />
                  {fmtShort(Math.round(l.total))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-mute">
        Só entram itens raros e Pokémon shiny: itens comuns ficam de fora porque têm preço inflado por jogadores que compram deles mesmos. Raros: média de venda em Gemas dos últimos {valuation.days} dias; shiny: mediana das vendas recentes da espécie.
        {calc.unpriced > 0 && ` ${calc.unpriced} item(ns) raro(s) sem venda em Gemas não entram na conta.`}
        {calc.shinyUnknown > 0 && ` ${calc.shinyUnknown} shiny sem preço ainda${valuation.pending > 0 ? " (calculando…)" : ""}.`}
      </p>
    </section>
  );
}
