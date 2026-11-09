/** Tabela de efetividade dos tipos (a mesma usada pelo jogo, conferida com a tela Mapa dele). */
export const TYPES = [
  "NORMAL", "FIRE", "WATER", "ELECTRIC", "GRASS", "ICE", "FIGHTING", "POISON", "GROUND",
  "FLYING", "PSYCHIC", "BUG", "ROCK", "GHOST", "DRAGON", "DARK", "STEEL", "FAIRY",
] as const;
export type PType = (typeof TYPES)[number];

// atacante -> [forte contra, fraco contra, sem efeito em]
const CHART: Record<PType, [PType[], PType[], PType[]]> = {
  NORMAL: [[], ["ROCK", "STEEL"], ["GHOST"]],
  FIRE: [["GRASS", "ICE", "BUG", "STEEL"], ["FIRE", "WATER", "ROCK", "DRAGON"], []],
  WATER: [["FIRE", "GROUND", "ROCK"], ["WATER", "GRASS", "DRAGON"], []],
  ELECTRIC: [["WATER", "FLYING"], ["ELECTRIC", "GRASS", "DRAGON"], ["GROUND"]],
  GRASS: [["WATER", "GROUND", "ROCK"], ["FIRE", "GRASS", "POISON", "FLYING", "BUG", "DRAGON", "STEEL"], []],
  ICE: [["GRASS", "GROUND", "FLYING", "DRAGON"], ["FIRE", "WATER", "ICE", "STEEL"], []],
  FIGHTING: [["NORMAL", "ICE", "ROCK", "DARK", "STEEL"], ["POISON", "FLYING", "PSYCHIC", "BUG", "FAIRY"], ["GHOST"]],
  POISON: [["GRASS", "FAIRY"], ["POISON", "GROUND", "ROCK", "GHOST"], ["STEEL"]],
  GROUND: [["FIRE", "ELECTRIC", "POISON", "ROCK", "STEEL"], ["GRASS", "BUG"], ["FLYING"]],
  FLYING: [["GRASS", "FIGHTING", "BUG"], ["ELECTRIC", "ROCK", "STEEL"], []],
  PSYCHIC: [["FIGHTING", "POISON"], ["PSYCHIC", "STEEL"], ["DARK"]],
  BUG: [["GRASS", "PSYCHIC", "DARK"], ["FIRE", "FIGHTING", "POISON", "FLYING", "GHOST", "STEEL", "FAIRY"], []],
  ROCK: [["FIRE", "ICE", "FLYING", "BUG"], ["FIGHTING", "GROUND", "STEEL"], []],
  GHOST: [["PSYCHIC", "GHOST"], ["DARK"], ["NORMAL"]],
  DRAGON: [["DRAGON"], ["STEEL"], ["FAIRY"]],
  DARK: [["PSYCHIC", "GHOST"], ["FIGHTING", "DARK", "FAIRY"], []],
  STEEL: [["ICE", "ROCK", "FAIRY"], ["FIRE", "WATER", "ELECTRIC", "STEEL"], []],
  FAIRY: [["FIGHTING", "DRAGON", "DARK"], ["FIRE", "POISON", "STEEL"], []],
};

/** Multiplicador de um golpe do tipo `atk` contra um defensor de 1 ou 2 tipos. */
export function effectiveness(atk: string, defTypes: string[]): number {
  const row = CHART[atk as PType];
  if (!row) return 1;
  let m = 1;
  for (const d of defTypes) {
    if (row[2].includes(d as PType)) return 0;
    if (row[0].includes(d as PType)) m *= 2;
    else if (row[1].includes(d as PType)) m *= 0.5;
  }
  return m;
}

/** Fraquezas (×2 ou ×4) e resistências (×0,5, ×0,25 ou imunidade) de um defensor. */
export function matchup(defTypes: string[]) {
  const weak: { type: PType; mult: number }[] = [];
  const resist: { type: PType; mult: number }[] = [];
  for (const t of TYPES) {
    const m = effectiveness(t, defTypes);
    if (m > 1) weak.push({ type: t, mult: m });
    else if (m < 1) resist.push({ type: t, mult: m });
  }
  return { weak, resist };
}

/** Cores dos selos de tipo (as da tela do jogo). */
export const TYPE_COLOR: Record<string, string> = {
  NORMAL: "#8a8a6a", FIRE: "#e8622a", WATER: "#4a7fd6", ELECTRIC: "#d8b21a", GRASS: "#5aa83a", ICE: "#4fb4c2",
  FIGHTING: "#a8321e", POISON: "#8e3d9a", GROUND: "#b89a3e", FLYING: "#7d96dc", PSYCHIC: "#d8426a", BUG: "#8fa81c",
  ROCK: "#a08a3a", GHOST: "#5a4a8c", DRAGON: "#5a3ad0", DARK: "#4a3d36", STEEL: "#7a7a8e", FAIRY: "#d884b8",
};
