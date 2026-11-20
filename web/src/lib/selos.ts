/**
 * Selos de atributos do Pokémon (P, IV, Q, N), com a mesma régua do jogo: cada um vira um degrau de 1 a 5
 * (cinza, verde, azul, roxo, dourado) conforme o quão raro é o valor. Assim dá para ver de relance se vale a pena.
 */

export const IV_MIN = 6;
export const IV_MAX = 192;
export const NOTA_MERCADO_MIN = 3.5;
const POTENCIA_BONUS = [0, 5, 10, 25, 100];

/** Chance (%) de cada faixa de qualidade no nascimento; as faixas somam 100%. */
const BANDAS_QUALIDADE = [
  { min: 0.8, max: 0.9, chance: 5 },
  { min: 0.9, max: 1.0, chance: 5 },
  { min: 1.0, max: 1.1, chance: 34.03846 },
  { min: 1.1, max: 1.2, chance: 20 },
  { min: 1.2, max: 1.3, chance: 10 },
  { min: 1.3, max: 1.4, chance: 10 },
  { min: 1.4, max: 1.5, chance: 10 },
  { min: 1.5, max: 1.6, chance: 5 },
  { min: 1.7, max: 1.8, chance: 0.67308 },
  { min: 1.8, max: 1.8, chance: 0.28846 },
];
const CORTES_IV = [0.5, 0.7, 0.85, 0.95];
const CORTES_QUALIDADE = [0.44, 0.74, 0.94, 0.99];
const CORTES_NOTA = [NOTA_MERCADO_MIN, 5.5, 7, 8.5];

export type Degrau = 1 | 2 | 3 | 4 | 5;
const degrau = (v: number, cortes: number[]): Degrau => cortes.reduce((n, c) => (v >= c ? n + 1 : n), 1) as Degrau;

/** Fração dos Pokémon que nascem com qualidade igual ou pior (0 a 1). */
export function percentilQualidade(q: number): number {
  const v = Math.min(1.8, Math.max(0.8, q || 0.8));
  let acumulado = 0;
  for (const b of BANDAS_QUALIDADE) {
    if (v < b.min) break;
    if (v >= b.max) {
      acumulado += b.chance;
      continue;
    }
    acumulado += b.chance * ((v - b.min) / (b.max - b.min));
    break;
  }
  return Math.min(1, Math.max(0, acumulado / 100));
}

const dec = (n: number, d: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

export interface Selo {
  key: "p" | "iv" | "q" | "n";
  tier: Degrau;
  text: string;
  title: string;
}

export interface SelosInput {
  potencia?: number | null;
  /** IV somado (6 a 192). */
  iv?: number | null;
  quality?: number | null;
  nota?: number | null;
}

/** Os selos que dá para montar com os dados disponíveis (os ausentes ficam de fora). */
export function selosDe({ potencia, iv, quality, nota }: SelosInput): Selo[] {
  const out: Selo[] = [];
  if (potencia != null && potencia > 0) {
    const p = Math.max(1, Math.min(5, Math.round(potencia)));
    out.push({
      key: "p", tier: p as Degrau, text: `P${p}`,
      title: p === 1 ? "Potência 1: sem bônus nos stats" : `Potência ${p}: +${POTENCIA_BONUS[p - 1]}% em todos os stats`,
    });
  }
  if (iv != null && Number.isFinite(iv)) {
    const v = Math.round(iv);
    const pct = (v - IV_MIN) / (IV_MAX - IV_MIN);
    out.push({ key: "iv", tier: degrau(pct, CORTES_IV), text: `IV ${v}`, title: `IV ${v} de ${IV_MAX} (${Math.round(pct * 100)}% do máximo)` });
  }
  if (quality != null && Number.isFinite(quality) && quality > 0) {
    const pct = percentilQualidade(quality);
    out.push({
      key: "q", tier: degrau(pct, CORTES_QUALIDADE), text: `Q ${dec(quality, 3)}`,
      title: `Qualidade ${dec(quality, 3)}: entre os ${Math.max(1, Math.round((1 - pct) * 100))}% melhores`,
    });
  }
  if (nota != null && Number.isFinite(nota)) {
    out.push({
      key: "n", tier: degrau(nota, CORTES_NOTA), text: `N ${dec(nota, 3)}`,
      title: `Nota ${dec(nota, 3)} de 10 (Mercado a partir de ${dec(NOTA_MERCADO_MIN, 1)})`,
    });
  }
  return out;
}
