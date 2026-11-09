import { useState } from "react";
import { Check2 } from "@/components/SettingsView";
import { ItemSprite } from "@/components/Sprites";
import { type Moeda, type TapeRow, marketApi } from "@/lib/market";
import { fmtInt } from "@/lib/utils";
import { AccountPicker, ErrorBox, Loading, Money, Pager, fmtWhen, useAsync } from "./shared";

type Mode = "global" | "vendas" | "compras";
const MODES: { id: Mode; label: string }[] = [
  { id: "global", label: "Tabela de preços" },
  { id: "vendas", label: "Minhas vendas" },
  { id: "compras", label: "Minhas compras" },
];
const TIPOS = [
  { id: "", label: "Tudo" },
  { id: "item", label: "Itens" },
  { id: "pokemon", label: "Pokémon" },
  { id: "deposito", label: "Depósitos" },
  { id: "saque", label: "Saques" },
];

function Variation({ row }: { row: TapeRow }) {
  const before = Number(row.anterior);
  if (row.anterior == null || !(before > 0) || row.bruto == null) return null;
  const pct = ((row.bruto - before) / before) * 100;
  if (Math.abs(pct) < 0.05) return <span className="text-xs text-mute">= 0%</span>;
  return (
    <span className={`tnum text-xs font-bold ${pct > 0 ? "text-poke-green" : "text-poke-red"}`} title={`Venda anterior: ${fmtInt(before)}`}>
      {pct > 0 ? "▲ +" : "▼ −"}
      {Math.abs(pct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
    </span>
  );
}

function Row({ r }: { r: TapeRow }) {
  if (r.tipo === "deposito" || r.tipo === "saque") {
    return (
      <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
        <span className="tnum w-28 shrink-0 text-xs text-mute">{fmtWhen(r.em)}</span>
        <span className="font-bold">{r.tipo === "deposito" ? "Depósito" : "Saque"}</span>
        <span className="tnum text-mute">
          US$ {r.usdt?.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} {r.rede ? `· ${r.rede}` : ""}
        </span>
        {r.status && r.status !== "confirmado" && <span className="text-xs text-poke-gold">{r.status}</span>}
      </li>
    );
  }
  const shiny = r.ficha?.shiny ? "✨ " : "";
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
      <span className="tnum w-28 shrink-0 text-xs text-mute">{fmtWhen(r.em)}</span>
      {r.itemIcon ? <ItemSprite icon={r.itemIcon} size={22} alt="" /> : null}
      <span className="min-w-0 flex-1 truncate font-semibold">
        {shiny}
        {r.descricao ?? "—"}
      </span>
      <span className="hidden truncate text-xs text-mute sm:block sm:max-w-[16rem]">
        {r.vendedor ?? "—"} → {r.comprador ?? "—"}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <Money v={r.bruto} moeda={(r.moeda ?? "gold") as Moeda} className="font-bold" />
        <Variation row={r} />
      </span>
    </li>
  );
}

/** Histórico: vendas do servidor inteiro (a referência de preço) e extrato da conta. */
export function HistoryTab({ account, onAccount }: { account: number | undefined; onAccount: (a: number | undefined) => void }) {
  const [mode, setMode] = useState<Mode>("global");
  const [tipo, setTipo] = useState("");
  const [moeda, setMoeda] = useState("");
  const [busca, setBusca] = useState("");
  const [applied, setApplied] = useState("");
  const [soShiny, setSoShiny] = useState(false);
  const [soP5, setSoP5] = useState(false);
  const [page, setPage] = useState(0);

  const res = useAsync(
    () => marketApi.tape({ mode, page, tipo, moeda, busca: applied, elemento: "", soShiny, soP5, account }),
    [mode, page, tipo, moeda, applied, soShiny, soP5, account],
    { every: 30000 },
  );
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
  };
  const rows = res.data?.rows ?? [];
  const showMoeda = tipo !== "deposito" && tipo !== "saque";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {MODES.map((m) => (
          <button key={m.id} className="btn" data-active={mode === m.id} onClick={() => reset(setMode)(m.id)}>
            {m.label}
          </button>
        ))}
        <span className="ml-auto">
          <AccountPicker value={account} onChange={onAccount} label="Conta" />
        </span>
      </div>
      <p className="text-xs text-mute">
        {mode === "global"
          ? "As vendas mais recentes de todo o servidor: é a referência para saber por quanto anunciar ou comprar. ▲/▼ compara com a venda anterior do mesmo item."
          : mode === "vendas"
            ? "O que a conta escolhida vendeu."
            : "O que a conta escolhida comprou."}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        {TIPOS.filter((t) => mode === "global" || (t.id !== "deposito" && t.id !== "saque")).map((t) => (
          <button key={t.id} className="btn" data-active={tipo === t.id} onClick={() => reset(setTipo)(t.id)}>
            {t.label}
          </button>
        ))}
        {showMoeda &&
          [
            { id: "", label: "Gold + Gemas" },
            { id: "gold", label: "Gold" },
            { id: "orb", label: "Gemas" },
          ].map((m) => (
            <button key={m.id} className="btn" data-active={moeda === m.id} onClick={() => reset(setMoeda)(m.id)}>
              {m.label}
            </button>
          ))}
      </div>

      {tipo === "pokemon" && (
        <form
          className="flex flex-wrap items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(busca.trim());
            setPage(0);
          }}
        >
          <input className="field" type="search" placeholder="Nome do Pokémon…" value={busca} onChange={(e) => setBusca(e.target.value)} maxLength={40} />
          <button className="btn" type="submit">
            Buscar
          </button>
          <Check2 checked={soShiny} onChange={reset(setSoShiny)}>
            ✨ Shiny
          </Check2>
          <Check2 checked={soP5} onChange={reset(setSoP5)}>
            P5
          </Check2>
        </form>
      )}

      {res.loading && !res.data ? (
        <Loading />
      ) : res.error && !res.data ? (
        <ErrorBox error={res.error} onRetry={res.reload} />
      ) : rows.length === 0 ? (
        <p className="card p-8 text-center text-sm text-mute">Nenhuma venda com esses filtros.</p>
      ) : (
        <>
          <ul className="card divide-y divide-line">
            {rows.map((r, i) => (
              <Row key={`${r.em}-${i}`} r={r} />
            ))}
          </ul>
          <Pager page={page} onPage={setPage} hasMore={res.data?.total != null ? (page + 1) * rows.length < res.data.total : rows.length >= 20} />
        </>
      )}
    </div>
  );
}
