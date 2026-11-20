import { AnimatePresence, motion, useDragControls, type PanInfo } from "framer-motion";
import { ChevronDown, Clock, Crosshair, Crown, MapPin, Swords } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { ItemSprite, PokemonSprite, ShinyMark } from "@/components/Sprites";
import { EquipPopover } from "@/components/EquipPopover";
import { StatusPill } from "@/components/StatusPill";
import { XpMedallion, XpRace, XpVersus } from "@/components/XpMeters";
import { AnimatedNumber, Coin, GoldPerHourIcon } from "@/components/ui";
import { serverNow, useAccount } from "@/lib/telemetry";
import type { EquippedItem } from "@/lib/types";
import { type CardStyle, useCardStyle } from "@/lib/cardStyle";
import { dragState, justDragged } from "@/lib/useCardOrder";
import { fmtDuration, fmtShort } from "@/lib/utils";
import type { MapInfo } from "@/lib/types";

export type CardMode = "resumo" | "sessao";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Cronômetro HH:MM:SS desde o início da sessão (relógio do servidor). */
function SessionClock({ startedAt }: { startedAt: number | null | undefined }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, []);
  if (!startedAt) return <span>—</span>;
  const s = Math.max(0, Math.floor((serverNow() - startedAt) / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="tnum">
      {p(Math.floor(s / 3600))}:{p(Math.floor((s % 3600) / 60))}:{p(s % 60)}
    </span>
  );
}

// Itens raros acompanhados na sessão (ícones do próprio jogo).
// Rótulos iguais aos usados no backend (session_stats.ITEM_LABELS) e no webhook do Discord.
const SESSION_ITEMS = [
  { key: "boss", label: "Bronze Boss Token", icon: "/assets/site/assets/items/bronze_boss_token.png" },
  { key: "key", label: "Fragmento de Chave", icon: "/img/itens/fragmento-chave.png" },
  { key: "shinyStone", label: "Fragmento de Shiny Stone", icon: "/img/itens/shiny-stone.png" },
  { key: "bike", label: "Fragmento de Bicicleta", icon: "/img/itens/fragmento-bicicleta.png" },
] as const;

const prettySlug = (s?: string | null) =>
  s ? s.replace(/[_-]+/g, " ").replace(/(^|\s)[a-z]/g, (c) => c.toUpperCase()) : "—";

/**
 * Bloco ícone + valor. Celular: uma linha compacta (ícone e valor, sem rótulo).
 * Desktop (sm+): ícone grande à esquerda, rótulo e valor empilhados.
 */
function Tile({
  icon,
  label,
  hint,
  children,
  className = "",
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
  /** Torna o bloco clicável (abre o seletor). Recebe o próprio elemento para ancorar o popover. */
  onPress?: (el: HTMLElement) => void;
}) {
  const press = onPress
    ? {
        role: "button" as const,
        tabIndex: 0,
        "aria-haspopup": "dialog" as const,
        onClick: (e: React.MouseEvent<HTMLElement>) => !justDragged() && onPress(e.currentTarget),
        onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPress(e.currentTarget);
          }
        },
      }
    : {};
  return (
    <motion.div
      title={hint ?? label}
      whileHover={{ y: -2, transition: { duration: 0.18, ease: EASE } }}
      whileTap={onPress ? { scale: 0.98 } : undefined}
      {...press}
      className={`${onPress ? "cursor-pointer hover:!border-edge " : ""}tile flex min-w-0 items-center gap-1.5 px-2 py-1.5 sm:grid sm:grid-cols-[auto_1fr] sm:grid-rows-[auto_auto] sm:gap-x-3 sm:gap-y-0.5 sm:px-3 sm:py-1.5 ${className}`}
    >
      <span className="flex size-5 shrink-0 items-center justify-center sm:row-span-2 sm:size-9">{icon}</span>
      <div className="label hidden sm:block">{label}</div>
      <div className="min-w-0 truncate text-sm font-bold leading-tight sm:text-lg">{children}</div>
    </motion.div>
  );
}

/** Mapa onde a conta caça. Em Outland mostra o nível dela e o multiplicador de itens raros (como no jogo). */
function MapChip({ map }: { map?: MapInfo | null }) {
  if (!map) return null;
  const o = map.outland;
  return (
    <span
      className={`inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-bold leading-none sm:text-sm ${o ? "border-[#7a5a1c] bg-[#33260e] text-poke-gold" : "border-line bg-void text-fg"}`}
      title={o ? `${map.label}: itens raros ×${o.mult}` : `Mapa: ${map.label}`}
    >
      <MapPin className="size-3.5 shrink-0 sm:size-4" aria-hidden />
      <span className="truncate">{map.label}</span>
      {o && <span className="tnum font-semibold opacity-80">×{String(o.mult).replace(".", ",")}</span>}
    </span>
  );
}

/** Bloco de número: ícone, rótulo e valor, sem moldura própria. */
function Stat({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex size-6 shrink-0 items-center justify-center sm:size-7">{icon}</span>
      <div className="min-w-0">
        <div className="text-[11px] font-medium leading-none text-mute sm:text-xs">{label}</div>
        <div className="mt-0.5 truncate text-sm font-bold leading-tight sm:text-base">{children}</div>
      </div>
    </div>
  );
}

/** Poção ou bola equipada como botão compacto; ao tocar abre o seletor para trocar. */
function EquipChip({ item, label, onPress, block = false }: { item?: EquippedItem | null; label: string; onPress?: (el: HTMLElement) => void; block?: boolean }) {
  return (
    <button
      type="button"
      disabled={!onPress}
      aria-haspopup="dialog"
      aria-label={item ? `${label}: ${item.name}, ${item.qty} unidades. Trocar` : `Escolher ${label.toLowerCase()}`}
      title={item ? `${label}: ${item.name}. Toque para trocar` : `Escolher ${label.toLowerCase()}`}
      onClick={(e) => !justDragged() && onPress?.(e.currentTarget)}
      className={`inline-flex min-h-10 min-w-0 items-center gap-1.5 rounded-full border border-line bg-tile py-1 pl-1.5 pr-2.5 text-sm font-bold transition-colors enabled:hover:border-edge enabled:active:scale-[.98] disabled:cursor-default ${block ? "w-full" : ""}`}
    >
      <ItemSprite icon={item?.icon} size={26} alt="" />
      {item ? (
        <>
          <span className="hidden min-w-0 truncate sm:inline">{item.name}</span>
          <span className="tnum shrink-0 text-mute sm:text-fg">×<AnimatedNumber value={item.qty} /></span>
        </>
      ) : (
        <span className="text-mute">—</span>
      )}
      {onPress && <ChevronDown className="ml-auto hidden size-3.5 shrink-0 text-mute min-[360px]:block" aria-hidden />}
    </button>
  );
}

function ResumoBody({ id, variant }: { id: string; variant: CardStyle }) {
  const acc = useAccount(id);
  const [picker, setPicker] = useState<{ kind: "ball" | "potion"; anchor: DOMRect } | null>(null);
  if (!acc) return null;
  const potion = acc.equipped?.potion;
  const ball = acc.equipped?.ball;
  const options = acc.equipped?.options;
  // Abates por hora da hunt atual (só depois de 1 minuto, para o número não oscilar no começo).
  const killsPerHour = acc.hunt && acc.hunt.minutes >= 1 ? Math.round(acc.hunt.kills / (acc.hunt.minutes / 60)) : null;
  const open = (kind: "ball" | "potion") => (el: HTMLElement) => setPicker({ kind, anchor: el.getBoundingClientRect() });
  const pk = acc.pokemon;
  const trainer = { level: acc.level, bar: acc.xp, perHour: acc.xpPerHour };
  const mon = { level: pk?.level, bar: pk?.xp, name: pk?.name, fallbackPerHour: acc.xpPerHour };

  const xpHour = (
    <span className="text-poke-green">
      +<AnimatedNumber value={acc.xpPerHour} />
    </span>
  );
  const unitHour = <span className="text-xs font-semibold text-mute"> /h</span>;
  const stats = (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-[10px] border border-line bg-tile px-3 py-2.5 sm:grid-cols-4">
      <Stat icon={<Coin kind="gold" />} label="Gold"><AnimatedNumber value={acc.gold} /></Stat>
      <Stat icon={<Coin kind="gem" />} label="Gemas"><AnimatedNumber value={acc.gems} /></Stat>
      <Stat icon={<GoldPerHourIcon />} label="Ouro por hora">
        <span className="text-poke-gold">+<AnimatedNumber value={acc.goldPerHour} /></span>
        {unitHour}
      </Stat>
      <Stat icon={<Swords className="size-full text-fg" />} label="Abates por hora">
        {killsPerHour == null ? "—" : <AnimatedNumber value={killsPerHour} />}
        {unitHour}
      </Stat>
    </div>
  );
  const chips = (
    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
      <EquipChip item={potion} label="Poção equipada" onPress={options ? open("potion") : undefined} />
      <EquipChip item={ball} label="Bola equipada" onPress={options ? open("ball") : undefined} />
    </div>
  );
  const xpRow = (
    <div className="mb-3 flex items-center justify-between gap-2 text-sm">
      <span className="font-semibold text-mute">XP por hora</span>
      <span className="font-extrabold">{xpHour}</span>
    </div>
  );
  const popover = (
    <AnimatePresence>
      {picker && options && (
        <EquipPopover
          key={picker.kind}
          kind={picker.kind}
          accId={id}
          options={options[picker.kind]}
          selectedId={(picker.kind === "ball" ? ball : potion)?.id}
          anchor={picker.anchor}
          onClose={() => setPicker(null)}
        />
      )}
    </AnimatePresence>
  );

  // ---------------------------------------------------------------- Medalhão
  if (variant === "medalhao") {
    return (
      <div className="space-y-2 sm:space-y-2.5">
        <div className="tile px-3 py-3 sm:px-5 sm:py-4">
          {xpRow}
          <XpMedallion trainer={trainer} mon={mon} sprite={<PokemonSprite looktype={pk?.looktype} size={64} />} />
        </div>
        {stats}
        {chips}
        {popover}
      </div>
    );
  }

  // ---------------------------------------------------------------- Versus
  if (variant === "versus") {
    return (
      <div className="space-y-2 sm:space-y-2.5">
        <div className="tile px-2.5 py-3 sm:px-4 sm:py-4">
          {xpRow}
          <XpVersus trainer={trainer} mon={mon}>
            <div className="flex justify-center">
              <div className="flex size-14 items-center justify-center rounded-full border-2 border-edge sm:size-20" style={{ background: "radial-gradient(circle at 50% 35%, #4a3519, #1a120a 75%)" }}>
                <span className="origin-center scale-[.8] sm:scale-110"><PokemonSprite looktype={pk?.looktype} size={52} /></span>
              </div>
            </div>
          </XpVersus>
        </div>
        {stats}
        {chips}
        {popover}
      </div>
    );
  }

  // ---------------------------------------------------------------- Corrida
  return (
    <div className="space-y-2 sm:space-y-2.5">
      <div className="tile px-3 py-3 sm:px-4">
        {xpRow}
        <XpRace
          trainer={trainer}
          mon={mon}
          trainerRunner={<Crown className="size-5 text-poke-gold" aria-hidden />}
          monRunner={<span className="origin-center scale-[.55]"><PokemonSprite looktype={pk?.looktype} size={52} /></span>}
        />
      </div>
      {stats}
      {chips}
      {popover}
    </div>
  );
}

function SessaoBody({ id }: { id: string }) {
  const acc = useAccount(id);
  if (!acc) return null;
  // Outland só dropa itens raros e as outras áreas só têm shinies: mostra o que faz sentido para a hunt atual.
  // O que já rendeu na sessão continua aparecendo, mesmo ao trocar de área, até zerar a sessão.
  const sh = acc.session?.shinies;
  const outland = acc.session?.outland ?? null;
  const showShinies = !!sh && (outland === false || sh.seen + sh.captured > 0);
  const showItems = outland !== false || SESSION_ITEMS.some((it) => (acc.session?.items[it.key] ?? 0) > 0);
  return (
    <div className="space-y-1.5 sm:space-y-2.5">
      <Tile icon={<Clock className="size-full text-poke-gold" />} label="Tempo da sessão" className="tile-gold">
        <span className="text-xl font-extrabold leading-none text-fg sm:text-3xl">
          <SessionClock startedAt={acc.session?.startedAt} />
        </span>
      </Tile>
      {showShinies && sh && (
        <div className="grid grid-cols-2 gap-1.5 sm:gap-2.5">
          <Tile icon={<span className="text-2xl">✨</span>} label="Shinies vistos">
            <span className="font-extrabold sm:text-2xl"><AnimatedNumber value={sh.seen} /></span>
          </Tile>
          <Tile icon={<span className="text-2xl">✨</span>} label="Shinies capturados">
            <span className="font-extrabold sm:text-2xl"><AnimatedNumber value={sh.captured} /></span>
          </Tile>
        </div>
      )}
      {showItems && (
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-2 sm:gap-2.5">
        {SESSION_ITEMS.map((it) => (
          <Tile key={it.key} icon={<ItemSprite icon={it.icon} size={32} alt={it.label} />} label={it.label}>
            <span className="font-extrabold sm:text-2xl">
              <AnimatedNumber value={acc.session?.items[it.key] ?? 0} />
            </span>
          </Tile>
        ))}
        </div>
      )}
    </div>
  );
}

/** Arrastar para trocar de lugar: `canDrag` só no computador; `onDragOver` recebe o ponto do ponteiro. */
export interface CardDrag {
  canDrag: boolean;
  onDragOver: (id: string, point: { x: number; y: number }) => void;
}

const HOLD_MS = 380; // quanto tempo segurar o card no celular para "levantar" e poder arrastar
const HOLD_SLOP = 10; // se o dedo andar mais que isso antes, é rolagem e não segurar
const SCROLL_EDGE = 84; // faixa junto à borda da tela que rola a página durante o arrasto

function AccountCardImpl({ id, mode, index = 0, drag }: { id: string; mode: CardMode; index?: number; drag?: CardDrag }) {
  const acc = useAccount(id);
  const cardStyle = useCardStyle();
  const controls = useDragControls();
  const [lifted, setLifted] = useState(false);
  const liftedRef = useRef(false);
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);
  const ptr = useRef({ x: 0, y: 0 }); // posição do dedo na tela durante o arrasto
  // Celular/tablet (sem mouse): segurar o card levanta e libera o arrasto; o toque normal continua rolando a página.
  const touchMode = !!drag && !drag.canDrag;

  const clearHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };
  const drop = () => {
    clearHold();
    if (liftedRef.current) {
      liftedRef.current = false;
      setLifted(false);
    }
  };
  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (!touchMode || e.pointerType !== "touch" || (e.target as HTMLElement).closest("a,input,select,textarea")) return;
    const native = e.nativeEvent;
    clearHold();
    hold.current = {
      x: e.clientX,
      y: e.clientY,
      timer: window.setTimeout(() => {
        hold.current = null;
        liftedRef.current = true;
        ptr.current = { x: native.clientX, y: native.clientY };
        setLifted(true);
        navigator.vibrate?.(18);
        controls.start(native);
      }, HOLD_MS),
    };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const h = hold.current;
    if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > HOLD_SLOP) clearHold(); // o dedo andou: é rolagem
  };

  // Com o card levantado, o toque não pode rolar a página (o cancelável só vale antes de a rolagem começar).
  useEffect(() => {
    if (!touchMode) return;
    const block = (e: TouchEvent) => {
      if (liftedRef.current && e.cancelable) e.preventDefault();
    };
    document.addEventListener("touchmove", block, { passive: false });
    return () => document.removeEventListener("touchmove", block);
  }, [touchMode]);

  // Arrastando perto da borda de cima/baixo, a página rola para dar para levar o card mais longe.
  useEffect(() => {
    if (!lifted || !drag) return;
    let raf = 0;
    const step = () => {
      const { x, y } = ptr.current;
      const bottom = window.innerHeight - 150; // acima da barra de abas
      const dy = y < SCROLL_EDGE ? -(SCROLL_EDGE - y) / 5 : y > bottom ? (y - bottom) / 5 : 0;
      if (dy) {
        window.scrollBy(0, Math.max(-16, Math.min(16, dy)));
        drag.onDragOver(id, { x: x + window.scrollX, y: y + window.scrollY });
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [lifted, drag, id]);

  if (!acc) return null;

  const pk = acc.pokemon;
  const hpPct = pk && pk.maxHp > 0 ? Math.min(100, (pk.hp / pk.maxHp) * 100) : 0;
  const hpColor = hpPct > 50 ? "#6fd47c" : hpPct > 20 ? "#f3c04a" : "#ef6b5b";

  return (
    <motion.article
      layout="position"
      data-card-id={id}
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: acc.status === "offline" ? 0.62 : 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.5,
        ease: EASE,
        delay: Math.min(index, 6) * 0.07,
        // Troca de lugar: mola rápida, sem o atraso da entrada.
        layout: { type: "spring", stiffness: 420, damping: 36, delay: 0 },
      }}
      drag={!!drag}
      dragListener={!!drag?.canDrag}
      dragControls={controls}
      dragSnapToOrigin
      dragMomentum={false}
      dragElastic={0.14}
      whileDrag={{ scale: 1.03, zIndex: 40, boxShadow: "0 22px 44px -10px rgba(0,0,0,.75), 0 0 0 2px rgba(243,192,74,.55)" }}
      onDrag={(_: unknown, info: PanInfo) => {
        ptr.current = { x: info.point.x - window.scrollX, y: info.point.y - window.scrollY };
        drag?.onDragOver(id, info.point);
      }}
      onDragEnd={() => {
        dragState.endedAt = performance.now();
        drop();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={drop}
      onPointerCancel={drop}
      onContextMenu={touchMode ? (e) => e.preventDefault() : undefined}
      className={`card p-2.5 sm:p-3 ${drag?.canDrag ? "cursor-grab active:cursor-grabbing" : touchMode ? "select-none [-webkit-touch-callout:none]" : ""} ${lifted ? "ring-2 ring-poke-gold/70" : ""}`}
    >
      <header className="flex items-center gap-2.5 sm:gap-3.5">
        {cardStyle === "corrida" && (
        <motion.div
          whileHover={{ rotate: -4, scale: 1.06 }}
          transition={{ type: "spring", stiffness: 320, damping: 16 }}
          className="relative flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-edge sm:size-14 sm:border-[3px]"
          style={{ background: "radial-gradient(circle at 50% 35%, #4a3519, #1a120a 75%)", boxShadow: "0 0 14px -2px rgba(200,146,58,.45)" }}
        >
          <span className="origin-center scale-[.72] sm:scale-100">
            <PokemonSprite looktype={pk?.looktype} size={52} />
          </span>
        </motion.div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            {/* Nome, mapa e hunt na mesma linha; se faltar largura (celular), o que não couber desce junto. */}
            <div className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1.5">
              <h3 className="max-w-full truncate text-base font-extrabold leading-tight tracking-tight sm:text-xl">
                {acc.nick}
                {acc.vip && (
                  <span className="ml-1.5 rounded bg-poke-gold px-1 py-0.5 align-middle text-[9px] font-black leading-none text-void sm:ml-2 sm:px-1.5 sm:text-[10px]">VIP</span>
                )}
              </h3>
              <MapChip map={acc.map} />
              <span className="flex min-w-0 items-center gap-1.5 text-sm text-mute sm:hidden">
                <Crosshair className="size-4 shrink-0 text-poke-gold" aria-hidden />
                <span className="sr-only">Hunt atual: </span>
                <b className="truncate font-semibold text-fg">{acc.huntName ?? prettySlug(acc.hunt?.slug)}</b>
              </span>
            </div>
            <StatusPill status={acc.status} />
          </div>
          {/* Os níveis já aparecem no bloco de XP do Resumo; na aba Sessão continuam aqui. */}
          <div className={`mt-0.5 items-center gap-x-2 text-xs text-mute sm:mt-1 sm:text-sm ${mode === "sessao" ? "flex" : "hidden"}`}>
            <span className="tnum shrink-0" title="Nível do treinador">
              <span className="sm:hidden">Trein. </span>
              <span className="hidden sm:inline">Treinador </span>
              Nv. {fmtShort(acc.level)}
            </span>
            <span className="flex min-w-0 items-center gap-1" title="Pokémon equipado">
              <span aria-hidden className="text-line">|</span>
              <span className="truncate">{pk?.name ?? "—"}</span>
              {pk?.level != null && <span className="tnum shrink-0">Nv. {fmtShort(pk.level)}</span>}
              {pk?.shiny && <ShinyMark />}
            </span>
          </div>
          <div
            className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/50 sm:mt-2 sm:h-1.5"
            title={pk ? `${fmtShort(pk.hp)} / ${fmtShort(pk.maxHp)} HP` : undefined}
          >
            <motion.div
              className="h-full rounded-full"
              animate={{ width: `${hpPct}%`, backgroundColor: hpColor }}
              transition={{ duration: 0.6, ease: EASE }}
            />
          </div>
        </div>
      </header>

      {acc.huntPending && (
        <p className="mt-1.5 truncate text-xs text-poke-gold sm:hidden">→ {acc.huntPending.name} (na fila)</p>
      )}

      <div className="mt-2 sm:mt-2.5">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={mode}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: EASE }}
          >
            {mode === "resumo" ? <ResumoBody id={id} variant={cardStyle} /> : <SessaoBody id={id} />}
          </motion.div>
        </AnimatePresence>
      </div>

      <footer className="mt-2.5 hidden flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line pt-2 text-sm text-mute sm:flex">
        <span className="truncate">
          Hunt: <b className="font-semibold text-fg">{acc.huntName ?? prettySlug(acc.hunt?.slug)}</b>
          {acc.hunt && <> · {fmtDuration(acc.hunt.minutes)}</>}
          {acc.hunt && acc.hunt.kills > 0 && <> · <span className="tnum">{fmtShort(acc.hunt.kills)} abates</span></>}
          {acc.huntPending && <span className="ml-1.5 text-poke-gold"> → {acc.huntPending.name} (na fila)</span>}
        </span>
        {acc.captured && (
          <span className="tnum">
            {fmtShort(acc.captured.total)} Pokémons
            {acc.captured.shiny ? ` · ${acc.captured.shiny} shiny` : ""}
          </span>
        )}
      </footer>
    </motion.article>
  );
}

// Cada card assina só a própria conta; memo evita re-render do pai.
export const AccountCard = memo(AccountCardImpl);
