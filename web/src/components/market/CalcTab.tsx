import { useState } from "react";
import { type Moeda, marketFee, priceForNet } from "@/lib/market";
import { fmtInt } from "@/lib/utils";
import { CurrencyToggle, Money, Seg } from "./shared";

const digits = (s: string) => Math.max(0, Math.floor(Number(s.replace(/\D/g, "")) || 0));

/**
 * Calculadora de venda: dois campos ligados, como a do próprio jogo.
 * Digite o quanto vai COBRAR e veja o que RECEBE, ou digite o que quer receber e veja o quanto cobrar.
 */
export function CalcCard() {
  const [moeda, setMoeda] = useState<Moeda>("gold");
  const [tipo, setTipo] = useState<"item" | "pokemon">("item");
  const [total, setTotal] = useState(100000);
  const [paid, setPaid] = useState("");

  const fee = marketFee(total, moeda, tipo);
  const net = total - fee;
  const pct = total ? (fee / total) * 100 : 0;
  const cost = digits(paid);
  const profit = cost ? net - cost : null;
  const tiered = moeda === "orb" && tipo === "pokemon";

  return (
    <section className="card space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-extrabold sm:text-lg">Quanto vou receber numa venda?</h2>
        <div className="flex flex-wrap gap-2">
          <CurrencyToggle value={moeda} onChange={setMoeda} />
          {moeda === "orb" && (
            <Seg
              label="O que vende"
              value={tipo}
              onChange={setTipo}
              options={[
                { id: "item", label: "Item" },
                { id: "pokemon", label: "Pokémon" },
              ]}
            />
          )}
        </div>
      </div>

      <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
        <label className="block space-y-1.5">
          <span className="label block">Eu cobro</span>
          <input className="field h-12 w-full text-lg font-bold" inputMode="numeric" value={total ? fmtInt(total) : ""} onChange={(e) => setTotal(digits(e.target.value))} aria-label="Valor cobrado" />
        </label>
        <span className="hidden pt-5 text-center text-2xl text-mute sm:block" aria-hidden>
          ⇄
        </span>
        <label className="block space-y-1.5">
          <span className="label block">Eu recebo</span>
          <input
            className="field h-12 w-full text-lg font-bold text-poke-green"
            inputMode="numeric"
            value={net ? fmtInt(net) : ""}
            onChange={(e) => {
              const want = digits(e.target.value);
              setTotal(want ? priceForNet(want, moeda, tipo) : 0);
            }}
            aria-label="Valor que recebo"
          />
        </label>
      </div>

      <p className="flex items-center justify-between rounded-lg border border-line bg-tile px-3 py-2 text-sm">
        <span className="text-mute">Comissão do jogo ({pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)</span>
        <span className="text-poke-red">
          −<Money v={fee} moeda={moeda} />
        </span>
      </p>

      <details className="text-sm">
        <summary className="cursor-pointer text-mute hover:text-fg">Calcular lucro (quanto paguei)</summary>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input className="field w-40" inputMode="numeric" placeholder="Paguei (total)" value={paid} onChange={(e) => setPaid(String(digits(e.target.value) || ""))} aria-label="Quanto paguei" />
          {profit != null && (
            <span className={`tnum font-bold ${profit >= 0 ? "text-poke-green" : "text-poke-red"}`}>
              Lucro: {profit >= 0 ? "+" : "−"}
              {fmtInt(Math.abs(profit))} ({((profit / cost) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)
            </span>
          )}
        </div>
      </details>

      <p className="text-xs text-mute">
        {moeda === "gold"
          ? "Em Gold, a comissão é de 15% em qualquer anúncio."
          : tiered
            ? "Pokémon em Gemas: 13% até 500, 10% de 501 a 5.000 e 7,5% acima disso (só sobre a parte de cada faixa)."
            : "Item em Gemas: comissão fixa de 15%."}{" "}
        Mesmas contas do jogo, com o líquido arredondado para baixo.
      </p>
    </section>
  );
}
