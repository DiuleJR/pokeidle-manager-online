import { useState } from "react";
import { HistoryTab } from "./HistoryTab";
import { MineTab } from "./MineTab";
import { PokemonTab } from "./PokemonTab";
import { PricesTab } from "./PricesTab";
import { RulesTab } from "./RulesTab";
import { Reveal } from "@/components/ui";
import { Seg } from "./shared";

type Sub = "buy" | "sales" | "auto" | "mine";
const SUBS: { id: Sub; label: string }[] = [
  { id: "buy", label: "Comprar" },
  { id: "sales", label: "Vendas" },
  { id: "auto", label: "Automação" },
  { id: "mine", label: "Minha conta" },
];

const read = <T extends string>(key: string, valid: readonly T[], fallback: T): T => {
  try {
    const v = sessionStorage.getItem(key) as T | null;
    return v && valid.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, v: string) => {
  try {
    sessionStorage.setItem(key, v);
  } catch {
    /* sem armazenamento: só não lembra a aba */
  }
};

/** Aba Mercado: Comprar (itens e Pokémon), Vendas (histórico), Automação (alertas e sniper) e Minha conta. */
export function MarketView() {
  const [sub, setSub] = useState<Sub>(() => read("mkt-sub", ["buy", "sales", "auto", "mine"] as const, "buy"));
  const [kind, setKind] = useState<"items" | "pokemon">(() => read("mkt-kind", ["items", "pokemon"] as const, "items"));

  return (
    <div className="mkt space-y-3 sm:space-y-4">
      <Reveal index={0}>
      <div className="grid grid-cols-4 gap-1.5 sm:flex sm:gap-2" role="tablist" aria-label="Seção do mercado">
        {SUBS.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={sub === s.id}
            className="btn !px-1 sm:!px-3.5"
            data-active={sub === s.id}
            onClick={() => {
              setSub(s.id);
              save("mkt-sub", s.id);
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      </Reveal>

      <Reveal key={sub} index={1}>
      {sub === "buy" && (
        <div className="space-y-3 sm:space-y-4">
          <Seg
            label="O que comprar"
            value={kind}
            onChange={(v) => {
              setKind(v);
              save("mkt-kind", v);
            }}
            options={[
              { id: "items", label: "Itens" },
              { id: "pokemon", label: "Pokémon" },
            ]}
          />
          {kind === "items" ? <PricesTab /> : <PokemonTab />}
        </div>
      )}
      {sub === "sales" && <HistoryTab />}
      {sub === "auto" && <RulesTab />}
      {sub === "mine" && <MineTab />}
      </Reveal>
    </div>
  );
}
