import { useState } from "react";
import { CalcTab } from "./CalcTab";
import { HistoryTab } from "./HistoryTab";
import { MineTab } from "./MineTab";
import { PokemonTab } from "./PokemonTab";
import { PricesTab } from "./PricesTab";
import { RulesTab } from "./RulesTab";

type Sub = "prices" | "pokemon" | "history" | "rules" | "mine" | "calc";
const SUBS: { id: Sub; label: string }[] = [
  { id: "prices", label: "Itens" },
  { id: "pokemon", label: "Pokémon" },
  { id: "history", label: "Histórico" },
  { id: "rules", label: "Alertas e sniper" },
  { id: "mine", label: "Minha conta" },
  { id: "calc", label: "Calculadora" },
];

const readSub = (): Sub => {
  try {
    const v = sessionStorage.getItem("mkt-sub") as Sub | null;
    return v && SUBS.some((s) => s.id === v) ? v : "prices";
  } catch {
    return "prices";
  }
};

/** Aba Mercado: preços e médias, vitrine de Pokémon, histórico de vendas, alertas/sniper, carteira e calculadora. */
export function MarketView() {
  const [sub, setSub] = useState<Sub>(readSub);
  const [account, setAccount] = useState<number | undefined>(undefined);
  const go = (s: Sub) => {
    setSub(s);
    try {
      sessionStorage.setItem("mkt-sub", s);
    } catch {
      /* sem armazenamento: só não lembra a aba */
    }
  };

  return (
    <div className="space-y-2.5 sm:space-y-4">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:gap-2" role="tablist" aria-label="Seção do mercado">
        {SUBS.map((s) => (
          <button key={s.id} role="tab" aria-selected={sub === s.id} className="btn shrink-0" data-active={sub === s.id} onClick={() => go(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      {sub === "prices" && <PricesTab account={account} onAccount={setAccount} />}
      {sub === "pokemon" && <PokemonTab account={account} onAccount={setAccount} />}
      {sub === "history" && <HistoryTab account={account} onAccount={setAccount} />}
      {sub === "rules" && <RulesTab />}
      {sub === "mine" && <MineTab account={account} onAccount={setAccount} />}
      {sub === "calc" && <CalcTab />}
    </div>
  );
}
