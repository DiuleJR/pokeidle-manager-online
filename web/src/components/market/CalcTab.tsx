import { useState } from "react";
import { Labeled } from "@/components/SettingsView";
import { type Moeda, marketFee, priceForNet } from "@/lib/market";
import { fmtInt } from "@/lib/utils";
import { CurrencyToggle, Money } from "./shared";

const digits = (s: string) => Math.max(0, Math.floor(Number(s.replace(/\D/g, "")) || 0));
const TIERS = [
  { from: 0, to: 500, pct: 13 },
  { from: 500, to: 5000, pct: 10 },
  { from: 5000, to: Infinity, pct: 7.5 },
];

/** Calculadora de venda: comissão, líquido, preço para receber um valor e lucro sobre o custo. */
export function CalcTab() {
  const [moeda, setMoeda] = useState<Moeda>("gold");
  const [tipo, setTipo] = useState<"item" | "pokemon">("item");
  const [mode, setMode] = useState<"price" | "net">("price");
  const [price, setPrice] = useState("100000");
  const [qty, setQty] = useState("1");
  const [net, setNet] = useState("100000");
  const [cost, setCost] = useState("");

  const q = Math.max(1, digits(qty));
  // A comissão incide sobre o TOTAL da venda; no modo "quero receber X", acha o total que rende X.
  const total = mode === "price" ? digits(price) * q : priceForNet(digits(net), moeda, tipo);
  const fee = marketFee(total, moeda, tipo);
  const liquid = total - fee;
  const pct = total ? (fee / total) * 100 : 0;
  const c = digits(cost) * (tipo === "item" ? q : 1);
  const profit = c ? liquid - c : null;
  const tiered = moeda === "orb" && tipo === "pokemon";

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="card space-y-3 p-3 sm:p-4">
        <h2 className="text-base font-extrabold sm:text-lg">Calculadora de venda</h2>
        <div className="flex flex-wrap gap-2">
          <CurrencyToggle value={moeda} onChange={setMoeda} />
          <div className="flex gap-1.5">
            <button className="btn" data-active={tipo === "item"} onClick={() => setTipo("item")}>
              Item
            </button>
            <button className="btn" data-active={tipo === "pokemon"} onClick={() => setTipo("pokemon")}>
              Pokémon
            </button>
          </div>
        </div>
        <div className="flex gap-1.5">
          <button className="btn" data-active={mode === "price"} onClick={() => setMode("price")}>
            Sei o preço
          </button>
          <button className="btn" data-active={mode === "net"} onClick={() => setMode("net")}>
            Quero receber…
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {mode === "price" ? (
            <Labeled label={`Preço ${tipo === "item" ? "por unidade" : "do anúncio"}`}>
              <input className="field w-full" inputMode="numeric" value={price} onChange={(e) => setPrice(String(digits(e.target.value) || ""))} />
            </Labeled>
          ) : (
            <Labeled label="Quero receber (líquido)">
              <input className="field w-full" inputMode="numeric" value={net} onChange={(e) => setNet(String(digits(e.target.value) || ""))} />
            </Labeled>
          )}
          {tipo === "item" && (
            <Labeled label="Quantidade">
              <input className="field w-full" inputMode="numeric" value={qty} onChange={(e) => setQty(String(digits(e.target.value) || ""))} />
            </Labeled>
          )}
          <Labeled label={`Custo ${tipo === "item" ? "por unidade" : "total"} (opcional)`} hint="Para ver o lucro.">
            <input className="field w-full" inputMode="numeric" value={cost} onChange={(e) => setCost(String(digits(e.target.value) || ""))} />
          </Labeled>
        </div>
      </section>

      <section className="card space-y-2 p-3 sm:p-4">
        <h2 className="text-base font-extrabold sm:text-lg">Resultado</h2>
        <dl className="space-y-1.5 text-sm">
          {mode === "net" && tipo === "item" && q > 0 && (
            <div className="flex items-center justify-between">
              <dt className="text-mute">Cobrar por unidade</dt>
              <dd>
                <Money v={Math.ceil(total / q)} moeda={moeda} className="font-bold" />
              </dd>
            </div>
          )}
          <div className="flex items-center justify-between">
            <dt className="text-mute">Total da venda</dt>
            <dd>
              <Money v={total} moeda={moeda} />
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-mute">Comissão do jogo ({pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)</dt>
            <dd className="text-poke-red">
              −<Money v={fee} moeda={moeda} />
            </dd>
          </div>
          <div className="flex items-center justify-between border-t border-line pt-1.5 text-base">
            <dt className="font-bold">Você recebe</dt>
            <dd>
              <Money v={liquid} moeda={moeda} className="font-extrabold text-poke-green" />
            </dd>
          </div>
          {profit != null && (
            <div className="flex items-center justify-between">
              <dt className="text-mute">Lucro sobre o custo</dt>
              <dd className={`tnum font-bold ${profit >= 0 ? "text-poke-green" : "text-poke-red"}`}>
                {profit >= 0 ? "+" : "−"}
                {fmtInt(Math.abs(profit))} ({c ? ((profit / c) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : 0}%)
              </dd>
            </div>
          )}
        </dl>
        <p className="text-xs text-mute">
          {moeda === "gold"
            ? "Em Gold a comissão é de 15%, para qualquer anúncio."
            : tiered
              ? "Pokémon em Gemas: comissão por faixa, como imposto de renda (13% até 500, 10% de 501 a 5.000, 7,5% acima)."
              : "Item em Gemas: comissão fixa de 15%."}{" "}
          Valores iguais aos que o jogo cobra; o líquido é arredondado para baixo.
        </p>
        {tiered && (
          <ul className="space-y-0.5 text-xs text-mute">
            {TIERS.map((t) => {
              const base = Math.max(0, Math.min(total, t.to) - t.from);
              return (
                <li key={t.from} className="flex justify-between">
                  <span>
                    {t.to === Infinity ? `Acima de ${fmtInt(t.from)}` : `${fmtInt(t.from + (t.from ? 1 : 0))} a ${fmtInt(t.to)}`} · {t.pct}%
                  </span>
                  <span className="tnum">{fmtInt(base)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
