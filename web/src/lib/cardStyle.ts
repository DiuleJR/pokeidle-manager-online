import { useSyncExternalStore } from "react";

/** Modelo visual do card de conta no Resumo. */
export type CardStyle = "medalhao" | "versus" | "corrida";

export const CARD_STYLES: { id: CardStyle; label: string }[] = [
  { id: "medalhao", label: "Medalhão" },
  { id: "versus", label: "Versus" },
  { id: "corrida", label: "Corrida" },
];

const KEY = "pim.cardStyle";
const valid = (v: unknown): v is CardStyle => CARD_STYLES.some((s) => s.id === v);

let current: CardStyle = "medalhao";
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
