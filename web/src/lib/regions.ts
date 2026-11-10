import type { Hunt } from "./actions";

/** As regiões do mapa, na ordem e com os níveis do jogo. `area` é o campo `area` da hunt; `ger` a geração da espécie. */
export interface Region {
  id: string;
  label: string;
  area: "kanto" | "outland" | "orre";
  ger: string | null;
  nivel: number;
}
export const REGIONS: Region[] = [
  { id: "kanto", label: "Kanto", area: "kanto", ger: "kanto", nivel: 1 },
  { id: "outland", label: "Outland", area: "outland", ger: null, nivel: 150 },
  { id: "johto", label: "Johto", area: "kanto", ger: "johto", nivel: 200 },
  { id: "hoenn", label: "Hoenn", area: "orre", ger: "hoenn", nivel: 500 },
  { id: "sinnoh", label: "Sinnoh", area: "orre", ger: "sinnoh", nivel: 1000 },
  { id: "unova", label: "Unova", area: "orre", ger: "unova", nivel: 5000 },
  { id: "kalos", label: "Kalos", area: "orre", ger: "kalos", nivel: 10000 },
  { id: "alola", label: "Alola", area: "orre", ger: "alola", nivel: 25000 },
  { id: "galar", label: "Galar", area: "orre", ger: "galar", nivel: 40000 },
  { id: "paldea", label: "Paldea", area: "orre", ger: "paldea", nivel: 75000 },
];

const GENERATIONS: [number, number, string][] = [
  [1, 151, "kanto"], [152, 251, "johto"], [252, 386, "hoenn"], [387, 493, "sinnoh"], [494, 649, "unova"],
  [650, 721, "kalos"], [722, 809, "alola"], [810, 905, "galar"], [906, 1025, "paldea"],
];

/** Número da Pokédex nacional por trás do pokeId (clones de Orre são 13000 + dex; Outland, megas e formas ficam de fora). */
function dexOf(pokeId: number): number | null {
  if (pokeId <= 1025) return pokeId;
  if (pokeId >= 13000 && pokeId < 14000) return pokeId - 13000;
  if (pokeId >= 2000 && pokeId < 13000) return null;
  return pokeId % 1000;
}

/** A geração que manda na hunt: a das espécies com mais pontos de spawn. */
function generationOf(h: Hunt): string | null {
  const weight = new Map<string, number>();
  for (const e of h.especies) {
    const dex = dexOf(e.pokeId);
    const g = dex == null ? undefined : GENERATIONS.find(([a, b]) => dex >= a && dex <= b)?.[2];
    if (g) weight.set(g, (weight.get(g) ?? 0) + (e.pontos || 1));
  }
  let best: string | null = null;
  let max = -1;
  for (const [g, n] of weight) if (n > max) [best, max] = [g, n];
  return best;
}

/** A hunt pertence à aba? Mesma regra do jogo: `regiao` declarada manda; senão vale área + geração. */
export function inRegion(h: Hunt, reg: Region): boolean {
  if (h.regiao) return h.regiao === reg.id;
  if (reg.ger == null) return h.area === reg.area;
  return h.area === reg.area && generationOf(h) === reg.ger;
}

export const regionOfHunt = (h: Hunt | undefined): Region | undefined => (h ? REGIONS.find((r) => inRegion(h, r)) : undefined);
