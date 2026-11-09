import { Lock } from "lucide-react";
import { useCallback, useState } from "react";
import { Notice } from "@/components/SettingsView";
import { Coin } from "@/components/ui";
import { type Listing, type Wallet, marketApi } from "@/lib/market";
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

interface Mine {
  account: number;
  nick: string;
  now: number;
  listings: Listing[];
}

/** Minha conta: saldo (de uma conta ou de todas somadas), saques, extrato, anúncios e a calculadora de venda. */
export function MineTab() {
  const accs = useOnlineAccounts();
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

  const wallets: Wallet[] = data.data?.wallets ?? [];
  const gems = wallets.reduce((s, w) => s + (w.balance ?? 0), 0);
  const gold = targets.reduce((s, a) => s + a.gold, 0);
  const rate = wallets.find((w) => w.prices.saque)?.prices.saque;
  const withdrawals = wallets.flatMap((w) => w.withdrawals.map((x) => ({ ...x, nick: w.nick })));
  const ledger = wallets
    .flatMap((w) => w.ledger.map((x) => ({ ...x, nick: w.nick })))
    .sort((a, b) => (b.em ?? b.ts ?? 0) - (a.em ?? a.ts ?? 0));
  const mine = (data.data?.mines ?? []).flatMap((m) => m.listings.map((l) => ({ l, nick: m.nick, drift: m.now - Date.now() })));
  const locked = wallets.filter((w) => w.withdrawLocked);

  return (
    <div className="space-y-3 sm:space-y-4">
      <AccountPicker value={sel} onChange={setSel} label="Ver" allowAll />

      {accs.length === 0 ? (
        <p className="card p-6 text-center text-sm text-mute">Nenhuma conta online.</p>
      ) : data.loading && !data.data ? (
        <Loading text="Lendo as carteiras…" />
      ) : data.error && !data.data ? (
        <ErrorBox error={data.error} onRetry={data.reload} />
      ) : (
        <>
          <section className="card space-y-3 p-3 sm:p-4">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <div>
                <p className="label">{all ? "Saldo de todas as contas" : `Saldo — ${targets[0]?.nick ?? ""}`}</p>
                <p className="flex items-center gap-2 text-3xl font-extrabold tnum">
                  <Coin kind="gem" size={30} />
                  {fmtInt(gems)}
                </p>
                {rate ? <p className="text-sm font-bold text-poke-green tnum">≈ {fmtUsd(gems * rate)}</p> : null}
              </div>
              <div className="text-right">
                <p className="label">Gold</p>
                <Money v={gold} moeda="gold" className="text-xl font-bold" />
              </div>
            </div>

            {all && targets.length > 1 && (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {targets.map((a) => {
                  const w = wallets.find((x) => x.account === a.id);
                  return (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate font-semibold">{a.nick}</span>
                      <Money v={a.gold} moeda="gold" short />
                      <Money v={w?.balance ?? a.gems} moeda="orb" className="w-20 justify-end font-bold" />
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
            <p className="flex items-center gap-1.5 text-xs text-mute">
              <Lock className="size-3.5" aria-hidden /> Somente leitura. Depósito e saque são feitos só dentro do jogo.
              {rate ? ` 1 Gema ≈ US$ ${rate.toFixed(4)} no saque.` : ""}
            </p>
          </section>

          <div className="grid gap-3 md:grid-cols-2">
            <section className="flex flex-col gap-1.5">
              <h2 className="label px-1">Saques</h2>
              {withdrawals.length === 0 ? (
                <p className="card flex-1 p-4 text-center text-sm text-mute">Nenhum saque.</p>
              ) : (
                <ul className="card max-h-[28rem] flex-1 divide-y divide-line overflow-y-auto">
                  {withdrawals.slice(0, 12).map((s, i) => (
                    <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
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
            </section>
            <section className="flex flex-col gap-1.5">
              <h2 className="label px-1">Extrato</h2>
              {ledger.length === 0 ? (
                <p className="card flex-1 p-4 text-center text-sm text-mute">Sem movimento.</p>
              ) : (
                <ul className="card max-h-[28rem] flex-1 divide-y divide-line overflow-y-auto">
                  {ledger.slice(0, 60).map((l, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
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
            </section>
          </div>

          <section className="space-y-1.5">
            <h2 className="label px-1">Meus anúncios {mine.length ? `(${mine.length})` : ""}</h2>
            {mine.length === 0 ? (
              <p className="card p-4 text-center text-sm text-mute">Nenhum anúncio aberto.</p>
            ) : (
              <ul className="card divide-y divide-line">
                {mine.map(({ l, nick, drift }) => {
                  const left = l.expiraEm ? Math.max(0, Math.round((l.expiraEm - (Date.now() + drift)) / 1000)) : null;
                  return (
                    <li key={`${nick}-${l.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate font-semibold">
                        {l.tipo === "pokemon" ? `${l.ficha?.shiny ? "✨ " : ""}${l.ficha?.nome ?? "Pokémon"} nv. ${l.ficha?.level ?? "?"}` : `${fmtInt(l.qtd)}× ${l.ficha?.nome ?? `item #${l.itemId}`}`}
                        {all && <span className="ml-2 text-xs font-normal text-mute">{nick}</span>}
                      </span>
                      <Money v={l.preco} moeda={l.moeda} className="font-bold" />
                      {left != null && <span className="text-xs text-mute">expira em {secondsLabel(left)}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      <CalcCard />
    </div>
  );
}
