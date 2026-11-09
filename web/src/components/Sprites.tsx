import { useState } from "react";
import { useAtlas } from "@/lib/api";

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

/** Retrato do Pokémon (atlas de marcadores do jogo, indexado por looktype). */
export function PokemonSprite({ looktype, size = 64 }: { looktype?: number | null; size?: number; shiny?: boolean }) {
  const atlas = useAtlas();
  const slot = looktype != null ? atlas?.slots[String(looktype)] : undefined;
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
