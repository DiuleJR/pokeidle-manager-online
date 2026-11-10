import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { Clock, Crosshair, Star } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { ItemSprite, PokemonSprite, ShinyMark } from "@/components/Sprites";
import { EquipPopover } from "@/components/EquipPopover";
import { StatusPill } from "@/components/StatusPill";
import { AnimatedNumber, Coin, GoldPerHourIcon } from "@/components/ui";
import { serverNow, useAccount } from "@/lib/telemetry";
import type { EquippedItem } from "@/lib/types";
import { dragState, justDragged } from "@/lib/useCardOrder";
import { fmtDuration, fmtShort } from "@/lib/utils";

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

/** Celular: "x79". Desktop: "Golden Potion (x79)". */
function Equipped({ item }: { item?: EquippedItem | null }) {
  if (!item) return <span className="text-mute">—</span>;
  return (
    <>
      <span className="hidden sm:inline">{item.name} </span>
      <span className="font-semibold text-mute sm:text-fg">
        <span className="sm:hidden">x</span>
        <span className="hidden sm:inline">(x</span>
        <AnimatedNumber value={item.qty} />
        <span className="hidden sm:inline">)</span>
      </span>
    </>
  );
}

function ResumoBody({ id }: { id: string }) {
  const acc = useAccount(id);
  if (!acc) return null;
  const potion = acc.equipped?.potion;
  const ball = acc.equipped?.ball;
  const options = acc.equipped?.options;
  const [picker, setPicker] = useState<{ kind: "ball" | "potion"; anchor: DOMRect } | null>(null);
  const open = (kind: "ball" | "potion") => (el: HTMLElement) => setPicker({ kind, anchor: el.getBoundingClientRect() });
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-2 sm:gap-2">
      <Tile icon={<Coin kind="gold" />} label="Gold" className="order-6 sm:order-none">
        <AnimatedNumber value={acc.gold} />
      </Tile>
      <Tile icon={<Coin kind="gem" />} label="Gemas" className="order-3 sm:order-none">
        <AnimatedNumber value={acc.gems} />
      </Tile>
      <Tile icon={<ItemSprite icon={potion?.icon} size={32} alt={potion?.name} />} className="order-2 sm:order-none" label="Poção equipada" hint={potion ? `Poção equipada: ${potion.name}. Clique para trocar` : "Clique para escolher a poção"} onPress={options ? open("potion") : undefined}>
        <Equipped item={potion} />
      </Tile>
      <Tile icon={<ItemSprite icon={ball?.icon} size={32} alt={ball?.name} />} className="order-5 sm:order-none" label="Bola equipada" hint={ball ? `Bola equipada: ${ball.name}. Clique para trocar` : "Clique para escolher a bola"} onPress={options ? open("ball") : undefined}>
        <Equipped item={ball} />
      </Tile>
      <Tile icon={<Star className="size-full fill-poke-gold text-poke-gold" />} label="XP por hora" className="tile-green order-1 sm:order-none">
        <span className="text-poke-green">
          +<AnimatedNumber value={acc.xpPerHour} />
          <span className="hidden sm:inline"> XP/h</span>
        </span>
      </Tile>
      <Tile
        icon={<GoldPerHourIcon />}
        label="Ouro por hora"
        className="tile-gold order-4 sm:order-none"
      >
        <span className="text-poke-gold">
          +<AnimatedNumber value={acc.goldPerHour} />
          <span className="hidden sm:inline"> Ouro/h</span>
        </span>
      </Tile>
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
    </div>
  );
}

function SessaoBody({ id }: { id: string }) {
  const acc = useAccount(id);
  if (!acc) return null;
  return (
    <div className="space-y-1.5 sm:space-y-2.5">
      <Tile icon={<Clock className="size-full text-poke-gold" />} label="Tempo da sessão" className="tile-gold">
        <span className="text-xl font-extrabold leading-none text-fg sm:text-3xl">
          <SessionClock startedAt={acc.session?.startedAt} />
        </span>
      </Tile>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-2 sm:gap-2.5">
        {SESSION_ITEMS.map((it) => (
          <Tile key={it.key} icon={<ItemSprite icon={it.icon} size={32} alt={it.label} />} label={it.label}>
            <span className="font-extrabold sm:text-2xl">
              <AnimatedNumber value={acc.session?.items[it.key] ?? 0} />
            </span>
          </Tile>
        ))}
      </div>
    </div>
  );
}

/** Arrastar para trocar de lugar: `canDrag` só no computador; `onDragOver` recebe o ponto do ponteiro. */
export interface CardDrag {
  canDrag: boolean;
  onDragOver: (id: string, point: { x: number; y: number }) => void;
}

function AccountCardImpl({ id, mode, index = 0, drag }: { id: string; mode: CardMode; index?: number; drag?: CardDrag }) {
  const acc = useAccount(id);
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
      drag={drag?.canDrag}
      dragSnapToOrigin
      dragMomentum={false}
      dragElastic={0.14}
      whileDrag={{ scale: 1.03, zIndex: 40, boxShadow: "0 22px 44px -10px rgba(0,0,0,.75), 0 0 0 2px rgba(243,192,74,.55)" }}
      onDrag={(_: unknown, info: PanInfo) => drag?.onDragOver(id, info.point)}
      onDragEnd={() => {
        dragState.endedAt = performance.now();
      }}
      className={`card p-2.5 sm:p-3 ${drag?.canDrag ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <header className="flex items-center gap-2.5 sm:gap-3.5">
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

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate text-base font-extrabold leading-tight tracking-tight sm:text-xl">
              {acc.nick}
              {acc.vip && (
                <span className="ml-1.5 rounded bg-poke-gold px-1 py-0.5 align-middle text-[9px] font-black leading-none text-void sm:ml-2 sm:px-1.5 sm:text-[10px]">VIP</span>
              )}
            </h3>
            <StatusPill status={acc.status} />
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-mute sm:mt-1 sm:gap-2 sm:text-sm">
            <span className="tnum">Nv. {fmtShort(acc.level)}</span>
            <span aria-hidden>·</span>
            <span className="truncate">{pk?.name ?? "—"}</span>
            {pk?.shiny && <ShinyMark />}
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

      {/* Celular: o rodapé some, então a hunt atual (e a troca na fila) vem numa linha fina logo abaixo do cabeçalho. */}
      <div className="mt-1.5 space-y-0.5 text-xs text-mute sm:hidden">
        <p className="flex items-center gap-1.5">
          <Crosshair className="size-3.5 shrink-0 text-poke-gold" aria-hidden />
          <span className="min-w-0 truncate">
            <span className="sr-only">Hunt atual: </span>
            <b className="font-semibold text-fg">{acc.huntName ?? prettySlug(acc.hunt?.slug)}</b>
          </span>
          {acc.hunt && <span className="tnum shrink-0">· {fmtDuration(acc.hunt.minutes)}</span>}
        </p>
        {acc.huntPending && (
          <p className="truncate pl-5 text-poke-gold">
            → {acc.huntPending.name} (na fila)
          </p>
        )}
      </div>

      <div className="mt-2 sm:mt-2.5">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={mode}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: EASE }}
          >
            {mode === "resumo" ? <ResumoBody id={id} /> : <SessaoBody id={id} />}
          </motion.div>
        </AnimatePresence>
      </div>

      <footer className="mt-2.5 hidden flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line pt-2 text-sm text-mute sm:flex">
        <span className="truncate">
          Hunt: <b className="font-semibold text-fg">{acc.huntName ?? prettySlug(acc.hunt?.slug)}</b>
          {acc.hunt && <> · {fmtDuration(acc.hunt.minutes)}</>}
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
