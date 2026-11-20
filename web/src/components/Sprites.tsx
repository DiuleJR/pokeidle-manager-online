import { useEffect, useState } from "react";
import { useAtlas } from "@/lib/api";
import { call } from "@/lib/admin";

const SITE = "https://pokeidle.io";

function Ball({ size }: { size: number }) {
  return (
    <span
      aria-hidden
      className="inline-block rounded-full border-2 border-edge/70"
      style={{ width: size * 0.6, height: size * 0.6, background: "linear-gradient(#ef6b5b 46%, #16100a 46% 54%, #f4e8cc 54%)" }}
    />
  );
}

/** Retrato do Pokémon (atlas de marcadores do jogo, indexado por looktype). */
/** O brilho do shiny: vai AO LADO do nome, nunca por cima da sprite (que já é pequena). */
export function ShinyMark({ className = "" }: { className?: string }) {
  return (
    <span className={`shrink-0 ${className}`} title="Shiny" aria-label="Shiny">
      ✨
    </span>
  );
}

/** Looktype a desenhar: o da forma shiny quando o Pokémon é shiny e o jogo informou qual é. */
export const lookOf = (p?: { shiny?: boolean; lookShiny?: unknown; looktype?: number | null } | null): number | null | undefined =>
  p?.shiny && typeof p.lookShiny === "number" ? p.lookShiny : p?.looktype;

/** Quadro do Pokémon fora do atlas (formas Mega, shinies): página de textura do jogo + retângulo do quadro. */
interface Outfit {
  image: string;
  pageW: number;
  pageH: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
const outfitDone = new Map<number, Outfit | null>();
const outfitPending = new Map<number, Promise<Outfit | null>>();

function loadOutfit(looktype: number): Promise<Outfit | null> {
  let p = outfitPending.get(looktype);
  if (!p) {
    p = call<Outfit>("GET", `/api/sprite/${looktype}`)
      .catch(() => null)
      .then((o) => {
        outfitDone.set(looktype, o);
        outfitPending.delete(looktype);
        if (!o) setTimeout(() => outfitDone.delete(looktype), 60_000); // falha/ausente: tenta de novo depois
        return o;
      });
    outfitPending.set(looktype, p);
  }
  return p;
}

/** Sprite de outfit do jogo para um looktype que não está no atlas. `enabled` espera o atlas carregar antes de perguntar. */
function useOutfit(looktype: number | null | undefined, enabled: boolean): Outfit | null | undefined {
  const [, force] = useState(0);
  useEffect(() => {
    if (!enabled || looktype == null || outfitDone.has(looktype)) return;
    let live = true;
    void loadOutfit(looktype).then(() => live && force((n) => n + 1));
    return () => {
      live = false;
    };
  }, [looktype, enabled]);
  return enabled && looktype != null ? outfitDone.get(looktype) : undefined;
}

/** Retrato do Pokémon (atlas de marcadores do jogo, indexado por looktype). */
export function PokemonSprite({ looktype, size = 64 }: { looktype?: number | null; size?: number; shiny?: boolean }) {
  const atlas = useAtlas();
  const slot = looktype != null ? atlas?.slots[String(looktype)] : undefined;
  const outfit = useOutfit(looktype, !!atlas && !slot);
  const fit = outfit ? Math.min(size / outfit.w, size / outfit.h) : 1;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      {slot && atlas ? (
        <span
          role="img"
          style={{
            width: size,
            height: size,
            backgroundImage: `url('${atlas.image}')`,
            backgroundSize: `${atlas.cols * size}px ${atlas.rows * size}px`,
            backgroundPosition: `${-slot[0] * size}px ${-slot[1] * size}px`,
            imageRendering: "pixelated",
          }}
        />
      ) : outfit ? (
        <span
          role="img"
          style={{
            width: outfit.w * fit,
            height: outfit.h * fit,
            backgroundImage: `url('${outfit.image}')`,
            backgroundSize: `${outfit.pageW * fit}px ${outfit.pageH * fit}px`,
            backgroundPosition: `${-outfit.x * fit}px ${-outfit.y * fit}px`,
            imageRendering: "pixelated",
          }}
        />
      ) : (
        <Ball size={size} />
      )}
    </span>
  );
}

/** Sprite de item/ball a partir do caminho do site do jogo (ex.: /assets/site/assets/items/x.png). */
export function ItemSprite({ icon, size = 40, alt = "" }: { icon?: string | null; size?: number; alt?: string }) {
  const [failed, setFailed] = useState(false);
  if (!icon || failed)
    return (
      <span
        aria-hidden
        className="inline-flex items-center justify-center rounded border-2 border-dashed border-line text-mute/70"
        style={{ width: size, height: size, fontSize: size * 0.5 }}
      >
        ?
      </span>
    );
  return (
    <img
      src={icon.startsWith("http") ? icon : SITE + icon}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      style={{ width: size, height: size, maxWidth: "100%", maxHeight: "100%", imageRendering: "pixelated", objectFit: "contain" }}
    />
  );
}
