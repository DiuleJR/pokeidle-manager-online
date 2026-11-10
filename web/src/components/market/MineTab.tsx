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

/** Uma linha por anúncio: o que é, de qual conta, quando expira; à direita o preço e como ele está no mercado. */
function ListingRow({ r, it }: { r: Row; it?: MarketItem }) {
  const { l, drift } = r;
  const left = l.expiraEm ? Math.max(0, Math.round((l.expiraEm - (Date.now() + drift)) / 1000)) : null;
  const isMon = l.tipo === "pokemon";
  const name = isMon ? `${l.ficha?.nome ?? "Pokémon"} nv. ${l.ficha?.level ?? "?"}` : (l.ficha?.nome ?? it?.name ?? `item #${l.itemId}`);
  const floor = !isMon && it ? (l.moeda === "orb" ? it.minOrb : it.minGold) : null;
  const avg = !isMon && it ? (l.moeda === "orb" ? it.avgOrb : it.avgGold) : null;
  const vsAvg = avg ? l.preco / avg - 1 : null;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span className="grid size-10 shrink-0 place-items-center">
        {isMon ? <PokemonSprite looktype={l.ficha?.looktype} size={40} /> : <ItemSprite icon={it?.icon} size={36} alt="" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 font-bold leading-tight">
          <span className="truncate">{name}</span>
          {isMon && l.ficha?.shiny && <ShinyMark />}
          {!isMon && l.qtd > 1 && <span className="shrink-0 font-semibold text-mute">×{fmtInt(l.qtd)}</span>}
        </p>
        <p className="mt-0.5 truncate text-xs text-mute">
          {r.nick}
          {left != null && (
            <>
              {" · "}
              <span className={left < DAY ? "font-semibold text-poke-red" : ""}>expira em {secondsLabel(left)}</span>
            </>
          )}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <Money v={l.preco} moeda={l.moeda} className="text-base font-extrabold" />
        {floor != null && (
          <p className={`text-xs ${l.preco <= floor ? "font-semibold text-poke-green" : "text-mute"}`} title={`Menor preço do mercado: ${fmtInt(floor)}`}>
            {l.preco <= floor ? "menor preço" : `+${Math.round(((l.preco - floor) / floor) * 100)}% do menor`}
            {vsAvg != null && vsAvg >= CARO && <span className="font-semibold text-poke-gold"> · +{Math.round(vsAvg * 100)}% da média</span>}
          </p>
        )}
      </div>
    </li>
  );
}

/** Itens raros que estão caros em Gemas agora (acima da média de 7 dias). Os que eu tenho vêm primeiro. */
function SellNow({ items, owned }: { items: MarketItem[]; owned: Map<number, number> }) {
  const hot = useMemo(() => {
    const out: { it: MarketItem; qty: number; floor: number; avg: number; prem: number }[] = [];
    for (const it of items) {
      if (!it.rare) continue;
      const p = premiumOf(it, "orb"); // só Gemas
      if (p && p.prem >= CARO) out.push({ it, qty: owned.get(it.id) ?? 0, ...p });
    }
    return out.sort((a, b) => Number(b.qty > 0) - Number(a.qty > 0) || b.prem - a.prem).slice(0, 8);
  }, [items, owned]);

  return (
    <section className="space-y-1.5" aria-labelledby="sell-now">
      <h2 id="sell-now" className="label flex items-center gap-1.5 px-1">
        <TrendingUp className="size-4 text-poke-gold" aria-hidden /> Hora de vender
      </h2>
      {hot.length === 0 ? (
        <p className="tile px-3 py-2.5 text-sm text-mute">Nenhum item raro está caro em Gemas agora. Avisamos no Discord quando um que você tem ficar.</p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {hot.map(({ it, qty, floor, avg, prem }) => (
            <li key={it.id} className={`tile flex items-center gap-3 p-2.5 ${qty ? "tile-gold" : ""}`}>
              <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-line bg-void/40">
                <ItemSprite icon={it.icon} size={36} alt="" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold leading-tight text-fg">{it.name}</p>
                <p className="mt-1 text-xs text-mute">
                  {qty ? (
                    <>
                      você tem <b className="text-fg">{fmtInt(qty)}</b>
                    </>
                  ) : (
                    "você não tem"
                  )}{" "}
                  · média <Money v={avg} moeda="orb" short className="text-mute" />
                </p>
              </div>
              <div className="shrink-0 text-right">
                <Money v={floor} moeda="orb" short className="font-extrabold text-fg" />
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
    for (const a of targets) for (const it of accounts[a.key]?.inventory?.items ?? []) if (it.rare) m.set(it.id, (m.get(it.id) ?? 0) + it.qty); // só itens raros
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
  const groups = useMemo(() => {
    const items = rows.filter((r) => r.l.tipo !== "pokemon").sort((x, y) => (x.l.ficha?.nome ?? market.get(x.l.itemId ?? 0)?.name ?? "").localeCompare(y.l.ficha?.nome ?? market.get(y.l.itemId ?? 0)?.name ?? "") || x.nick.localeCompare(y.nick));
    const mons = rows.filter((r) => r.l.tipo === "pokemon").sort((x, y) => y.l.preco - x.l.preco);
    return [
      { title: "Itens", list: items },
      { title: "Pokémon", list: mons },
    ].filter((g) => g.list.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.data, market]);
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
              <div className="card divide-y divide-line overflow-hidden">
                {groups.map((g) => (
                  <div key={g.title}>
                    <p className="bg-void/40 px-3 py-1.5 text-xs font-semibold text-mute">
                      {g.title} <span className="font-normal">({g.list.length})</span>
                    </p>
                    <ul className="divide-y divide-line">
                      {g.list.map((r) => (
                        <ListingRow key={`${r.nick}-${r.l.id}`} r={r} it={r.l.itemId != null ? market.get(r.l.itemId) : undefined} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
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
