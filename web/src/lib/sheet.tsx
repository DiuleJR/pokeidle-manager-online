import { AnimatePresence } from "framer-motion";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PokemonSheet, type SheetSource } from "@/components/PokemonSheet";

/**
 * Abre a ficha completa do Pokémon (e da espécie) de qualquer tela: inventário, mercado, chat.
 * `from` é o elemento clicado: se ele estiver na janela destacada do chat, a ficha abre lá e não na janela principal.
 */
type OpenSheet = (source: SheetSource, from?: Element | null) => void;

const Ctx = createContext<OpenSheet>(() => {});
export const useSheet = () => useContext(Ctx);

/** Conta do painel ("acc-1", "1"...) -> número da conta no servidor. */
export const accountNumber = (id: string | number) => Number(String(id).replace(/\D/g, ""));

export function SheetProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<SheetSource | null>(null);
  const [doc, setDoc] = useState<Document>(document);
  const open = useCallback<OpenSheet>((s, from) => {
    setDoc(from?.ownerDocument ?? document);
    setSource(s);
  }, []);
  return (
    <Ctx.Provider value={open}>
      {children}
      {createPortal(<AnimatePresence>{source && <PokemonSheet source={source} onClose={() => setSource(null)} />}</AnimatePresence>, doc.body)}
    </Ctx.Provider>
  );
}

/** Props de acessibilidade/teclado para um elemento que não é `<button>` mas abre a ficha ao clicar. */
export const sheetTrigger = (open: (el: Element) => void) => ({
  role: "button" as const,
  tabIndex: 0,
  onClick: (e: React.MouseEvent) => open(e.currentTarget),
  onKeyDown: (e: React.KeyboardEvent) => {
    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      open(e.currentTarget);
    }
  },
});
