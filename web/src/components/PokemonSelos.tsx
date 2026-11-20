import { selosDe, type SelosInput } from "@/lib/selos";

/** Soma dos IVs quando a ficha só traz o valor de cada stat. */
const ivSoma = (ivs?: Record<string, number> | null) => (ivs ? Object.values(ivs).reduce((s, v) => s + (Number(v) || 0), 0) : null);

/** Dados em qualquer um dos formatos que o painel recebe: ficha do jogo, linha do inventário, linha do PVP. */
export interface SelosFonte {
  potencia?: number | null;
  potency?: number | null;
  ivTotal?: number | null;
  ivs?: Record<string, number> | null;
  quality?: number | null;
  nota?: number | null;
  grade?: number | null;
}

export function selosDaFonte(p: SelosFonte | null | undefined): SelosInput {
  return {
    potencia: p?.potencia ?? p?.potency ?? null,
    iv: p?.ivTotal ?? ivSoma(p?.ivs),
    quality: p?.quality ?? null,
    nota: p?.nota ?? p?.grade ?? null,
  };
}

/**
 * Selos P / IV / Q / N coloridos pelo quão bom é cada atributo (cinza, verde, azul, roxo, dourado), como no jogo.
 * `compact` reduz o tamanho para cartões apertados.
 */
export function PokemonSelos({ pk, compact = false, className = "" }: { pk: SelosFonte | null | undefined; compact?: boolean; className?: string }) {
  const selos = selosDe(selosDaFonte(pk));
  if (!selos.length) return null;
  return (
    <span className={`flex flex-wrap items-center ${compact ? "gap-1" : "gap-1.5"} ${className}`}>
      {selos.map((s) => (
        <span key={s.key} className={`selo t${s.tier} ${compact ? "selo-sm" : ""}`} title={s.title} aria-label={s.title}>
          {s.text}
        </span>
      ))}
    </span>
  );
}
