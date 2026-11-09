import { useState } from "react";
import { ItemsView } from "@/components/ItemsView";
import { PokemonsView } from "@/components/PokemonsView";
import { ValueCard } from "@/components/ValueCard";
import { useValuation } from "@/lib/valuation";
import { useAccountIds, useAccountsMap } from "@/lib/telemetry";

/** Seletor de conta (controlado pelo App, fica no cabeçalho) + abas Itens / Pokémon. */
export function InventoryView({ account }: { account: string }) {
  const ids = useAccountIds();
  const [sub, setSub] = useState<"items" | "pokemons">("items");
  const selected = account === "all" || ids.includes(account) ? account : "all";
  const val = useValuation();

  return (
    <div className="space-y-2.5 sm:space-y-4">
      <ValueCard account={selected} valuation={val.data} error={val.error} />
      <div className="flex gap-1.5 sm:gap-2" role="tablist" aria-label="Seção">
        <button role="tab" aria-selected={sub === "items"} className="btn" data-active={sub === "items"} onClick={() => setSub("items")}>
          Itens
        </button>
        <button role="tab" aria-selected={sub === "pokemons"} className="btn" data-active={sub === "pokemons"} onClick={() => setSub("pokemons")}>
          Pokémon
        </button>
      </div>
      {sub === "items" ? <ItemsView account={selected} valuation={val.data} /> : <PokemonsView account={selected} valuation={val.data} />}
    </div>
  );
}

export function AccountSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ids = useAccountIds();
  const accounts = useAccountsMap();
  return (
    <label className="flex items-center gap-2">
      <span className="hidden text-sm font-semibold text-mute sm:inline">Conta</span>
      <select className="field max-w-[44vw] sm:max-w-none" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="all">Todas as contas</option>
        {ids.map((id) => (
          <option key={id} value={id}>
            {accounts[id]?.nick ?? id}
          </option>
        ))}
      </select>
    </label>
  );
}
