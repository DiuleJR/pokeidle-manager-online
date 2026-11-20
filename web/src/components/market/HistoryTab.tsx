import { PokemonSelos } from "@/components/PokemonSelos";
import { sheetTrigger, useSheet } from "@/lib/sheet";
import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { ItemSprite, PokemonSprite, ShinyMark, lookOf } from "@/components/Sprites";
import { type Moeda, type TapeRow, marketApi } from "@/lib/market";
import { fmtInt } from "@/lib/utils";
import { useItemLabel } from "@/lib/lang";
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
  const L = useItemLabel();
  const openSheet = useSheet();
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
  const canOpen = r.tipo === "pokemon" && !!f && (!!f.stats || !!f.ivs);
  const who = mode === "vendas" ? `para ${r.comprador ?? "?"}` : mode === "compras" ? `de ${r.vendedor ?? "?"}` : `${r.vendedor ?? "?"} → ${r.comprador ?? "?"}`;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <div
        className={`flex min-w-0 flex-1 items-center gap-3 ${canOpen ? "-m-1 cursor-pointer rounded-lg p-1 transition-colors hover:bg-white/5" : ""}`}
        {...(canOpen ? { "aria-label": `Abrir a ficha de ${r.descricao ?? "Pokémon"}`, ...sheetTrigger((el) => openSheet({ kind: "pokemon", pokemon: { ...f, dono: r.vendedor ?? undefined } }, el)) } : {})}
      >
      <span className="grid size-10 shrink-0 place-items-center">
        {r.tipo === "pokemon" ? <PokemonSprite looktype={lookOf(f as never)} size={40} /> : r.itemIcon ? <ItemSprite icon={r.itemIcon} size={36} alt="" /> : <span className="text-2xl" aria-hidden>📦</span>}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 font-bold">
          <span className="truncate">{L(r.descricao) || "—"}</span>
          {f?.shiny && <ShinyMark />}
        </p>
        {r.tipo === "pokemon" && f && <PokemonSelos pk={f as never} compact className="my-1" />}
        <p className="truncate text-xs text-mute">
          {when} · {who}
        </p>
      </div>
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
  const [item, setItem] = useState<{ id: number; name: string } | null>(null); // item escolhido na busca
  const [showList, setShowList] = useState(false);
  const [page, setPage] = useState(0);
  const L = useItemLabel();
  const canSearch = tipo === "" || tipo === "item" || tipo === "pokemon";
  const ov = useAsync(() => marketApi.overview(), [], { every: 300000, skip: !(tipo === "" || tipo === "item") });
  const names = useAsync(() => marketApi.pokemonNames(), [], { skip: !(tipo === "" || tipo === "pokemon") });
  type Hit = { kind: "item"; id: number; name: string; icon: string | null } | { kind: "pokemon"; name: string };
  const hits = useMemo<Hit[]>(() => {
    const q = busca.trim().toLowerCase();
    if (!q || item || applied) return [];
    const out: Hit[] = [];
    if (tipo !== "pokemon") for (const i of ov.data?.items ?? []) if (i.name.toLowerCase().includes(q) || L(i.name, i.id).toLowerCase().includes(q)) out.push({ kind: "item", id: i.id, name: i.name, icon: i.icon });
    if (tipo !== "item") for (const n of names.data?.names ?? []) if (n.toLowerCase().includes(q)) out.push({ kind: "pokemon", name: n });
    // quem começa com o texto vem primeiro
    return out.sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q))).slice(0, 8);
  }, [ov.data, names.data, busca, item, applied, tipo, L]);
  const pick = (h: Hit) => {
    setShowList(false);
    setPage(0);
    if (h.kind === "item") {
      setTipo("item");
      setItem({ id: h.id, name: h.name });
      setApplied("");
      setBusca(L(h.name, h.id));
    } else {
      setTipo("pokemon");
      setItem(null);
      setApplied(h.name);
      setBusca(h.name);
    }
  };
  const clearSearch = () => {
    setItem(null);
    setApplied("");
    setBusca("");
    setPage(0);
  };
  const personal = mode !== "global";
  const gemsOnly = tipo === "deposito" || tipo === "saque";

  const res = useAsync(
    () => marketApi.tape({ mode, page, tipo, moeda: gemsOnly ? "" : moeda, itemId: tipo === "item" ? item?.id : undefined, busca: applied, elemento: "", soShiny: false, soP5: false, account: personal ? account : undefined }),
    [mode, page, tipo, moeda, applied, item, account, personal],
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
        <select className="field" value={tipo} onChange={(e) => {
            setItem(null);
            setBusca("");
            setApplied("");
            go(setTipo)(e.target.value);
          }} aria-label="Tipo">
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
        {canSearch && (
          <form
            className="relative flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (hits[0]) pick(hits[0]);
              else if (tipo === "pokemon" && busca.trim()) {
                setApplied(busca.trim());
                setPage(0);
                setShowList(false);
              }
            }}
          >
            <div className="relative">
              <input
                className="field w-52 pr-8"
                type="search"
                placeholder={tipo === "item" ? "Nome do item" : tipo === "pokemon" ? "Nome do Pokémon" : "Nome do item ou Pokémon"}
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value);
                  setItem(null);
                  setApplied("");
                  setShowList(true);
                  setPage(0);
                }}
                onFocus={() => setShowList(true)}
                onBlur={() => window.setTimeout(() => setShowList(false), 120)}
                maxLength={40}
                aria-label="Buscar pelo nome"
                aria-autocomplete="list"
              />
              {(item || applied) && (
                <button type="button" onClick={clearSearch} aria-label="Limpar a busca" className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-mute hover:text-fg">
                  <X className="size-4" aria-hidden />
                </button>
              )}
              {showList && hits.length > 0 && (
                <ul role="listbox" className="absolute left-0 top-full z-30 mt-1 max-h-72 w-72 max-w-[calc(100vw-2rem)] overflow-auto rounded-xl border border-edge bg-surface p-1 shadow-xl">
                  {hits.map((h) => (
                    <li key={h.kind === "item" ? `i${h.id}` : `p${h.name}`} role="option" aria-selected="false">
                      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-semibold hover:bg-tile">
                        {h.kind === "item" ? <ItemSprite icon={h.icon} size={26} alt="" /> : <span className="grid size-[26px] shrink-0 place-items-center text-base" aria-hidden>🐾</span>}
                        <span className="min-w-0 flex-1 truncate">{h.kind === "item" ? L(h.name, h.id) : h.name}</span>
                        {tipo === "" && <span className="shrink-0 text-[11px] font-medium text-mute">{h.kind === "item" ? "Item" : "Pokémon"}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button className="btn" type="submit">
              <Search className="size-4" aria-hidden /> Buscar
            </button>
          </form>
        )}
      </div>

      <p className="text-xs text-mute">
        {mode === "global"
          ? canSearch && !item && !applied
            ? "As vendas mais recentes de todo o servidor. Digite um nome e escolha na lista para ver só as vendas dele. ▲/▼ compara com a venda anterior do mesmo item."
            : "As vendas mais recentes de todo o servidor. Use como referência de preço. ▲/▼ compara com a venda anterior do mesmo item."
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
