import { useMemo, useState } from "react";
import { ItemSprite, PokemonSprite, ShinyMark } from "@/components/Sprites";
import { type Moeda, type TapeRow, marketApi } from "@/lib/market";
import { fmtInt } from "@/lib/utils";
import { AccountPicker, ErrorBox, Loading, Money, Pager, Seg, dayHeading, fmtTime, useAsync } from "./shared";

type Mode = "global" | "vendas" | "compras";
const TIPOS = [
  { id: "", label: "Tudo" },
  { id: "item", label: "Só itens" },
  { id: "pokemon", label: "Só Pokémon" },
  { id: "deposito", label: "Depósitos de Gemas" },
  { id: "saque", label: "Saques de Gemas" },
];

/** ▲/▼ contra a venda anterior do mesmo item. */
function Variation({ row }: { row: TapeRow }) {
  const before = Number(row.anterior);
  if (row.anterior == null || !(before > 0) || row.bruto == null) return null;
  const pct = ((row.bruto - before) / before) * 100;
  if (Math.abs(pct) < 0.05) return null;
  return (
    <span className={`tnum text-xs font-bold ${pct > 0 ? "text-poke-green" : "text-poke-red"}`} title={`Venda anterior: ${fmtInt(before)}`}>
      {pct > 0 ? "▲ +" : "▼ −"}
      {Math.abs(pct).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
    </span>
  );
}

function Row({ r, mode }: { r: TapeRow; mode: Mode }) {
  const when = r.em ? fmtTime(r.em) : "";
  if (r.tipo === "deposito" || r.tipo === "saque") {
    return (
      <li className="flex items-center gap-3 px-3 py-2.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-void text-lg">{r.tipo === "deposito" ? "⬇" : "⬆"}</span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">{r.tipo === "deposito" ? "Depósito de Gemas" : "Saque de Gemas"}</p>
          <p className="text-xs text-mute">
            {when} {r.rede ? `· ${r.rede}` : ""} {r.status && r.status !== "confirmado" ? `· ${r.status}` : ""}
          </p>
        </div>
        <span className="tnum font-bold">US$ {r.usdt?.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</span>
      </li>
    );
  }
  const f = r.ficha;
  const who = mode === "vendas" ? `para ${r.comprador ?? "?"}` : mode === "compras" ? `de ${r.vendedor ?? "?"}` : `${r.vendedor ?? "?"} → ${r.comprador ?? "?"}`;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span className="grid size-10 shrink-0 place-items-center">
        {r.tipo === "pokemon" ? <PokemonSprite looktype={f?.looktype} size={40} /> : <ItemSprite icon={r.itemIcon} size={36} alt="" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 font-bold">
          <span className="truncate">{r.descricao ?? "—"}</span>
          {f?.shiny && <ShinyMark />}
        </p>
        <p className="truncate text-xs text-mute">
          {when} · {who}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <Money v={r.bruto} moeda={(r.moeda ?? "gold") as Moeda} className="font-bold" />
        <Variation row={r} />
      </div>
    </li>
  );
}

/** Vendas: o que está sendo vendido no servidor (referência de preço) e o extrato da conta, agrupado por dia. */
export function HistoryTab() {
  const [mode, setMode] = useState<Mode>("global");
  const [account, setAccount] = useState<number | undefined>(undefined);
  const [tipo, setTipo] = useState("");
  const [moeda, setMoeda] = useState("");
  const [busca, setBusca] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(0);
  const personal = mode !== "global";
  const gemsOnly = tipo === "deposito" || tipo === "saque";

  const res = useAsync(
    () => marketApi.tape({ mode, page, tipo, moeda: gemsOnly ? "" : moeda, busca: applied, elemento: "", soShiny: false, soP5: false, account: personal ? account : undefined }),
    [mode, page, tipo, moeda, applied, account, personal],
    { every: 30000, skip: personal && account === undefined },
  );
  const go = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
  };
  const rows = res.data?.rows ?? [];

  const groups = useMemo(() => {
    const out: { day: string; rows: TapeRow[] }[] = [];
    for (const r of rows) {
      const day = r.em ? dayHeading(r.em) : "—";
      const last = out[out.length - 1];
      if (last && last.day === day) last.rows.push(r);
      else out.push({ day, rows: [r] });
    }
    return out;
  }, [rows]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Seg
          label="Qual histórico"
          value={mode}
          onChange={go(setMode)}
          options={[
            { id: "global", label: "Servidor" },
            { id: "vendas", label: "Minhas vendas" },
            { id: "compras", label: "Minhas compras" },
          ]}
        />
        {personal && <AccountPicker value={account} onChange={setAccount} label="" />}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className="field" value={tipo} onChange={(e) => go(setTipo)(e.target.value)} aria-label="Tipo">
          {TIPOS.filter((t) => mode === "global" || (t.id !== "deposito" && t.id !== "saque")).map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        {!gemsOnly && (
          <select className="field" value={moeda} onChange={(e) => go(setMoeda)(e.target.value)} aria-label="Moeda">
            <option value="">Gold e Gemas</option>
            <option value="gold">Só Gold</option>
            <option value="orb">Só Gemas</option>
          </select>
        )}
        {tipo === "pokemon" && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setApplied(busca.trim());
              setPage(0);
            }}
          >
            <input className="field w-40" type="search" placeholder="Nome do Pokémon" value={busca} onChange={(e) => setBusca(e.target.value)} maxLength={40} />
            <button className="btn" type="submit">
              Buscar
            </button>
          </form>
        )}
      </div>

      <p className="text-xs text-mute">
        {mode === "global"
          ? "As vendas mais recentes de todo o servidor. Use como referência de preço. ▲/▼ compara com a venda anterior do mesmo item."
          : mode === "vendas"
            ? "O que a conta escolhida vendeu."
            : "O que a conta escolhida comprou."}
      </p>

      {res.loading && !res.data ? (
        <Loading />
      ) : res.error && !res.data ? (
        <ErrorBox error={res.error} onRetry={res.reload} />
      ) : rows.length === 0 ? (
        <p className="card p-8 text-center text-sm text-mute">Nenhuma venda com esses filtros.</p>
      ) : (
        <>
          <div className="space-y-3">
            {groups.map((g) => (
              <section key={g.day}>
                <h3 className="label mb-1.5 px-1">{g.day}</h3>
                <ul className="card divide-y divide-line">
                  {g.rows.map((r, i) => (
                    <Row key={`${r.em}-${i}`} r={r} mode={mode} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <Pager page={page} onPage={setPage} hasMore={res.data?.total != null ? (page + 1) * rows.length < res.data.total : rows.length >= 20} />
        </>
      )}
    </div>
  );
}
