import { Check } from "lucide-react";
import { CARD_STYLES, setCardStyle, useCardStyle } from "@/lib/cardStyle";

/** Escolha do modelo do card de conta no Resumo do dashboard. Vale só neste navegador (fica salvo nele). */
export function CardStyleSection() {
  const current = useCardStyle();
  return (
    <section className="space-y-3" aria-labelledby="cardstyle-title">
      <h2 id="cardstyle-title" className="text-lg font-extrabold uppercase tracking-wide">Modelo do card</h2>
      <div className="tile space-y-3 p-3 sm:p-4">
        <p className="text-sm text-mute">Como cada conta aparece no Resumo do dashboard. A troca é na hora.</p>
        <div role="radiogroup" aria-label="Modelo do card" className="grid gap-2 sm:grid-cols-2">
          {CARD_STYLES.map((s) => {
            const on = s.id === current;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setCardStyle(s.id)}
                className={`relative rounded-xl border px-3 py-2.5 text-left transition-[border-color,background-color] duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-edge ${
                  on ? "border-poke-gold bg-[#2a1e0e]" : "border-line bg-void hover:border-edge/70"
                }`}
              >
                <span className={`block text-sm font-bold ${on ? "text-poke-gold" : "text-fg"}`}>{s.label}</span>
                <span className="mt-0.5 block pr-5 text-xs leading-snug text-mute">{s.desc}</span>
                {on && <Check className="absolute right-2 top-2 size-4 text-poke-gold" aria-hidden />}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
