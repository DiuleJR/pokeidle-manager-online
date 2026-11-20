import { useSyncExternalStore } from "react";

/** Modelo visual do card de conta no Resumo. */
export type CardStyle = "padrao" | "medalhao" | "versus" | "corrida";

export const CARD_STYLES: { id: CardStyle; label: string; desc: string }[] = [
  { id: "padrao", label: "Padrão", desc: "Blocos de números, como sempre foi: XP/h, ouro, gemas, poção e bola." },
  { id: "medalhao", label: "Medalhão", desc: "O Pokémon no centro, com um anel de XP para o treinador e outro para o Pokémon." },
  { id: "versus", label: "Versus", desc: "Dois medidores frente a frente: treinador de um lado, Pokémon do outro." },
  { id: "corrida", label: "Corrida", desc: "Duas pistas de XP até o próximo nível, uma para cada." },
];

const KEY = "pim.cardStyle";
const valid = (v: unknown): v is CardStyle => CARD_STYLES.some((s) => s.id === v);

let current: CardStyle = "padrao";
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
