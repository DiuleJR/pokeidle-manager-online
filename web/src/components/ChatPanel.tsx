import { ArrowDown, Coins, Globe, HelpCircle, Loader2, PictureInPicture2, Send, X } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import {
  CHANNELS,
  ChatSendError,
  dismissNotice,
  sendChat,
  setMyNicks,
  setWatching,
  useChat,
  type ChannelId,
  type ChatMsg,
} from "@/lib/chat";
import { useSheet } from "@/lib/sheet";
import { useAccountIds, useAccountsMap } from "@/lib/telemetry";

const MIN_LEVEL = 10; // igual ao jogo: abaixo disso a conta não fala no chat
const MAX_LEN = 200;
const GAP_MS = 3000; // espelha a trava do servidor (uma mensagem por conta a cada 3 s)
const KEY_ACCOUNT = "chat.account";
const KEY_CHANNEL = "chat.channel";

const ICONS: Record<ChannelId, typeof Globe> = { mundo: Globe, comercio: Coins, duvidas: HelpCircle };

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sem armazenamento: não lembra, mas funciona */
  }
};

const clock = (ts: number) => new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Cargos que o jogo pinta (a classe do CSS tem o mesmo nome). Qualquer outro valor fica sem cor especial. */
const ROLES = new Set(["vip", "tutor", "moderador", "helper", "streamer", "admin", "anuncio", "compartilhar", "shiny"]);
/** Como no jogo, só admin, moderador e helper podem mandar link clicável. */
const LINKERS = new Set(["admin", "moderador", "helper"]);
const RE_MENTION = /(^|[^a-zA-Z0-9_@])@([a-zA-Z0-9_]{3,16})(?![a-zA-Z0-9_])/g;
const RE_URL = /^(?:https?:\/\/\S+|www\.\S+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|gg|br|app|dev)(?:\/\S*)?)$/i;

/** Texto da fala: `@menções` coloridas (douradas se for uma das suas contas) e links só para quem o jogo deixa. */
function renderBody(text: string, mine: string[], linkable: boolean): { nodes: ReactNode[]; toMe: boolean } {
  let toMe = false;
  const nodes: ReactNode[] = [];
  text.split(/(\s+)/).forEach((tok, i) => {
    if (linkable) {
      const core = tok.replace(/[.,;:!?)]+$/, "");
      if (core && RE_URL.test(core)) {
        const href = /^https?:\/\//i.test(core) ? core : `https://${core}`;
        nodes.push(
          <a key={i} className="cm-link" href={href} target="_blank" rel="noopener noreferrer nofollow">
            {core}
          </a>,
          tok.slice(core.length),
        );
        return;
      }
    }
    let last = 0;
    let found = false;
    for (const x of tok.matchAll(RE_MENTION)) {
      found = true;
      const start = x.index! + x[1].length;
      const eu = mine.includes(x[2].toLowerCase());
      toMe ||= eu;
      nodes.push(tok.slice(last, start), <span key={`${i}-${start}`} className={`cm-menc${eu ? " eu" : ""}`}>@{x[2]}</span>);
      last = start + x[2].length + 1;
    }
    nodes.push(found ? tok.slice(last) : tok);
  });
  return { nodes, toMe };
}

/** Texto com o nome do Pokémon virando botão que abre a ficha. */
function withPokemonLink(text: string, pk: NonNullable<ChatMsg["pk"]>, open: (el: Element) => void): ReactNode {
  const at = text.indexOf(pk.label);
  const btn = (
    <button type="button" className="cm-pk" title="Ver a ficha do Pokémon" onClick={(e) => open(e.currentTarget)}>
      {pk.label}
    </button>
  );
  if (at < 0) return <>{text} ({btn})</>;
  return <>{text.slice(0, at)}{btn}{text.slice(at + pk.label.length)}</>;
}

const Row = memo(function Row({ m, mine }: { m: ChatMsg; mine: string[] }) {
  const openSheet = useSheet();
  const role = m.cargo && ROLES.has(m.cargo) ? m.cargo : "";
  const kindCls = m.kind === "ad" ? "ad" : m.kind === "rare" ? "rare" : m.kind === "shiny" && !role ? "shiny" : "";
  const ad = m.ad;
  const parsed = m.kind === "msg" || m.kind === "share" ? renderBody(m.text, mine, !!m.cargo && LINKERS.has(m.cargo)) : null;
  const pk = m.pk;
  const openPk = (el: Element) => pk && openSheet({ kind: "public", nick: pk.nick, id: pk.id }, el);
  return (
    <li className={`cm selectable ${role} ${kindCls} ${parsed?.toMe ? "cm-para-mim" : ""}`}>
      <span className="cm-t">{clock(m.ts)}</span>
      {m.kind === "ad" && <span aria-hidden>📢 </span>}
      {m.kind !== "rare" && (
        <>
          {m.guild && (
            <span className="cm-guild" style={m.guildColor ? ({ "--gt": m.guildColor } as CSSProperties) : undefined}>
              {m.guild}
            </span>
          )}
          <span className="cm-de">{m.de}</span>
          {m.nivel != null && <span className="cm-nv"> [{m.nivel}]</span>}
          <span>: </span>
        </>
      )}
      <span className="cm-tx">
        {ad ? (
          <button type="button" className="cm-pk cm-pk-ad" title="Ver a ficha do Pokémon anunciado" onClick={(e) => openSheet({ kind: "listing", id: ad.id }, e.currentTarget)}>
            estou anunciando {ad.qtd}x <span className="cm-ad-nome">{ad.nome}</span> por{" "}
            <span className={`cm-ad-preco ${ad.moeda}`}>
              {ad.preco} {ad.moeda === "gemas" ? "Gemas" : "Gold"}
            </span>
            {ad.qtd > 1 ? " cada" : ""}, confira meu anúncio!
          </button>
        ) : pk ? (
          withPokemonLink(m.text, pk, openPk)
        ) : (
          (parsed?.nodes ?? m.text)
        )}
      </span>
    </li>
  );
});

export function ChatPanel({ active = true, onClose, onPopout, popoutLabel }: { active?: boolean; onClose?: () => void; onPopout?: () => void; popoutLabel?: string }) {
  const chat = useChat();
  const ids = useAccountIds();
  const accounts = useAccountsMap();
  const [canal, setCanal] = useState<ChannelId>(() => (CHANNELS.some((c) => c.id === read(KEY_CHANNEL)) ? (read(KEY_CHANNEL) as ChannelId) : "mundo"));
  const [chosen, setChosen] = useState<string | null>(() => read(KEY_ACCOUNT));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Quem pode falar: online e com o nível mínimo. O padrão é a de maior nível.
  const speakers = useMemo(
    () =>
      ids
        .map((id) => accounts[id])
        .filter((a) => a && a.status === "online" && (a.level ?? 0) >= MIN_LEVEL)
        .sort((a, b) => (b.level ?? 0) - (a.level ?? 0)),
    [ids, accounts],
  );
  const account = speakers.find((a) => a.id === chosen) ?? speakers[0];

  useEffect(() => {
    setMyNicks(ids.map((i) => accounts[i]?.nick).filter(Boolean) as string[]);
  }, [ids, accounts]);

  // Enquanto o chat está à vista, o canal aberto não acumula "não lidas".
  useEffect(() => {
    setWatching(active ? canal : null);
    return () => setWatching(null);
  }, [active, canal]);

  const list = chat.messages[canal];
  const mineLower = useMemo(() => chat.mine.map((n) => n.toLowerCase()), [chat.mine]);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [pending, setPending] = useState(0);
  const lastLen = useRef(0);

  const toBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "instant" });
    stick.current = true;
    setPending(0);
  }, []);

  useLayoutEffect(() => {
    const grew = list.length - lastLen.current;
    lastLen.current = list.length;
    if (stick.current) toBottom();
    else if (grew > 0) setPending((p) => p + grew);
  }, [list, toBottom]);

  // Trocar de canal ou abrir a bandeja leva ao fim.
  useLayoutEffect(() => {
    lastLen.current = list.length;
    if (active) toBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canal, active]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (stick.current) setPending(0);
  };

  useEffect(() => {
    if (until <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [until]);
  const wait = Math.max(0, Math.ceil((until - now) / 1000));

  const pick = (c: ChannelId) => {
    setCanal(c);
    write(KEY_CHANNEL, c);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || !account || busy || wait > 0) return;
    setBusy(true);
    setError("");
    try {
      await sendChat(account.id, canal, body);
      setText("");
      setUntil(Date.now() + GAP_MS);
      setNow(Date.now());
      toBottom(true);
    } catch (err) {
      const e2 = err as ChatSendError;
      setError(e2.message);
      if (e2.code === "rate" && e2.wait) {
        setUntil(Date.now() + e2.wait * 1000);
        setNow(Date.now());
      }
    } finally {
      setBusy(false);
    }
  };

  const total = (c: ChannelId) => chat.unread[c];
  const placeholder = !account
    ? speakers.length === 0 && ids.length > 0
      ? "Nenhuma conta online com nível 10 ou mais"
      : "Aguardando contas…"
    : `Falar no ${CHANNELS.find((c) => c.id === canal)?.label}…`;

  return (
    <section aria-label="Chat do jogo" className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-1.5 border-b border-line px-2 pb-2 pt-2.5">
        <div role="tablist" aria-label="Canais" className="flex min-w-0 flex-1 gap-1">
          {CHANNELS.map((c) => {
            const Icon = ICONS[c.id];
            const u = total(c.id);
            const on = canal === c.id;
            return (
              <button
                key={c.id}
                role="tab"
                aria-selected={on}
                onClick={() => pick(c.id)}
                className={`relative flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border px-1.5 py-1.5 text-xs font-bold transition-colors ${
                  on ? "border-edge bg-[#3a2a12] text-poke-gold" : "border-line bg-tile text-mute hover:border-edge/60 hover:text-fg"
                }`}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{c.label}</span>
                {!on && u.n > 0 && (
                  <span
                    className={`tnum absolute -right-1 -top-1.5 min-w-4 rounded-full px-1 text-center text-[10px] font-extrabold leading-4 ${
                      u.mention ? "bg-poke-red text-void" : "bg-poke-gold text-void"
                    }`}
                    aria-label={`${u.n} mensagens novas`}
                  >
                    {u.n > 99 ? "99+" : u.n}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {onPopout && (
          <button type="button" onClick={onPopout} className="btn !px-2" aria-label={popoutLabel ?? "Destacar o chat"} title={popoutLabel ?? "Destacar o chat"}>
            <PictureInPicture2 className="size-4" aria-hidden />
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose} className="btn !px-2" aria-label="Fechar o chat" title="Fechar">
            <X className="size-4" aria-hidden />
          </button>
        )}
      </header>

      {chat.notice && (
        <div role="status" className="mx-2 mt-2 flex items-start gap-2 rounded-lg border border-poke-red/50 bg-poke-red/10 px-2.5 py-1.5 text-xs text-fg">
          <span className="min-w-0 flex-1">{chat.notice.text}</span>
          <button type="button" onClick={dismissNotice} aria-label="Dispensar aviso" className="shrink-0 text-mute hover:text-fg">
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="cm-list selectable h-full overflow-y-auto overscroll-contain px-2.5 py-2" tabIndex={0} aria-label={`Mensagens do canal ${canal}`}>
          {list.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-mute">
              {chat.link === "open" ? "Nenhuma mensagem ainda neste canal. Assim que alguém falar, aparece aqui." : "Conectando ao chat…"}
            </p>
          ) : (
            <ul className="space-y-0.5" aria-live="off">
              {list.map((m) => (
                <Row key={m.id} m={m} mine={mineLower} />
              ))}
            </ul>
          )}
        </div>
        {pending > 0 && (
          <button
            type="button"
            onClick={() => toBottom(true)}
            className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-edge bg-[#3a2a12] px-3 py-1 text-xs font-bold text-poke-gold shadow-lg"
          >
            <ArrowDown className="size-3.5" aria-hidden /> {pending} {pending === 1 ? "nova" : "novas"}
          </button>
        )}
        {chat.link === "closed" && (
          <div className="absolute inset-x-2 top-2 flex items-center gap-2 rounded-lg border border-line bg-tile/95 px-2.5 py-1.5 text-xs text-mute">
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Reconectando ao chat…
          </div>
        )}
      </div>

      <form onSubmit={submit} className="space-y-1.5 border-t border-line p-2" aria-label="Enviar mensagem">
        <div className="flex items-center gap-2">
          <label htmlFor="chat-account" className="shrink-0 text-xs font-semibold text-mute">
            Falar como
          </label>
          <select
            id="chat-account"
            className="field !h-8 min-w-0 flex-1 !px-2 text-xs"
            value={account?.id ?? ""}
            disabled={speakers.length === 0}
            onChange={(e) => {
              setChosen(e.target.value);
              write(KEY_ACCOUNT, e.target.value);
            }}
          >
            {speakers.length === 0 && <option value="">—</option>}
            {speakers.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nick} · nv {a.level}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="field min-w-0 flex-1 !text-[16px] sm:!text-sm"
            value={text}
            maxLength={MAX_LEN}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            disabled={!account}
            autoComplete="off"
            enterKeyHint="send"
            aria-label="Mensagem"
          />
          <button type="submit" className="btn !px-3" disabled={!account || !text.trim() || busy || wait > 0} aria-label={wait > 0 ? `Aguarde ${wait} segundos` : "Enviar"}>
            {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : wait > 0 ? <span className="tnum w-4 text-center">{wait}</span> : <Send className="size-4" aria-hidden />}
          </button>
        </div>
        <div className="flex min-h-4 items-center justify-between gap-2 text-[11px]">
          <span role="alert" className="min-w-0 truncate text-poke-red">
            {error}
          </span>
          <span className={`tnum shrink-0 ${text.length > MAX_LEN - 20 ? "text-poke-gold" : "text-mute/70"}`}>
            {text.length}/{MAX_LEN}
          </span>
        </div>
      </form>
    </section>
  );
}
