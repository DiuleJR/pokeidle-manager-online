import { AnimatePresence } from "framer-motion";
import { Bell, Check, ChevronDown, Crosshair, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Check2, Labeled, Modal, Notice } from "@/components/SettingsView";
import { TypeChip } from "@/components/HuntRow";
import { ItemSprite, PokemonSprite } from "@/components/Sprites";
import { Coin, ConfirmDialog } from "@/components/ui";
import { MOEDA_LABEL, type LogRow, type MarketItem, type Moeda, type Rule, type RuleSpec, marketApi, ruleAccountIds } from "@/lib/market";
import { type Creature, useCreatures } from "@/lib/actions";
import { useAccountIds, useAccountsMap } from "@/lib/telemetry";
import { fmtInt } from "@/lib/utils";
import { CurrencyToggle, ErrorBox, Loading, Seg, errMsg, fmtWhen, useAsync } from "./shared";

const ELEMENTS = ["", "NORMAL", "FIRE", "WATER", "GRASS", "ELECTRIC", "ICE", "FIGHTING", "POISON", "GROUND", "FLYING", "PSYCHIC", "BUG", "ROCK", "GHOST", "DRAGON", "DARK", "STEEL", "FAIRY"];

export const emptySpec = (over: Partial<RuleSpec> = {}): RuleSpec => ({
  target: "item",
  item_id: null,
  moeda: "gold",
  max_price: 0,
  below_avg_pct: 0,
  busca: "",
  elemento: "",
  so_shiny: false,
  so_p5: false,
  iv_min: null,
  nivel_min: null,
  account_id: null,
  account_ids: [],
  qty_max: 0,
  budget_daily: 0,
  poll_s: 10,
  ...over,
});

const clampOrNull = (s: string, lo: number, hi: number) => (s.replace(/\D/g, "") === "" ? null : Math.min(hi, Math.max(lo, Number(s.replace(/\D/g, "")))));
const digits = (s: string) => Math.max(0, Math.floor(Number(s.replace(/\D/g, "")) || 0));
const floorOf = (it: MarketItem | undefined, m: Moeda) => (it ? (m === "orb" ? it.minOrb : it.minGold) : null);
const avgOf = (it: MarketItem | undefined, m: Moeda) => (it ? (m === "orb" ? it.avgOrb : it.avgGold) : null);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5 border-t border-line pt-3.5">
      <h3 className="text-sm font-extrabold">{title}</h3>
      {children}
    </section>
  );
}

/** Campo numérico com ponto de milhar (4.899.999), para valores grandes ficarem legíveis. */
function MoneyField({ value, onChange, placeholder }: { value: number; onChange: (n: number) => void; placeholder?: string }) {
  return <input className="field w-full tnum" inputMode="numeric" autoComplete="off" value={value ? fmtInt(value) : ""} placeholder={placeholder} onChange={(e) => onChange(digits(e.target.value))} />;
}

/** Escolha do item: busca por nome, mostra o menor preço de cada um na moeda escolhida. */
function ItemPicker({ items, loading, text, onText, selected, moeda, onPick }: { items: MarketItem[]; loading: boolean; text: string; onText: (t: string) => void; selected?: MarketItem; moeda: Moeda; onPick: (i: MarketItem) => void }) {
  const q = text.trim().toLowerCase();
  const matches = useMemo(() => (q && !selected ? items.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 6) : []), [items, q, selected]);
  const unit = MOEDA_LABEL[moeda];
  return (
    <div className="space-y-2">
      <Labeled label="Item" hint={loading ? "Carregando a lista de itens…" : undefined}>
        <input className="field w-full" value={text} onChange={(e) => onText(e.target.value)} placeholder="Digite o nome. Ex.: Sun Stone" autoComplete="off" enterKeyHint="search" />
      </Labeled>
      {matches.length > 0 && (
        <ul className="tile divide-y divide-line overflow-hidden" aria-label="Itens encontrados">
          {matches.map((i) => {
            const f = floorOf(i, moeda);
            return (
              <li key={i.id}>
                <button type="button" className="flex min-h-12 w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[#241a0f]" onClick={() => onPick(i)}>
                  <span className="grid size-8 shrink-0 place-items-center">
                    <ItemSprite icon={i.icon} size={28} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{i.name}</span>
                  <span className="tnum shrink-0 text-xs text-mute">{f ? `${fmtInt(f)} ${unit}` : "sem anúncio"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {q && !selected && !loading && matches.length === 0 && <p className="text-xs text-mute">Nenhum item com esse nome.</p>}
      {selected && (
        <div className="tile flex items-center gap-3 px-3 py-2.5" aria-live="polite">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-line bg-void">
            <ItemSprite icon={selected.icon} size={34} alt="" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold leading-tight">{selected.name}</p>
            {floorOf(selected, moeda) ? (
              <p className="mt-0.5 text-xs text-mute">
                Menor preço agora: <b className="tnum text-sm text-poke-gold">{fmtInt(floorOf(selected, moeda) ?? 0)}</b> {unit}
                {avgOf(selected, moeda) ? <span className="tnum"> · média de 7 dias {fmtInt(Math.round(avgOf(selected, moeda) ?? 0))}</span> : null}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-mute">Nenhum anúncio em {unit} agora.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Escolha do Pokémon: busca pelo nome, com sprite e tipos de cada um (dá para digitar só um pedaço do nome). */
function PokemonPicker({ creatures, value, onChange }: { creatures: Record<string, Creature> | null; value: string; onChange: (v: string) => void }) {
  const list = useMemo(() => {
    const seen = new Map<string, Creature>();
    for (const c of Object.values(creatures ?? {})) if (c?.n && !seen.has(c.n.toLowerCase())) seen.set(c.n.toLowerCase(), c);
    return [...seen.values()].sort((a, b) => a.n.localeCompare(b.n));
  }, [creatures]);
  const q = value.trim().toLowerCase();
  const exact = q ? list.find((c) => c.n.toLowerCase() === q) : undefined;
  const matches = useMemo(() => (q && !exact ? list.filter((c) => c.n.toLowerCase().includes(q)).slice(0, 6) : []), [list, q, exact]);
  return (
    <div className="space-y-2">
      <Labeled label="Nome do Pokémon" hint={!exact && q && matches.length === 0 ? "Nenhum Pokémon com esse nome, mas a busca ainda funciona com o que você digitou." : "Dá para digitar só um pedaço do nome."}>
        <input className="field w-full" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Digite o nome. Ex.: Pikachu" maxLength={40} autoComplete="off" enterKeyHint="search" />
      </Labeled>
      {matches.length > 0 && (
        <ul className="tile divide-y divide-line overflow-hidden" aria-label="Pokémon encontrados">
          {matches.map((c) => (
            <li key={c.n}>
              <button type="button" className="flex min-h-12 w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[#241a0f]" onClick={() => onChange(c.n)}>
                <PokemonSprite looktype={c.lk} size={32} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.n}</span>
                <span className="flex shrink-0 gap-1">
                  {c.t.map((t) => (
                    <TypeChip key={t} type={t} />
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {exact && (
        <div className="tile flex items-center gap-3 px-3 py-2" aria-live="polite">
          <span className="grid size-11 shrink-0 place-items-center rounded-full border-2 border-edge/70" style={{ background: "radial-gradient(circle at 50% 35%, #4a3519, #1a120a 75%)" }}>
            <PokemonSprite looktype={exact.lk} size={36} />
          </span>
          <p className="min-w-0 flex-1 truncate font-bold">{exact.n}</p>
          <span className="flex shrink-0 gap-1">
            {exact.t.map((t) => (
              <TypeChip key={t} type={t} />
            ))}
          </span>
        </div>
      )}
    </div>
  );
}

const KINDS = [
  { id: "alert" as const, icon: Bell, title: "Avisar no Discord", desc: "Manda uma mensagem quando o preço bater o seu." },
  { id: "snipe" as const, icon: Crosshair, title: "Comprar sozinho", desc: "Compra por você quando o preço bater o seu." },
];

/** Criar/editar uma regra (alerta no Discord ou compra automática). */
export function RuleDialog({ kind: initialKind, rule, preset, onClose, onSaved }: { kind: "alert" | "snipe"; rule?: Rule; preset?: Partial<RuleSpec>; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<"alert" | "snipe">(initialKind);
  const [spec, setSpec] = useState<RuleSpec>(() => {
    const s = { ...emptySpec(preset), ...(rule?.spec ?? {}) };
    return { ...s, account_ids: ruleAccountIds(s) };
  });
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itemText, setItemText] = useState(preset?.name ?? rule?.label ?? "");
  const ov = useAsync(() => marketApi.overview(), []);
  const creatures = useCreatures();
  // Pokémon: "um específico" (digita o nome) ou "qualquer um" (só pelo preço). Regra salva sem nome = qualquer.
  const [pokeAny, setPokeAny] = useState(() => !!rule && rule.spec.target === "pokemon" && !rule.spec.busca?.trim());
  const filtersActive = !!(spec.elemento || spec.iv_min || spec.nivel_min || spec.so_shiny || spec.so_p5);
  const [filtersOpen, setFiltersOpen] = useState(filtersActive);
  const ids = useAccountIds();
  const accs = useAccountsMap();
  const set = <K extends keyof RuleSpec>(k: K, v: RuleSpec[K]) => setSpec((s) => ({ ...s, [k]: v }));
  const items = ov.data?.items ?? [];
  const selected = items.find((i) => i.id === spec.item_id);
  const snipe = kind === "snipe";
  const unit = MOEDA_LABEL[spec.moeda];
  const floor = spec.target === "item" ? floorOf(selected, spec.moeda) : null;

  const onText = (t: string) => {
    setItemText(t);
    const hit = items.find((i) => i.name.toLowerCase() === t.trim().toLowerCase());
    setSpec((s) => ({ ...s, item_id: hit?.id ?? null, name: hit?.name ?? s.name }));
  };
  const pickItem = (i: MarketItem) => {
    setItemText(i.name);
    setSpec((s) => ({ ...s, item_id: i.id, name: i.name }));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const chosen = snipe ? (spec.account_ids ?? []) : [];
      const body: RuleSpec = { ...spec, account_ids: chosen, account_id: chosen[0] ?? null };
      if (rule) await marketApi.editRule(rule.id, kind, body, enabled);
      else await marketApi.addRule(kind, body, enabled);
      onSaved();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  const missing = [
    spec.target === "item" && !spec.item_id && "escolher o item",
    spec.target === "pokemon" && !pokeAny && !spec.busca?.trim() && "escolher o Pokémon (ou marcar Qualquer Pokémon)",
    spec.max_price <= 0 && spec.below_avg_pct <= 0 && "definir o preço máximo",
    snipe && !spec.account_ids?.length && "marcar ao menos uma conta",
  ].filter(Boolean) as string[];

  return (
    <Modal title={rule ? "Editar regra" : "Nova regra"} onClose={onClose} wide>
      {!rule ? (
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="O que a regra faz">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={kind === k.id}
              onClick={() => setKind(k.id)}
              className={`flex min-h-[5.5rem] flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors ${kind === k.id ? "border-edge bg-[#3a2a12]" : "border-line bg-tile hover:bg-[#241a0f]"}`}
            >
              <span className={`flex items-center gap-1.5 text-sm font-extrabold ${kind === k.id ? "text-poke-gold" : ""}`}>
                <k.icon className="size-4 shrink-0" aria-hidden /> {k.title}
              </span>
              <span className="text-xs leading-snug text-mute">{k.desc}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-sm text-mute">
          {snipe ? <Crosshair className="size-4 text-poke-gold" aria-hidden /> : <Bell className="size-4 text-poke-gold" aria-hidden />}
          {snipe ? "Regra de compra automática" : "Regra de aviso no Discord"}
        </p>
      )}

      {snipe && (
        <Notice tone="warn">
          Esta regra <b>gasta de verdade</b>, e só compra com a Compra automática ligada. Perder o sorteio da liberação não custa nada.
          {!spec.budget_daily && " Sem orçamento diário, cada conta compra até acabar o saldo."}
          {spec.moeda === "orb" && " Gemas valem dinheiro real: prefira definir um orçamento pequeno."}
        </Notice>
      )}

      <Section title="O que acompanhar">
        <Seg
          label="Tipo de anúncio"
          value={spec.target}
          onChange={(v) => !rule && set("target", v)}
          options={[
            { id: "item", label: "Item" },
            { id: "pokemon", label: "Pokémon" },
          ]}
          className={`w-full sm:w-fit ${rule ? "pointer-events-none opacity-60" : ""}`}
        />
        {spec.target === "item" ? (
          <ItemPicker items={items} loading={ov.loading} text={itemText} onText={onText} selected={selected} moeda={spec.moeda} onPick={pickItem} />
        ) : (
          <div className="space-y-3">
            <Seg
              label="Qual Pokémon"
              value={pokeAny ? "any" : "one"}
              onChange={(v) => {
                setPokeAny(v === "any");
                if (v === "any") set("busca", "");
              }}
              options={[
                { id: "one", label: "Um Pokémon" },
                { id: "any", label: "Qualquer Pokémon" },
              ]}
            />
            {pokeAny ? (
              <p className="tile px-3 py-2.5 text-sm text-mute">
                Vale para <b className="text-fg">qualquer Pokémon</b> que apareça dentro do preço máximo. Se quiser, restrinja nos filtros abaixo.
              </p>
            ) : (
              <PokemonPicker creatures={creatures} value={spec.busca ?? ""} onChange={(v) => set("busca", v)} />
            )}
            <details open={filtersOpen} onToggle={(e) => setFiltersOpen(e.currentTarget.open)} className="group">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-poke-gold [&::-webkit-details-marker]:hidden">
                <ChevronDown className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden /> Filtros{" "}
                <span className="font-normal text-mute">{filtersActive ? "(em uso)" : "(opcional)"}</span>
              </summary>
              <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
                <Labeled label="Tipo">
                  <select className="field w-full" value={spec.elemento ?? ""} onChange={(e) => set("elemento", e.target.value)}>
                    {ELEMENTS.map((x) => (
                      <option key={x} value={x}>
                        {x || "Qualquer"}
                      </option>
                    ))}
                  </select>
                </Labeled>
                <div className="grid grid-cols-2 gap-3">
                  <Labeled label="IV mínimo (%)">
                    <input className="field w-full" inputMode="numeric" value={spec.iv_min ?? ""} onChange={(e) => set("iv_min", clampOrNull(e.target.value, 0, 100))} />
                  </Labeled>
                  <Labeled label="Nível mínimo">
                    <input className="field w-full" inputMode="numeric" value={spec.nivel_min ?? ""} onChange={(e) => set("nivel_min", clampOrNull(e.target.value, 1, 1000))} />
                  </Labeled>
                </div>
                <div className="flex flex-wrap gap-x-5 sm:col-span-2">
                  <div className="flex min-h-11 items-center">
                    <Check2 checked={!!spec.so_shiny} onChange={(v) => set("so_shiny", v)}>
                      ✨ Só shiny
                    </Check2>
                  </div>
                  <div className="flex min-h-11 items-center">
                    <Check2 checked={!!spec.so_p5} onChange={(v) => set("so_p5", v)}>
                      Só P5
                    </Check2>
                  </div>
                </div>
              </div>
            </details>
          </div>
        )}
      </Section>

      <Section title="Até quanto pagar">
        <div className="space-y-1.5">
          <span className="label block">Moeda</span>
          <CurrencyToggle value={spec.moeda} onChange={(m) => set("moeda", m as Moeda)} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Labeled label={`Preço máximo por unidade (${unit})`}>
            <MoneyField value={spec.max_price} onChange={(n) => set("max_price", n)} placeholder={floor ? fmtInt(floor) : "0"} />
          </Labeled>
          {spec.target === "item" && (
            <Labeled label="…ou % abaixo da média de 7 dias" hint="Vale o menor dos dois.">
              <input className="field w-full" inputMode="decimal" value={spec.below_avg_pct || ""} onChange={(e) => set("below_avg_pct", Math.min(95, Math.max(0, Number(e.target.value) || 0)))} placeholder="Ex.: 20" />
            </Labeled>
          )}
        </div>
        {floor ? (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Atalhos de preço">
            <span className="text-xs text-mute">Usar:</span>
            {[
              { label: "o menor preço", f: 1 },
              { label: "10% abaixo", f: 0.9 },
              { label: "20% abaixo", f: 0.8 },
            ].map((o) => (
              <button key={o.label} type="button" className="btn !min-h-10 !text-xs" data-active={spec.max_price === Math.floor(floor * o.f)} onClick={() => set("max_price", Math.max(1, Math.floor(floor * o.f)))}>
                {o.label} <span className="tnum text-mute">({fmtInt(Math.max(1, Math.floor(floor * o.f)))})</span>
              </button>
            ))}
          </div>
        ) : null}
      </Section>

      {snipe && (
        <Section title="Quem compra">
          <AccountPicker ids={ids} nicks={accs} value={spec.account_ids ?? []} onChange={(v) => set("account_ids", v)} />
          <Labeled
            label={`Orçamento por dia (${unit}), opcional`}
            hint={(spec.account_ids?.length ?? 0) > 1 ? "Vale para cada conta marcada. Vazio = sem limite, só o saldo da conta." : "O máximo que a regra gasta por dia. Vazio = sem limite, só o saldo da conta."}
          >
            <MoneyField value={spec.budget_daily ?? 0} onChange={(n) => set("budget_daily", n)} placeholder="Sem limite" />
          </Labeled>
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-poke-gold [&::-webkit-details-marker]:hidden">
              <ChevronDown className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden /> Mais opções
            </summary>
            <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
              <Labeled label="Máximo de unidades por compra" hint="Vazio = sem limite (até o orçamento).">
                <input className="field w-full" inputMode="numeric" value={spec.qty_max || ""} onChange={(e) => set("qty_max", digits(e.target.value))} />
              </Labeled>
              <Labeled label="Conferir o mercado a cada (segundos)" hint="De 5 a 600.">
                <input className="field w-full" inputMode="numeric" value={spec.poll_s ?? 10} onChange={(e) => set("poll_s", Math.min(600, Math.max(5, Number(e.target.value) || 10)))} />
              </Labeled>
            </div>
          </details>
        </Section>
      )}

      <div className="space-y-3 border-t border-line pt-3.5">
        <div className="flex min-h-11 items-center">
          <Check2 checked={enabled} onChange={setEnabled}>
            Regra ligada
          </Check2>
        </div>
        {missing.length > 0 && (
          <p className="text-xs text-mute" aria-live="polite">
            Falta {missing.join(", ")}.
          </p>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex gap-2 sm:justify-end">
          <button className="btn !min-h-11 flex-1 sm:flex-none sm:!px-6" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn !min-h-11 flex-1 sm:flex-none sm:!px-6" data-active="true" onClick={save} disabled={busy || missing.length > 0}>
            {busy ? "Salvando…" : "Salvar regra"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Quais contas compram. Marcar várias faz todas tentarem o mesmo anúncio ao mesmo tempo (mais chances no sorteio do servidor). */
function AccountPicker({ ids, nicks, value, onChange }: { ids: string[]; nicks: Record<string, { nick?: string } | undefined>; value: number[]; onChange: (v: number[]) => void }) {
  const all = ids.map((id) => Number(id.replace(/\D/g, "")));
  const allOn = all.length > 0 && all.every((n) => value.includes(n));
  const toggle = (n: number) => onChange(value.includes(n) ? value.filter((x) => x !== n) : [...value, n]);
  return (
    <fieldset className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <legend className="sr-only">Contas que compram</legend>
        <p className="text-xs text-mute">Marque as contas que vão tentar comprar.</p>
        {all.length > 1 && (
          <button type="button" className="min-h-11 shrink-0 rounded px-2 text-xs font-semibold text-poke-gold hover:underline" onClick={() => onChange(allOn ? [] : all)}>
            {allOn ? "Limpar" : "Marcar todas"}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ids.map((id, i) => {
          const n = all[i];
          const on = value.includes(n);
          return (
            <button key={id} type="button" className="btn !min-h-11 justify-start gap-1.5" data-active={on} aria-pressed={on} onClick={() => toggle(n)}>
              <Check className={`size-4 shrink-0 ${on ? "" : "opacity-0"}`} aria-hidden />
              <span className="truncate">{nicks[id]?.nick ?? id}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-mute">
        {value.length > 1 ? `As ${value.length} contas tentam o mesmo anúncio ao mesmo tempo: mais chances no sorteio da liberação.` : "Marque mais de uma para todas tentarem o mesmo anúncio ao mesmo tempo."}
      </p>
    </fieldset>
  );
}

/** Interruptor de ligar/desligar a regra (com o estado escrito ao lado, para não depender só da cor). */
function RuleSwitch({ on, busy, label, onToggle }: { on: boolean; busy: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={`Regra ${label}`} disabled={busy} onClick={onToggle} className="flex min-h-11 shrink-0 items-center gap-2 pl-2 disabled:opacity-60">
      <span className={`text-xs font-bold ${on ? "text-poke-green" : "text-mute"}`}>{on ? "Ligada" : "Desligada"}</span>
      <span className={`relative h-6 w-11 rounded-full border transition-colors motion-reduce:transition-none ${on ? "border-[#2f6b3a] bg-[#16301c]" : "border-line bg-void"}`}>
        <span className={`absolute left-0.5 top-0.5 size-[18px] rounded-full transition-transform motion-reduce:transition-none ${on ? "translate-x-5 bg-poke-green" : "bg-mute"}`} />
      </span>
    </button>
  );
}

function RuleRow({ r, onEdit, onChanged, buyers }: { r: Rule; onEdit: () => void; onChanged: () => void; buyers: string[] }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const s = r.spec;
  const snipe = r.kind === "snipe";
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const moeda = s.moeda === "orb" ? "Gemas" : "Gold";
  // O orçamento diário vale por conta: o teto total é ele vezes o número de contas da regra.
  const perAccount = s.budget_daily ?? 0;
  const budget = perAccount * Math.max(1, buyers.length);
  const pct = budget > 0 ? Math.min(100, (r.spentToday / budget) * 100) : 0;
  const full = budget > 0 && r.spentToday >= budget;
  return (
    <li className={`tile min-w-0 space-y-3 p-3.5 transition-opacity ${r.enabled ? "" : "opacity-60"}`}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-void text-poke-gold">{snipe ? <Crosshair className="size-5" aria-hidden /> : <Bell className="size-5" aria-hidden />}</span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 break-words text-base font-bold leading-tight">{r.label}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-mute">
            <span>{snipe ? "Compra até" : "Avisa até"}</span>
            {s.max_price > 0 ? (
              <span className={`tnum inline-flex items-center gap-1 text-sm font-extrabold ${MONEY_TEXT[moeda]}`}>
                <Coin kind={s.moeda === "orb" ? "gem" : "gold"} size={14} />
                {fmtInt(s.max_price)}
              </span>
            ) : null}
            {s.below_avg_pct > 0 && <span>{s.max_price > 0 ? "ou " : ""}{s.below_avg_pct}% abaixo da média</span>}
          </p>
        </div>
        <RuleSwitch on={r.enabled} busy={busy} label={r.label} onToggle={() => act(() => marketApi.toggleRule(r.id))} />
      </div>

      {snipe && (
        <div className="flex flex-wrap items-center gap-1.5">
          {buyers.length ? (
            buyers.map((n) => (
              <span key={n} className="rounded-md border border-line bg-void px-2 py-0.5 text-xs font-semibold">
                {n}
              </span>
            ))
          ) : (
            <span className="text-xs text-poke-red">Nenhuma conta marcada</span>
          )}
        </div>
      )}

      {snipe && (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-mute">{budget > 0 ? "Gasto hoje" : "Gasto hoje · sem limite"}</span>
            <span className="tnum whitespace-nowrap font-semibold">
              {fmtInt(r.spentToday)}
              {budget > 0 && <span className="font-normal text-mute"> / {fmtInt(budget)}</span>}
            </span>
          </div>
          {budget > 0 && (
            <div className="h-1.5 overflow-hidden rounded-full bg-black/40" role="progressbar" aria-label="Gasto de hoje" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={Math.min(r.spentToday, budget)}>
              <div className={`h-full rounded-full ${full ? "bg-poke-green" : "bg-poke-gold"}`} style={{ width: `${pct}%` }} />
            </div>
          )}
          {budget > 0 && buyers.length > 1 && <p className="text-[11px] text-mute">Orçamento de {fmtInt(perAccount)} por conta.</p>}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
        <span className="min-w-0 truncate text-[11px] text-mute">{r.lastFire ? `Última vez: ${fmtWhen(r.lastFire)}` : "Ainda não disparou"}</span>
        <div className="flex shrink-0 gap-1.5">
          <button className="btn !min-h-11 !text-xs" onClick={onEdit} aria-label={`Editar regra ${r.label}`}>
            <Pencil className="size-4" aria-hidden /> Editar
          </button>
          <button className="btn !min-h-11 !text-xs" onClick={() => setConfirm(true)} aria-label={`Excluir regra ${r.label}`}>
            <Trash2 className="size-4" aria-hidden /> Excluir
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        title="Excluir regra?"
        message={`A regra "${r.label}" será apagada.`}
        confirmLabel="Excluir"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          void act(() => marketApi.deleteRule(r.id));
        }}
      />
    </li>
  );
}

const STATUS: Record<string, { label: string; text: string; bar: string }> = {
  comprado: { label: "Comprou", text: "text-poke-green", bar: "bg-poke-green" },
  perdeu_sorteio: { label: "Perdeu o sorteio", text: "text-poke-gold", bar: "bg-poke-gold" },
  indisponivel: { label: "Já vendido", text: "text-mute", bar: "bg-mute/60" },
  recusado: { label: "Recusado", text: "text-poke-red", bar: "bg-poke-red" },
  erro: { label: "Erro", text: "text-poke-red", bar: "bg-poke-red" },
  timeout: { label: "Sem resposta", text: "text-poke-red", bar: "bg-poke-red" },
  vendido: { label: "Vendido", text: "text-mute", bar: "bg-mute/60" },
  sniper: { label: "Sniper", text: "text-mute", bar: "bg-mute/60" },
};
const STATUS_FALLBACK = { text: "text-mute", bar: "bg-mute/60" };
// Registros antigos terminavam com ": status — detalhe", que o selo já mostra.
const cleanText = (t: string) => t.replace(/: (comprado|perdeu_sorteio)( — .*)?$/, "");
const LOG_SHOWN = 10; // linhas visíveis antes de precisar rolar
const LOG_ROW_REM = 3.75;

interface LogGroup {
  key: number;
  status: string;
  ts: number;
  names: string[];
  qty: number | null;
  item: string;
  price: number | null;
  moeda: "Gold" | "Gemas";
  detail: string | null;
}

/** "2× Cocoon Stone a 5796 Gold (#123) — detalhe" -> partes, para mostrar item e preço sem o ruído do texto cru. */
function parseText(raw: string) {
  const text = cleanText(raw);
  const listing = text.match(/#(\d+)/)?.[1];
  const m = text.match(/^(?:(\d+)× )?(.+?) a (\d+) (Gold|Gemas)(?: \(#\d+\))?(?: — (.*))?$/);
  if (!m) return { qty: null, item: text, price: null, moeda: "Gold" as const, detail: null, listing };
  return { qty: m[1] ? Number(m[1]) : null, item: m[2], price: Number(m[3]), moeda: m[4] as "Gold" | "Gemas", detail: m[5] ?? null, listing };
}

/** Contas com o mesmo resultado no mesmo anúncio viram uma linha só (ex.: 4 contas perderam o sorteio). */
function groupLog(rows: LogRow[], nickOf: (id: number | null) => string | undefined): LogGroup[] {
  const out: LogGroup[] = [];
  const byKey = new Map<string, LogGroup>();
  for (const l of rows) {
    const p = parseText(l.text);
    const who = nickOf(l.accountId);
    const k = p.listing ? `${l.status}|${p.listing}` : null;
    const g = k ? byKey.get(k) : undefined;
    if (g) {
      if (who && !g.names.includes(who)) g.names.push(who);
      g.qty = null; // a quantidade difere por conta: some da linha agrupada
      continue;
    }
    const ng: LogGroup = { key: l.id, status: l.status, ts: l.ts, names: who ? [who] : [], qty: p.qty, item: p.item, price: p.price, moeda: p.moeda, detail: p.detail };
    out.push(ng);
    if (k) byKey.set(k, ng);
  }
  return out;
}

const MONEY_TEXT = { Gold: "text-poke-gold", Gemas: "text-[#f58bd0]" } as const;

function BuyLog({ rows, nickOf }: { rows: LogRow[]; nickOf: (id: number | null) => string | undefined }) {
  const groups = useMemo(() => groupLog(rows, nickOf), [rows, nickOf]);
  if (groups.length === 0) return <p className="card p-4 text-center text-sm text-mute">Nada aconteceu ainda.</p>;
  return (
    <div className="card overflow-hidden">
      {/* ~10 linhas visíveis; o resto rola (com o dedo no celular). */}
      <ul className="buylog divide-y divide-line overflow-y-auto overscroll-contain" style={{ maxHeight: `${LOG_SHOWN * LOG_ROW_REM}rem`, WebkitOverflowScrolling: "touch" }} tabIndex={0} aria-label="Últimas compras">
        {groups.map((g) => {
          const st = STATUS[g.status];
          const color = st ?? STATUS_FALLBACK;
          const who = g.names.join(", ");
          return (
            <li key={g.key} className="flex items-stretch gap-3 px-3 py-2 sm:px-4" style={{ minHeight: `${LOG_ROW_REM}rem` }}>
              <span className={`w-1 shrink-0 rounded-full ${color.bar}`} aria-hidden />
              {/* Espaço curto (celular, janela estreita): 2 linhas. Espaço largo: tudo numa linha, em colunas (veja .lg-* em index.css). */}
              <div className="lg-row">
                <p className="lg-item truncate text-[15px] font-bold leading-tight">
                  {g.qty ? <span className="mr-1 text-mute">{g.qty}×</span> : null}
                  {g.item}
                </p>
                {g.price != null && (
                  <p className={`lg-price tnum flex items-center justify-end gap-1.5 text-[15px] font-extrabold leading-none ${MONEY_TEXT[g.moeda]}`}>
                    <Coin kind={g.moeda === "Gemas" ? "gem" : "gold"} size={16} />
                    {fmtInt(g.price)}
                  </p>
                )}
                <div className="lg-meta text-xs text-mute">
                  <b className={`lg-status text-[13px] ${color.text}`}>{st?.label ?? g.status.replace(/_/g, " ")}</b>
                  <span className="lg-compact">
                    {who && <> · {who}</>}
                    {g.detail && <> · {g.detail}</>}
                  </span>
                  <span className="lg-chips">
                    {g.names.map((n) => (
                      <span key={n} className="rounded-md border border-line bg-void px-2 py-0.5 text-xs font-bold text-fg">
                        {n}
                      </span>
                    ))}
                    {g.detail && <span className="text-xs text-mute">{g.detail}</span>}
                  </span>
                </div>
                <span className="lg-time tnum text-[11px] leading-none text-mute">{fmtWhen(g.ts * 1000)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function RulesTab() {
  const rules = useAsync(() => marketApi.rules(), [], { every: 15000 });
  const log = useAsync(() => marketApi.log(), [], { every: 15000 });
  const accs = useAccountsMap();
  const [dlg, setDlg] = useState<{ kind: "alert" | "snipe"; rule?: Rule } | null>(null);
  const [switching, setSwitching] = useState(false);
  const [confirmOn, setConfirmOn] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = () => {
    void rules.reload();
    void log.reload();
  };
  const setSniper = async (on: boolean) => {
    setSwitching(true);
    setErr(null);
    try {
      await marketApi.setSniper(on);
      reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSwitching(false);
    }
  };
  const nickOf = useCallback((id: number | null) => (id ? (accs[`acc${id}`]?.nick ?? `Conta ${id}`) : undefined), [accs]);
  const buyersOf = (r: Rule) => ruleAccountIds(r.spec).map((id) => nickOf(id) as string);

  if (rules.loading && !rules.data) return <Loading />;
  if (rules.error && !rules.data) return <ErrorBox error={rules.error} onRetry={rules.reload} />;
  const list = rules.data?.rules ?? [];
  const on = rules.data?.sniperEnabled ?? false;
  const buying = list.filter((r) => r.kind === "snipe" && r.enabled).length;

  return (
    <div className="space-y-4 sm:space-y-5">
      <section className="card flex items-center justify-between gap-3 p-3 sm:p-4" aria-labelledby="sniper-title">
        <div className="min-w-0">
          <h2 id="sniper-title" className="flex items-center gap-2 text-base font-extrabold sm:text-lg">
            <Crosshair className="size-5 shrink-0 text-poke-gold" aria-hidden /> Compra automática
          </h2>
          <p className="mt-0.5 text-sm text-mute">
            {on ? (
              <>
                <b className="text-poke-green">Ligada</b> · {buying === 0 ? "nenhuma regra de compra ativa" : `${buying} regra${buying > 1 ? "s" : ""} comprando`}
              </>
            ) : (
              <>
                <b>Desligada</b> · nada é comprado sozinho; os avisos continuam
              </>
            )}
          </p>
        </div>
        <button className="btn !min-h-11 shrink-0" data-active={on} disabled={switching} onClick={() => (on ? void setSniper(false) : setConfirmOn(true))} aria-pressed={on}>
          <span className={`size-2 rounded-full ${on ? "bg-poke-green" : "bg-mute"}`} />
          {on ? "Desligar" : "Ligar"}
        </button>
      </section>
      {err && <Notice tone="error">{err}</Notice>}

      <section className="space-y-2" aria-labelledby="rules-title">
        <div className="flex items-center justify-between gap-2">
          <h2 id="rules-title" className="text-base font-extrabold sm:text-lg">
            Regras
          </h2>
          <button className="btn !min-h-11" data-active="true" onClick={() => setDlg({ kind: "alert" })}>
            <Plus className="size-4" aria-hidden /> Nova regra
          </button>
        </div>
        {list.length === 0 ? (
          <p className="card p-6 text-center text-sm text-mute">
            Nenhuma regra ainda. Crie uma para ser avisado no Discord, ou para comprar sozinho quando o preço estiver bom.
            <br />
            Dica: abra um item na aba Comprar e use <b>Avisar</b> ou <b>Comprar sozinho</b>.
          </p>
        ) : (
          <ul className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
            {list.map((r) => (
              <RuleRow key={r.id} r={r} buyers={buyersOf(r)} onEdit={() => setDlg({ kind: r.kind, rule: r })} onChanged={reload} />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2" aria-labelledby="log-title">
        <h2 id="log-title" className="text-base font-extrabold sm:text-lg">
          Últimas compras
        </h2>
        <BuyLog rows={log.data?.log ?? []} nickOf={nickOf} />
      </section>

      <AnimatePresence>
        {dlg && (
          <RuleDialog
            kind={dlg.kind}
            rule={dlg.rule}
            onClose={() => setDlg(null)}
            onSaved={() => {
              setDlg(null);
              reload();
            }}
          />
        )}
      </AnimatePresence>
      <ConfirmDialog
        open={confirmOn}
        danger={false}
        title="Ligar a compra automática?"
        message="As regras de compra passam a comprar sozinhas, dentro do preço máximo e do orçamento diário de cada uma. Perder o sorteio da liberação não custa nada. Você pode desligar aqui a qualquer momento."
        confirmLabel="Ligar"
        onCancel={() => setConfirmOn(false)}
        onConfirm={() => {
          setConfirmOn(false);
          void setSniper(true);
        }}
      />
    </div>
  );
}
