import { useState } from "react";
import { Modal, Notice } from "@/components/SettingsView";
import { type BuyResult, type Listing, marketApi } from "@/lib/market";
import { fmtInt } from "@/lib/utils";
import { Money, errMsg, useOnlineAccounts } from "./shared";

const RESULT_TEXT: Record<BuyResult["status"], { tone: "ok" | "warn" | "error"; text: string }> = {
  comprado: { tone: "ok", text: "Compra feita!" },
  perdeu_sorteio: { tone: "warn", text: "Mais de um jogador tentou comprar ao mesmo tempo e você perdeu o sorteio. Nada foi cobrado." },
  recusado: { tone: "error", text: "O jogo recusou a compra." },
  timeout: { tone: "error", text: "O jogo não respondeu. Confira o saldo e o anúncio antes de tentar de novo." },
};

/** Compra manual de um anúncio. Pede confirmação com o total e mostra o resultado. */
export function BuyDialog({ listing, name, onClose, onDone }: { listing: Listing; name: string; onClose: () => void; onDone: () => void }) {
  const accs = useOnlineAccounts();
  const [account, setAccount] = useState<number | undefined>(undefined);
  const acc = accs.find((a) => a.id === account) ?? accs[0];
  const maxQty = listing.tipo === "pokemon" ? 1 : listing.qtd;
  const [qty, setQty] = useState(maxQty);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<BuyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const total = listing.preco * qty;
  const balance = acc ? (listing.moeda === "orb" ? acc.gems : acc.gold) : 0;
  const short = !!acc && total > balance;

  const go = async () => {
    if (!acc) return;
    setBusy(true);
    setError(null);
    try {
      const r = await marketApi.buy({ listing_id: listing.id, qty, price: listing.preco, moeda: listing.moeda, account_id: acc.id });
      setRes(r);
      onDone();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const outcome = res ? RESULT_TEXT[res.status] : null;
  return (
    <Modal title={`Comprar ${name}`} onClose={onClose}>
      {!res && (
        <>
          <div className="tile space-y-1 p-3 text-sm">
            <p>
              Vendedor: <b>{listing.vendedor}</b>
            </p>
            <p className="flex items-center gap-2">
              Preço por unidade: <Money v={listing.preco} moeda={listing.moeda} />
            </p>
          </div>
          {accs.length === 0 ? (
            <Notice tone="warn">Nenhuma conta online para comprar.</Notice>
          ) : (
            <>
              <label className="block space-y-1.5">
                <span className="label block">Conta que compra</span>
                <select className="field w-full" value={acc?.id} onChange={(e) => setAccount(Number(e.target.value))}>
                  {accs.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nick}
                    </option>
                  ))}
                </select>
              </label>
              {maxQty > 1 && (
                <label className="block space-y-1.5">
                  <span className="label block">Quantidade (máx. {fmtInt(maxQty)})</span>
                  <input className="field w-full" inputMode="numeric" value={qty} onChange={(e) => setQty(Math.min(maxQty, Math.max(1, Math.floor(Number(e.target.value.replace(/\D/g, "")) || 1))))} />
                </label>
              )}
              <p className="flex items-center justify-between rounded-lg border border-line bg-tile px-3 py-2 text-sm">
                <span>Total</span>
                <Money v={total} moeda={listing.moeda} className="text-base font-bold" />
              </p>
              <p className="text-xs text-mute">
                Saldo da conta: <Money v={balance} moeda={listing.moeda} />
              </p>
              {short && <Notice tone="error">Saldo insuficiente nesta conta.</Notice>}
              {listing.moeda === "orb" && <Notice tone="warn">Gemas valem dinheiro real. Confira o item e o vendedor antes de confirmar.</Notice>}
              <p className="text-xs text-mute">Se mais alguém tentar comprar o mesmo anúncio junto com você, o jogo faz um sorteio. Quem perde não paga nada.</p>
            </>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex justify-end gap-2">
            <button className="btn" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button className="btn" data-active="true" onClick={go} disabled={busy || !acc || short}>
              {busy ? "Comprando…" : "Confirmar compra"}
            </button>
          </div>
        </>
      )}
      {res && outcome && (
        <>
          <Notice tone={outcome.tone}>
            {outcome.text}
            {res.detail && res.status !== "comprado" ? ` (${res.detail})` : ""}
          </Notice>
          <div className="flex justify-end">
            <button className="btn" data-active="true" onClick={onClose}>
              Fechar
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
