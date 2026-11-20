import { useSyncExternalStore } from "react";

/** Modelo visual do card de conta no Resumo. */
export type CardStyle = "barras" | "aneis" | "painel";

export const CARD_STYLES: { id: CardStyle; label: string }[] = [
  { id: "barras", label: "Barras" },
  { id: "aneis", label: "Anéis" },
  { id: "painel", label: "Painel" },
];

const KEY = "pim.cardStyle";
const valid = (v: unknown): v is CardStyle => CARD_STYLES.some((s) => s.id === v);

let current: CardStyle = "barras";
try {
  const saved = localStorage.getItem(KEY);
  if (valid(saved)) current = saved;
} catch {
  /* sem armazenamento: fica no padrão */
}

const subs = new Set<() => void>();

export function setCardStyle(v: CardStyle) {
  if (v === current) return;
  current = v;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* ignora */
  }
  subs.forEach((f) => f());
}

export const useCardStyle = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => current,
  );
