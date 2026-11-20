import { Check, Info, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { TypeChip } from "@/components/HuntRow";
import { PokemonSprite } from "@/components/Sprites";
import { GRID_COLS, GRID_ROWS, HOUSES, rangeBadge, type RosterRow } from "@/lib/pvpTeam";

const nf = new Intl.NumberFormat("pt-BR");

/** id do Pokémon -> casa do tabuleiro. */
export type Placement = Record<number, number>;

export const rangeLabel = (r: number) => (r > 1 ? `${r} à distância` : "corpo a corpo");
const rangeColor = (r: number) => (r > 1 ? "#2f8a5a" : "#c25a2a");

/**
 * Imagem que acompanha o ponteiro ao arrastar: só o sprite, com o alcance em cima (como no jogo),
 * em vez do cartão inteiro que o navegador usaria por padrão.
 */
const atlasImages = new Map<string, HTMLImageElement>();
const bgUrl = (el: HTMLElement) => /url\(["']?(.*?)["']?\)/.exec(el.style.backgroundImage)?.[1] ?? null;

/** Carrega o atlas de retratos antes do primeiro arrasto: o navegador só captura a imagem do arrasto na hora, sem esperar. */
export function warmAtlas(root: ParentNode | null) {
  const el = root?.querySelector<HTMLElement>('[role="img"]');
  const url = el ? bgUrl(el) : null;
  if (url && !atlasImages.has(url)) {
    const img = new Image();
    img.src = url;
    atlasImages.set(url, img);
  }
}

/**
 * Imagem que acompanha o ponteiro ao arrastar: só o sprite, com o alcance em cima (como no jogo), em vez do
 * cartão inteiro. É desenhada num canvas porque o navegador captura o arrasto na hora e um fundo CSS recém-criado
 * ainda não foi pintado (saía só o selo, sem o Pokémon).
 */
function setDragGhost(e: React.DragEvent, root: HTMLElement | null, range: number) {
  const k = 1.6;
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
  const label = rangeLabel(range).toUpperCase();
  const font = "800 10px Outfit, system-ui, sans-serif";
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) return;
  measure.font = font;
  const pillW = Math.ceil(measure.measureText(label).width) + 18;
  const sprite = root?.querySelector<HTMLElement>('[role="img"]') ?? null;
  const size = sprite ? parseInt(sprite.style.width, 10) || 48 : 0;
  const box = size * k;
  const W = Math.max(pillW, box, 40);
  const H = 16 + 4 + box;
  const c = document.createElement("canvas");
  c.width = W * dpr;
  c.height = H * dpr;
  c.style.cssText = `position:fixed;left:-${W + 50}px;top:0;width:${W}px;height:${H}px;pointer-events:none;`;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = rangeColor(range);
  ctx.beginPath();
  ctx.roundRect((W - pillW) / 2, 0, pillW, 16, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.45)";
  ctx.stroke();
  ctx.font = font;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, W / 2, 8.5);
  const url = sprite ? bgUrl(sprite) : null;
  const img = url ? atlasImages.get(url) : undefined;
  if (sprite && img?.complete && img.naturalWidth) {
    const [bw, bh] = sprite.style.backgroundSize.split(" ").map((v) => parseFloat(v));
    const [px, py] = sprite.style.backgroundPosition.split(" ").map((v) => parseFloat(v));
    const cols = bw / size;
    const rows = bh / size;
    const cw = img.naturalWidth / cols;
    const ch = img.naturalHeight / rows;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, (-px / size) * cw, (-py / size) * ch, cw, ch, (W - box) / 2, 20, box, box);
  }
  document.body.appendChild(c);
  e.dataTransfer.setDragImage(c, W / 2, H - 8);
  setTimeout(() => c.remove(), 0);
}

export function RangePill({ range, className = "" }: { range: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-black/40 px-2 py-0.5 text-[10px] font-extrabold uppercase leading-none tracking-wide text-white ${className}`} style={{ background: rangeColor(range) }}>
      {rangeBadge(range)} {rangeLabel(range)}
    </span>
  );
}

function useSmall() {
  const [small, set] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(max-width: 639px)").matches);
  useEffect(() => {
    const m = matchMedia("(max-width: 639px)");
    const on = () => set(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return small;
}

export function Board({
  ids,
  placement,
  members,
  selected,
  onTileClick,
  onDropTile,
  onRemove,
  onInfo,
}: {
  ids: number[];
  placement: Placement;
  members: Map<number, RosterRow>;
  selected: number | null;
  onTileClick: (house: number) => void;
  onDropTile: (house: number, payload: string) => void;
  onRemove: (id: number) => void;
  onInfo: (id: number) => void;
}) {
  const small = useSmall();
  const occupant = useMemo(() => {
    const m = new Map<number, number>();
    for (const id of ids) if (placement[id] != null) m.set(placement[id], id);
    return m;
  }, [ids, placement]);
  const [over, setOver] = useState<number | null>(null);
  useEffect(() => {
    warmAtlas(document);
    const t = setTimeout(() => warmAtlas(document), 1200);   // a lista carrega depois; o atlas já está no cache do navegador
    return () => clearTimeout(t);
  }, [ids]);
  return (
    <div
      className="relative flex flex-col items-center justify-center overflow-hidden rounded-xl border border-line p-2 sm:p-3 lg:h-full"
      style={{ background: "repeating-linear-gradient(90deg, rgba(0,0,0,.10) 0 2px, transparent 2px 46px), linear-gradient(180deg,#8a5a2c,#6b4420)" }}
    >
      <div className="pointer-events-none absolute left-1/2 top-[-9%] aspect-square w-[56%] -translate-x-1/2 rounded-full border-4 border-black/25" style={{ background: "radial-gradient(circle, rgba(150,40,40,.38), rgba(90,25,25,.38))" }} aria-hidden />
      <div className="relative z-10 mb-2 rounded-full border border-black/40 bg-[#2a1210]/80 px-4 py-0.5 text-center text-[10px] font-extrabold uppercase tracking-wider text-[#f4d7cc]">Lado do adversário</div>
      <div className="relative z-10 grid w-full gap-1" style={{ maxWidth: "min(100%, calc((100dvh - 24rem) * 1.5))", gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${GRID_ROWS}, auto)` }}>
        {HOUSES.map((h) => {
          const id = occupant.get(h.house);
          const m = id != null ? members.get(id) : undefined;
          const isSel = id != null && id === selected;
          const lit = over === h.house;
          return (
            <div
              key={h.house}
              style={{ gridRow: h.row + 1, gridColumn: h.col + 1 }}
              role="button"
              tabIndex={0}
              aria-label={m ? `${m.name}, casa ${h.house + 1}` : `Casa vazia ${h.house + 1}`}
              onClick={() => onTileClick(h.house)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onTileClick(h.house))}
              onDragOver={(e) => { e.preventDefault(); setOver(h.house); }}
              onDragLeave={() => setOver((o) => (o === h.house ? null : o))}
              onDrop={(e) => { e.preventDefault(); setOver(null); const t = e.dataTransfer.getData("text/plain"); if (t) onDropTile(h.house, t); }}
              className="relative aspect-square rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[#f3c04a]"
            >
              <span className="absolute inset-0 rounded-md border" style={{ background: lit ? "rgba(255,255,255,.42)" : isSel ? "rgba(255,230,140,.38)" : "rgba(255,255,255,.16)", borderColor: isSel ? "#f3c04a" : lit ? "#fff" : "rgba(255,255,255,.38)", boxShadow: isSel ? "0 0 0 2px #f3c04a" : undefined }} />
              {m && id != null && (
                <span
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData("text/plain", `tile:${id}`); e.dataTransfer.effectAllowed = "move"; setDragGhost(e, e.currentTarget, m.range); }}
                  className="absolute inset-0 flex cursor-grab flex-col items-center justify-center active:cursor-grabbing"
                >
                  <span className="pointer-events-none"><PokemonSprite looktype={m.looktype} size={small ? 34 : 52} /></span>
                  <span className="pointer-events-none absolute bottom-0 left-0.5 rounded bg-black/50 px-0.5 text-[10px] leading-tight" aria-hidden>{rangeBadge(m.range)}</span>
                </span>
              )}
              {m && id != null && (
                <>
                  <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(id); }} aria-label={`Tirar ${m.name} da equipe`} className="absolute -right-1 -top-1 z-10 hidden size-4 items-center sm:flex justify-center rounded-full bg-poke-red text-white shadow"><X className="size-3" aria-hidden /></button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); onInfo(id); }} aria-label={`Ficha de ${m.name}`} className="absolute -left-1 -top-1 z-10 hidden size-4 items-center sm:flex justify-center rounded-full bg-[#5a2f8f] text-white shadow"><Info className="size-3" aria-hidden /></button>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="relative z-10 mt-2 rounded-full bg-black/35 px-3 py-0.5 text-center text-[10px] font-bold uppercase tracking-wider text-[#f4e8cc]">Seu lado</div>
    </div>
  );
}

export function RosterCard({ r, picked, onToggle, onInfo }: { r: RosterRow; picked: boolean; onToggle: () => void; onInfo: () => void }) {
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", `pk:${r.id}`); e.dataTransfer.effectAllowed = "copyMove"; setDragGhost(e, e.currentTarget, r.range); }}
      role="button"
      tabIndex={0}
      aria-pressed={picked}
      onClick={onToggle}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onToggle())}
      className={`relative flex cursor-pointer gap-2 rounded-xl border-2 p-2 text-left transition-colors duration-150 ${picked ? "bg-[#1d2740]" : "bg-[#2a1b2e]/60 hover:bg-[#33223a]"}`}
      style={{ borderColor: picked ? "#4a8fd0" : r.shiny ? "#a06a2a" : "#4a2a3a" }}
    >
      {picked && <span className="absolute -left-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-[#4a8fd0] text-white"><Check className="size-3.5" aria-hidden /></span>}
      <span className="pointer-events-none"><PokemonSprite looktype={r.looktype} size={48} /></span>
      <div className="pointer-events-none min-w-0 flex-1">
        <div className="truncate text-sm font-extrabold">{r.shiny ? "✨ " : ""}{r.name}</div>
        <div className="tnum truncate text-[11px] text-mute">Nv {nf.format(r.level)} · {r.inTeam ? "equipe" : r.hunting ? "hunt" : "coleção"} · {rangeBadge(r.range)}</div>
        <div className="tnum text-xs font-extrabold text-poke-gold">⚔ {nf.format(r.pvpPower)}</div>
        <div className="mt-0.5 flex flex-wrap gap-1">{r.types.map((t) => <TypeChip key={t} type={t} />)}</div>
      </div>
      <button type="button" onClick={(e) => { e.stopPropagation(); onInfo(); }} aria-label={`Ficha de ${r.name}`} className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-[#5a2f8f] text-white hover:bg-[#6d3aa8]"><Info className="size-3.5" aria-hidden /></button>
    </div>
  );
}
