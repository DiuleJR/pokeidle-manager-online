import { ChevronDown, Lock, TrendingUp } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Notice } from "@/components/SettingsView";
import { ItemSprite, PokemonSprite, ShinyMark } from "@/components/Sprites";
import { Coin } from "@/components/ui";
import { type Listing, type MarketItem, type Moeda, type Wallet, marketApi } from "@/lib/market";
import { useAccountsMap } from "@/lib/telemetry";
import { fmtUsd } from "@/lib/valuation";
import { fmtInt } from "@/lib/utils";
import { CalcCard } from "./CalcTab";
import { AccountPicker, ErrorBox, Loading, Money, fmtWhen, secondsLabel, useAsync, useOnlineAccounts } from "./shared";

const MOTIVO: Record<string, string> = {
  compra: "Depósito (compra de Gemas)",
  saque: "Saque",
  saque_estorno: "Estorno de saque",
  market_venda: "Venda no Mercado",
  market_compra: "Compra no Mercado",
  loja: "Loja",
  loja_estorno: "Estorno da loja",
  afiliado: "Afiliado",
  ajuste_admin: "Ajuste da administração",
  pvp_mensal: "Prêmio PvP mensal",
};
const SAQUE_STATUS: Record<string, string> = {
  pendente: "Pendente",
  aguardando_aprovacao: "Aguardando aprovação",
  enviando: "Enviando",
  confirmado: "Confirmado",
  falhou: "Falhou (tenta de novo sozinho)",
  cancelado: "Cancelado",
};

const CARO = 0.15; // mesmo corte da tag "Caro" da aba Preços
const MIN_SOLD = 3; // média de 7 dias só vale com algumas vendas
const DAY = 86400;

/** Bloco recolhido por padrão; só abre ao tocar no título (setinha). A lista dentro rola a partir de 5 linhas. */
function Fold({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <details className="card group overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-3 [&::-webkit-details-marker]:hidden">
        <span className="font-bold">
          {title} <span className="ml-1 text-sm font-normal text-mute">({count})</span>
        </span>
        <ChevronDown className="size-5 text-mute transition-transform duration-200 group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-line">{children}</div>
    </details>
  );
}

interface Mine {
  account: number;
  nick: string;
  now: number;
  listings: Listing[];
}
interface Row {
  l: Listing;
  nick: string;
  drift: number;
}

/** Quanto o preço de `moeda` está acima da média (0.5 = +50%). null = sem média confiável ou preço de fachada. */
function premiumOf(it: MarketItem, moeda: Moeda): { floor: number; avg: number; prem: number } | null {
  const floor = moeda === "orb" ? it.minOrb : it.minGold;
  const avg = moeda === "orb" ? it.avgOrb : it.avgGold;
  const sold = moeda === "orb" ? it.soldOrb : it.soldGold;
  if (!floor || !avg || floor < avg * 0.1 || (sold ?? 0) < MIN_SOLD) return null;
  return { floor, avg, prem: floor / avg - 1 };
}

function Chip({ tone, children, title }: { tone: "green" | "gold" | "mute"; children: React.ReactNode; title?: string }) {
  const cls = tone === "green" ? "border-[#2f6b3a] bg-[#16301c] text-poke-green" : tone === "gold" ? "border-[#7a5a1c] bg-[#38290f] text-poke-gold" : "border-line bg-void/40 text-mute";
  return (
    <span title={title} className={`whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>
      {children}
    </span>
  );
}

/** Onde o meu anúncio está em relação ao mercado: menor preço, quanto acima dele e quanto acima da média. */
function Standing({ l, it }: { l: Listing; it?: MarketItem }) {
  if (l.tipo !== "item" || !it) return null;
  const floor = l.moeda === "orb" ? it.minOrb : it.minGold;
  const avg = l.moeda === "orb" ? it.avgOrb : it.avgGold;
  if (!floor) return null;
  const gap = (l.preco - floor) / floor;
  const vsAvg = avg ? l.preco / avg - 1 : null;
  return (
    <>
      {l.preco <= floor ? (
        <Chip tone="green" title="Seu anúncio é o mais barato do mercado agora">
          Menor preço
        </Chip>
      ) : (
        <Chip tone="mute" title={`O menor preço do mercado é ${fmtInt(floor)}`}>
          +{Math.round(gap * 100)}% do menor
        </Chip>
      )}
      {vsAvg != null && Math.abs(vsAvg) >= 0.05 && (
        <Chip tone={vsAvg >= CARO ? "gold" : "mute"} title={`Média de 7 dias: ${fmtInt(avg ?? 0)}`}>
          {vsAvg > 0 ? "+" : "−"}
          {Math.abs(Math.round(vsAvg * 100))}% da média
        </Chip>
      )}
    </>
  );
}

function ListingCard({ r, it, showNick }: { r: Row; it?: MarketItem; showNick: boolean }) {
  const { l, drift } = r;
  const now = Date.now() + drift;
  const left = l.expiraEm ? Math.max(0, Math.round((l.expiraEm - now) / 1000)) : null;
  const total = l.criadoEm && l.expiraEm ? (l.expiraEm - l.criadoEm) / 1000 : null;
  const pctLeft = left != null && total ? Math.min(100, Math.max(0, (left / total) * 100)) : null;
  const soon = left != null && left < DAY;
  const isMon = l.tipo === "pokemon";
  const name = isMon ? `${l.ficha?.nome ?? "Pokémon"} nv. ${l.ficha?.level ?? "?"}` : (l.ficha?.nome ?? it?.name ?? `item #${l.itemId}`);
  return (
    <li className="tile relative flex items-center gap-3 overflow-hidden p-2.5">
      <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-line bg-void/50">
        {isMon ? <PokemonSprite looktype={l.ficha?.looktype} size={40} /> : <ItemSprite icon={it?.icon} size={36} alt="" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[15px] font-bold leading-tight">
          <span className="truncate">{name}</span>
          {isMon && l.ficha?.shiny && <ShinyMark />}
          {!isMon && l.qtd > 1 && <span className="shrink-0 font-semibold text-mute">×{fmtInt(l.qtd)}</span>}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-mute">
          {showNick && <Chip tone="mute">{r.nick}</Chip>}
          <Standing l={l} it={it} />
          {left != null && <span className={soon ? "font-semibold text-poke-red" : ""}>expira em {secondsLabel(left)}</span>}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <Money v={l.preco} moeda={l.moeda} className="text-base font-extrabold" />
        {l.qtd > 1 && !isMon && <p className="text-xs text-mute">cada · total {fmtInt(l.preco * l.qtd)}</p>}
      </div>
      {pctLeft != null && (
        <span className="absolute inset-x-0 bottom-0 h-[3px] bg-line/60" aria-hidden>
          <span className={`block h-full ${soon ? "bg-poke-red/80" : "bg-edge/70"}`} style={{ width: `${pctLeft}%` }} />
        </span>
      )}
    </li>
  );
}

/** Itens que tenho nas contas e estão caros agora (acima da média de 7 dias): é hora de vender. */
function SellNow({ items, owned }: { items: MarketItem[]; owned: Map<number, number> }) {
  const hot = useMemo(() => {
    const out: { it: MarketItem; qty: number; moeda: Moeda; floor: number; avg: number; prem: number }[] = [];
    for (const it of items) {
      const qty = owned.get(it.id) ?? 0;
      if (!qty) continue;
      const best = (["orb", "gold"] as Moeda[])
        .map((m) => ({ m, p: premiumOf(it, m) }))
        .filter((x) => x.p && x.p.prem >= CARO)
        .sort((a, b) => (b.p?.prem ?? 0) - (a.p?.prem ?? 0))[0];
      if (best?.p) out.push({ it, qty, moeda: best.m, ...best.p });
    }
    return out.sort((a, b) => b.prem - a.prem).slice(0, 6);
  }, [items, owned]);

  return (
    <section className="space-y-1.5" aria-labelledby="sell-now">
      <h2 id="sell-now" className="label flex items-center gap-1.5 px-1">
        <TrendingUp className="size-4 text-poke-gold" aria-hidden /> Hora de vender
      </h2>
      {hot.length === 0 ? (
        <p className="tile px-3 py-2.5 text-sm text-mute">Nenhum item seu está caro agora. Avisamos no Discord quando ficar.</p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {hot.map(({ it, qty, moeda, floor, avg, prem }) => (
            <li key={it.id} className="tile tile-gold flex items-center gap-3 p-2.5">
              <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-[#7a5a1c] bg-void/40">
                <ItemSprite icon={it.icon} size={36} alt="" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold leading-tight text-fg">{it.name}</p>
                <p className="mt-1 text-xs text-mute">
                  você tem <b className="text-fg">{fmtInt(qty)}</b> · média <Money v={avg} moeda={moeda} short className="text-mute" />
                </p>
              </div>
              <div className="shrink-0 text-right">
                <Money v={floor} moeda={moeda} short className="font-extrabold text-fg" />
                <p className="tnum text-xs font-bold text-poke-gold">+{Math.round(prem * 100)}%</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Minha conta: saldo (de uma conta ou de todas somadas), o que vender, anúncios abertos, saques, extrato e a calculadora. */
export function MineTab() {
  const accs = useOnlineAccounts();
  const accounts = useAccountsMap();
  const [sel, setSel] = useState<number | undefined>(undefined);
  const all = sel === 0;
  const targets = all ? accs : accs.filter((a) => a.id === sel);

  const load = useCallback(async () => {
    const ids = targets.map((a) => a.id);
    const [w, m] = await Promise.all([
      Promise.allSettled(ids.map((id) => marketApi.wallet(id))),
      Promise.allSettled(ids.map((id) => marketApi.mine(id))),
    ]);
    const wallets = w.flatMap((x) => (x.status === "fulfilled" ? [x.value] : []));
    const mines: Mine[] = m.flatMap((x, i) => (x.status === "fulfilled" ? [{ ...x.value, nick: targets[i]?.nick ?? `conta ${x.value.account}` }] : []));
    if (!wallets.length && w.length && w[0].status === "rejected") throw (w[0] as PromiseRejectedResult).reason;
    return { wallets, mines };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, accs.map((a) => a.id).join(",")]);

  const data = useAsync(load, [sel, accs.length], { every: 60000, skip: sel === undefined || targets.length === 0 });
  const ov = useAsync(() => marketApi.overview(), [], { every: 60000 });
  const market = useMemo(() => new Map((ov.data?.items ?? []).map((i) => [i.id, i])), [ov.data]);

  const owned = useMemo(() => {
    const m = new Map<number, number>();
    for (const a of targets) for (const it of accounts[a.key]?.inventory?.items ?? []) m.set(it.id, (m.get(it.id) ?? 0) + it.qty);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, sel, accs.length]);

  const wallets: Wallet[] = data.data?.wallets ?? [];
  const gems = wallets.reduce((s, w) => s + (w.balance ?? 0), 0);
  const gold = targets.reduce((s, a) => s + a.gold, 0);
  const rate = wallets.find((w) => w.prices.saque)?.prices.saque;
  const withdrawals = wallets.flatMap((w) => w.withdrawals.map((x) => ({ ...x, nick: w.nick })));
  const ledger = wallets
    .flatMap((w) => w.ledger.map((x) => ({ ...x, nick: w.nick })))
    .sort((a, b) => (b.em ?? b.ts ?? 0) - (a.em ?? a.ts ?? 0));
  const rows: Row[] = (data.data?.mines ?? []).flatMap((m) => m.listings.map((l) => ({ l, nick: m.nick, drift: m.now - Date.now() })));
  const byAccount = useMemo(() => {
    const g = new Map<string, Row[]>();
    for (const r of rows) g.set(r.nick, [...(g.get(r.nick) ?? []), r]);
    for (const list of g.values()) list.sort((a, b) => (a.l.expiraEm ?? Infinity) - (b.l.expiraEm ?? Infinity));
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.data]);
  const listed = (moeda: Moeda) => rows.filter((r) => r.l.moeda === moeda).reduce((s, r) => s + r.l.preco * (r.l.tipo === "pokemon" ? 1 : r.l.qtd), 0);
  const locked = wallets.filter((w) => w.withdrawLocked);

  return (
    <div className="space-y-4 sm:space-y-5">
      <AccountPicker value={sel} onChange={setSel} label="Ver" allowAll />

      {accs.length === 0 ? (
        <p className="card p-6 text-center text-sm text-mute">Nenhuma conta online.</p>
      ) : data.loading && !data.data ? (
        <Loading text="Lendo as carteiras…" />
      ) : data.error && !data.data ? (
        <ErrorBox error={data.error} onRetry={data.reload} />
      ) : (
        <>
          <section className="space-y-2" aria-label={all ? "Saldo de todas as contas" : `Saldo de ${targets[0]?.nick ?? ""}`}>
            <div className="grid grid-cols-2 gap-2">
              <div className="card min-w-0 p-3 sm:p-4">
                <p className="label">Gemas</p>
                <p className="mt-2 flex items-center gap-1.5 text-2xl font-extrabold tnum sm:text-3xl">
                  <Coin kind="gem" size={26} />
                  {fmtInt(gems)}
                </p>
                {rate ? <p className="mt-1 text-sm font-bold text-poke-green tnum">≈ {fmtUsd(gems * rate)}</p> : null}
              </div>
              <div className="card min-w-0 p-3 sm:p-4">
                <p className="label">Gold</p>
                <Money v={gold} moeda="gold" short className="mt-2 text-2xl font-extrabold sm:text-3xl [&_img]:size-6" />
                <p className="mt-1 text-sm text-mute tnum">{fmtInt(gold)}</p>
              </div>
            </div>

            {all && targets.length > 1 && (
              <ul className="grid grid-cols-2 gap-1.5 lg:grid-cols-4">
                {targets.map((a) => {
                  const w = wallets.find((x) => x.account === a.id);
                  return (
                    <li key={a.id} className="tile min-w-0 px-3 py-2">
                      <p className="truncate text-sm font-bold">{a.nick}</p>
                      <p className="mt-1 flex items-center justify-between gap-2 text-xs">
                        <Money v={a.gold} moeda="gold" short className="text-mute" />
                        <Money v={w?.balance ?? a.gems} moeda="orb" className="font-bold" />
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}

            {locked.map((w) => (
              <Notice key={w.account} tone="error">
                Saques travados em {w.nick}
                {w.withdrawLocked?.motivo ? `: ${w.withdrawLocked.motivo}` : "."} Fale com o suporte do jogo.
              </Notice>
            ))}
            <p className="flex items-center gap-1.5 px-1 text-xs text-mute">
              <Lock className="size-3.5 shrink-0" aria-hidden /> Somente leitura. Depósito e saque são feitos só dentro do jogo.
              {rate ? ` 1 Gema ≈ US$ ${rate.toFixed(4)} no saque.` : ""}
            </p>
          </section>

          <SellNow items={ov.data?.items ?? []} owned={owned} />

          <section className="space-y-2" aria-labelledby="my-listings">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
              <h2 id="my-listings" className="label">
                Meus anúncios {rows.length ? `(${rows.length})` : ""}
              </h2>
              {rows.length > 0 && (
                <p className="flex items-center gap-3 text-xs text-mute">
                  à venda
                  {listed("orb") > 0 && <Money v={listed("orb")} moeda="orb" short className="font-bold text-fg" />}
                  {listed("gold") > 0 && <Money v={listed("gold")} moeda="gold" short className="font-bold text-fg" />}
                </p>
              )}
            </div>
            {rows.length === 0 ? (
              <p className="card p-4 text-center text-sm text-mute">Nenhum anúncio aberto. Anuncie dentro do jogo e ele aparece aqui.</p>
            ) : (
              byAccount.map(([nick, list]) => (
                <div key={nick} className="space-y-1.5">
                  {all && byAccount.length > 1 && (
                    <p className="px-1 pt-1 text-sm font-bold">
                      {nick} <span className="font-normal text-mute">· {list.length} {list.length === 1 ? "anúncio" : "anúncios"}</span>
                    </p>
                  )}
                  <ul className="grid gap-1.5 lg:grid-cols-2">
                    {list.map((r) => (
                      <ListingCard key={`${nick}-${r.l.id}`} r={r} it={r.l.itemId != null ? market.get(r.l.itemId) : undefined} showNick={all && byAccount.length === 1} />
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>
        </>
      )}

      <CalcCard />

      {data.data && (
        <div className="space-y-2">
          <Fold title="Saques" count={withdrawals.length}>
            {withdrawals.length === 0 ? (
              <p className="p-4 text-center text-sm text-mute">Nenhum saque.</p>
            ) : (
              <ul className="max-h-[13rem] divide-y divide-line overflow-y-auto overscroll-contain">
                {withdrawals.map((s, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                    <span className="tnum">
                      −{fmtInt(s.orbs)} <span className="text-mute">· {fmtUsd(s.usdt)}</span>
                      {all && <span className="ml-2 text-xs text-mute">{s.nick}</span>}
                    </span>
                    <span className={`text-xs font-bold ${s.status === "confirmado" ? "text-poke-green" : s.status === "falhou" || s.status === "cancelado" ? "text-poke-red" : "text-poke-gold"}`}>
                      {s.recusado ? "Recusado" : (SAQUE_STATUS[s.status] ?? s.status)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Fold>
          <Fold title="Extrato" count={ledger.length}>
            {ledger.length === 0 ? (
              <p className="p-4 text-center text-sm text-mute">Sem movimento.</p>
            ) : (
              <ul className="max-h-[13rem] divide-y divide-line overflow-y-auto overscroll-contain">
                {ledger.slice(0, 100).map((l, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
                    <span className="min-w-0 truncate">
                      {MOTIVO[l.motivo] ?? l.motivo}
                      <span className="ml-2 text-xs text-mute">
                        {fmtWhen(l.em ?? l.ts)}
                        {all ? ` · ${l.nick}` : ""}
                      </span>
                    </span>
                    <span className={`tnum shrink-0 font-bold ${l.delta > 0 ? "text-poke-green" : "text-poke-red"}`}>
                      {l.delta > 0 ? "+" : ""}
                      {fmtInt(l.delta)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Fold>
        </div>
      )}
    </div>
  );
}
