import { Check } from "lucide-react";
import { LANGS, type Lang, setLang, useItemLabel, useLang } from "@/lib/lang";

/** Bandeiras simples em SVG (as mesmas cores das do jogo), sem imagem externa. */
const FLAGS: Record<Lang, React.ReactNode> = {
  pt: (
    <svg viewBox="0 0 28 20" aria-hidden className="h-5 w-7 shrink-0 rounded-[3px]">
      <rect width="28" height="20" fill="#009c3b" />
      <path d="M14 3 25 10 14 17 3 10Z" fill="#ffdf00" />
      <circle cx="14" cy="10" r="4" fill="#002776" />
    </svg>
  ),
  en: (
    <svg viewBox="0 0 28 20" aria-hidden className="h-5 w-7 shrink-0 rounded-[3px]">
      <rect width="28" height="20" fill="#f5f5f5" />
      <g fill="#b22234">
        <rect width="28" height="3" />
        <rect y="6" width="28" height="3" />
        <rect y="12" width="28" height="3" />
        <rect y="17" width="28" height="3" />
      </g>
      <rect width="12" height="11" fill="#3c3b6e" />
    </svg>
  ),
  es: (
    <svg viewBox="0 0 28 20" aria-hidden className="h-5 w-7 shrink-0 rounded-[3px]">
      <rect width="28" height="20" fill="#aa151b" />
      <rect y="5" width="28" height="10" fill="#f1bf00" />
    </svg>
  ),
};

/** Itens do servidor que mudam de nome conforme o idioma; servem de prévia ao vivo. */
const EXEMPLOS = ["Common Bicycle", "Key Fragment", "TM Disk Piece", "Shiny Egg"];

/**
 * Idioma dos nomes dos itens, como no jogo: ao escolher, os nomes mudam na hora, sem recarregar.
 * Vale só neste navegador (fica salvo nele).
 */
export function LanguageSection() {
  const lang = useLang();
  const L = useItemLabel();
  return (
    <section className="space-y-3" aria-labelledby="lang-title">
      <h2 id="lang-title" className="text-lg font-extrabold uppercase tracking-wide">Idioma dos itens</h2>
      <div className="tile space-y-3 p-3 sm:p-4">
        <p className="text-sm text-mute">
          Igual ao jogo: ao trocar, o nome dos itens muda na hora. Afeta casas, bicicletas, fragmentos, ovos e Z-Move; os demais itens têm um nome só.
        </p>
        <div role="radiogroup" aria-label="Idioma dos nomes de itens" className="grid grid-cols-3 gap-2">
          {LANGS.map((l) => {
            const on = l.id === lang;
            return (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setLang(l.id)}
                className={`relative flex min-h-12 items-center justify-center gap-2 rounded-xl border px-2 py-2 text-sm font-bold transition-[border-color,background-color,color] duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-edge ${
                  on ? "border-poke-gold bg-[#2a1e0e] text-poke-gold" : "border-line bg-void text-mute hover:border-edge/70 hover:text-fg"
                }`}
              >
                {FLAGS[l.id]}
                <span className="truncate">{l.nome}</span>
                {on && <Check className="absolute right-1.5 top-1.5 size-3.5" aria-hidden />}
              </button>
            );
          })}
        </div>
        <ul className="flex flex-wrap gap-1.5" aria-label="Prévia dos nomes">
          {EXEMPLOS.map((n) => (
            <li key={n} className="rounded-lg border border-line bg-void px-2.5 py-1 text-sm font-semibold">
              {L(n)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
