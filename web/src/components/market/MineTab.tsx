import { Lock } from "lucide-react";
import { Notice } from "@/components/SettingsView";
import { Coin } from "@/components/ui";
import { marketApi } from "@/lib/market";
import { fmtInt } from "@/lib/utils";
import { AccountPicker, ErrorBox, Loading, Money, fmtWhen, secondsLabel, useAsync } from "./shared";

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

function WalletCard({ account }: { account: number | undefined }) {
  const w = useAsync(() => marketApi.wallet(account), [account], { every: 60000 });
  if (w.loading && !w.data) return <Loading text="Lendo a carteira…" />;
  if (w.error && !w.data) return <ErrorBox error={w.error} onRetry={w.reload} />;
  const d = w.data;
  if (!d) return null;
  const usd = d.balance != null && d.prices.saque ? d.balance * d.prices.saque : null;
  return (
    <section className="card space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold sm:text-lg">Carteira de Gemas — {d.nick}</h2>
          <p className="flex items-center gap-1.5 text-xs text-mute">
            <Lock className="size-3.5" aria-hidden /> Somente leitura. Depósito e saque são feitos só dentro do jogo.
          </p>
        </div>
        <div className="text-right">
          <p className="flex items-center justify-end gap-1.5 text-2xl font-extrabold tnum">
            <Coin kind="gem" size={24} />
            {fmtInt(d.balance ?? 0)}
          </p>
          {usd != null && <p className="text-xs text-mute">≈ US$ {usd.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} no saque</p>}
        </div>
      </div>

      {d.withdrawLocked && <Notice tone="error">Saques travados nesta conta{d.withdrawLocked.motivo ? `: ${d.withdrawLocked.motivo}` : "."} Fale com o suporte do jogo.</Notice>}

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="tile p-2">
          <p className="text-mute">Compra</p>
          <p className="tnum font-bold">US$ {d.prices.compra?.toFixed(4) ?? "—"} /gema</p>
        </div>
        <div className="tile p-2">
          <p className="text-mute">Saque</p>
          <p className="tnum font-bold">US$ {d.prices.saque?.toFixed(4) ?? "—"} /gema</p>
        </div>
        <div className="tile p-2">
          <p className="text-mute">Saque mínimo</p>
          <p className="tnum font-bold">{d.prices.minimo != null ? fmtInt(d.prices.minimo) : "—"}</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <h3 className="label mb-1.5">Saques</h3>
          {d.withdrawals.length === 0 ? (
            <p className="text-sm text-mute">Nenhum saque.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {d.withdrawals.slice(0, 15).map((s, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-sm">
                  <span className="tnum">
                    −{fmtInt(s.orbs)} · US$ {s.usdt?.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
                  </span>
                  <span className={`text-xs font-bold ${s.status === "confirmado" ? "text-poke-green" : s.status === "falhou" || s.status === "cancelado" ? "text-poke-red" : "text-poke-gold"}`}>
                    {s.recusado ? "Recusado" : (SAQUE_STATUS[s.status] ?? s.status)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="label mb-1.5">Extrato</h3>
          {d.ledger.length === 0 ? (
            <p className="text-sm text-mute">Sem movimento.</p>
          ) : (
            <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
              {d.ledger.map((l, i) => (
                <li key={i} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                  <span className="min-w-0 truncate">
                    {MOTIVO[l.motivo] ?? l.motivo}
                    {(l.em ?? l.ts) ? <span className="ml-2 text-xs text-mute">{fmtWhen(l.em ?? l.ts)}</span> : null}
                  </span>
                  <span className={`tnum shrink-0 font-bold ${l.delta > 0 ? "text-poke-green" : "text-poke-red"}`}>
                    {l.delta > 0 ? "+" : ""}
                    {fmtInt(l.delta)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function MyListings({ account }: { account: number | undefined }) {
  const m = useAsync(() => marketApi.mine(account), [account], { every: 30000 });
  if (m.loading && !m.data) return <Loading />;
  if (m.error && !m.data) return <ErrorBox error={m.error} onRetry={m.reload} />;
  const rows = m.data?.listings ?? [];
  const drift = m.data ? m.data.now - Date.now() : 0;
  return (
    <section className="space-y-2">
      <h2 className="text-base font-extrabold sm:text-lg">Meus anúncios</h2>
      {rows.length === 0 ? (
        <p className="card p-6 text-center text-sm text-mute">Esta conta não tem anúncios abertos.</p>
      ) : (
        <ul className="card divide-y divide-line">
          {rows.map((l) => {
            const left = l.expiraEm ? Math.max(0, Math.round((l.expiraEm - (Date.now() + drift)) / 1000)) : null;
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {l.tipo === "pokemon" ? `${l.ficha?.shiny ? "✨ " : ""}${l.ficha?.nome ?? "Pokémon"} nv. ${l.ficha?.level ?? "?"}` : `${fmtInt(l.qtd)}× ${l.ficha?.nome ?? `item #${l.itemId}`}`}
                </span>
                <Money v={l.preco} moeda={l.moeda} className="font-bold" />
                {left != null && <span className="text-xs text-mute">expira em {secondsLabel(left)}</span>}
                <span className="text-xs text-mute">{l.estado ?? ""}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Minha conta: carteira de Gemas (só leitura) e anúncios abertos. */
export function MineTab({ account, onAccount }: { account: number | undefined; onAccount: (a: number | undefined) => void }) {
  return (
    <div className="space-y-3 sm:space-y-4">
      <AccountPicker value={account} onChange={onAccount} />
      <WalletCard account={account} />
      <MyListings account={account} />
    </div>
  );
}
