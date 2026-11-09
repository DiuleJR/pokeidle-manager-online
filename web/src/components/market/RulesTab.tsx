import { AnimatePresence } from "framer-motion";
import { Bell, Crosshair, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Check2, Chip, Labeled, Modal, Notice } from "@/components/SettingsView";
import { ConfirmDialog } from "@/components/ui";
import { MOEDA_LABEL, type Moeda, type Rule, type RuleSpec, marketApi } from "@/lib/market";
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
  qty_max: 0,
  budget_daily: 0,
  poll_s: 10,
  ...over,
});

const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

/** Criar/editar uma regra (alerta no Discord ou compra automática). */
export function RuleDialog({ kind: initialKind, rule, preset, onClose, onSaved }: { kind: "alert" | "snipe"; rule?: Rule; preset?: Partial<RuleSpec>; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<"alert" | "snipe">(initialKind);
  const [spec, setSpec] = useState<RuleSpec>(() => ({ ...emptySpec(preset), ...(rule?.spec ?? {}) }));
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itemText, setItemText] = useState(preset?.name ?? rule?.label ?? "");
  const ov = useAsync(() => marketApi.overview(), []);
  const ids = useAccountIds();
  const accs = useAccountsMap();
  const set = <K extends keyof RuleSpec>(k: K, v: RuleSpec[K]) => setSpec((s) => ({ ...s, [k]: v }));
  const items = ov.data?.items ?? [];
  const byName = useMemo(() => new Map(items.map((i) => [i.name.toLowerCase(), i])), [items]);
  const snipe = kind === "snipe";

  const pickItem = (text: string) => {
    setItemText(text);
    const it = byName.get(text.trim().toLowerCase());
    if (it) setSpec((s) => ({ ...s, item_id: it.id, name: it.name }));
    else setSpec((s) => ({ ...s, item_id: null }));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: RuleSpec = { ...spec, account_id: snipe ? spec.account_id : null };
      if (rule) await marketApi.editRule(rule.id, kind, body, enabled);
      else await marketApi.addRule(kind, body, enabled);
      onSaved();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  const noPrice = spec.max_price <= 0 && spec.below_avg_pct <= 0;
  const invalid =
    (spec.target === "item" && !spec.item_id) ||
    (spec.target === "pokemon" && !(spec.busca?.trim() || spec.so_shiny || spec.so_p5)) ||
    noPrice ||
    (snipe && (!spec.account_id || !(spec.budget_daily && spec.budget_daily > 0)));

  return (
    <Modal title={rule ? "Editar regra" : "Nova regra"} onClose={onClose} wide>
      {!rule && (
        <Seg
          label="O que a regra faz"
          value={kind}
          onChange={setKind}
          options={[
            { id: "alert", label: "Avisar no Discord" },
            { id: "snipe", label: "Comprar sozinho" },
          ]}
        />
      )}
      {snipe ? (
        <Notice tone="warn">
          O sniper <b>gasta de verdade</b>: compra sozinho, na conta escolhida, quando aparece um anúncio dentro do seu teto. Perder o sorteio da liberação não custa nada. Ele só roda com a chave geral
          ligada e nunca passa do orçamento diário.
          {spec.moeda === "orb" && " Gemas valem dinheiro real: use um orçamento pequeno."}
        </Notice>
      ) : (
        <p className="text-sm text-mute">Avisa no Discord quando aparecer um anúncio dentro do seu teto. Precisa do webhook em Configurações.</p>
      )}

      <div className="flex gap-1.5">
        <button className="btn" data-active={spec.target === "item"} onClick={() => set("target", "item")} disabled={!!rule}>
          Item
        </button>
        <button className="btn" data-active={spec.target === "pokemon"} onClick={() => set("target", "pokemon")} disabled={!!rule}>
          Pokémon
        </button>
      </div>

      {spec.target === "item" ? (
        <Labeled label="Item" hint={ov.loading ? "Carregando lista…" : spec.item_id ? `#${spec.item_id}` : "Digite e escolha da lista"}>
          <input className="field w-full" list="mkt-items" value={itemText} onChange={(e) => pickItem(e.target.value)} placeholder="Ex.: Sun Stone" />
          <datalist id="mkt-items">
            {items.map((i) => (
              <option key={i.id} value={i.name} />
            ))}
          </datalist>
        </Labeled>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Nome do Pokémon">
            <input className="field w-full" value={spec.busca ?? ""} onChange={(e) => set("busca", e.target.value)} placeholder="Ex.: Pikachu" maxLength={40} />
          </Labeled>
          <Labeled label="Tipo">
            <select className="field w-full" value={spec.elemento ?? ""} onChange={(e) => set("elemento", e.target.value)}>
              {ELEMENTS.map((x) => (
                <option key={x} value={x}>
                  {x || "Qualquer"}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label="IV mínimo (%)">
            <input className="field w-full" inputMode="numeric" value={spec.iv_min ?? ""} onChange={(e) => set("iv_min", numOrNull(e.target.value))} />
          </Labeled>
          <Labeled label="Nível mínimo">
            <input className="field w-full" inputMode="numeric" value={spec.nivel_min ?? ""} onChange={(e) => set("nivel_min", numOrNull(e.target.value))} />
          </Labeled>
          <Check2 checked={!!spec.so_shiny} onChange={(v) => set("so_shiny", v)}>
            ✨ Só shiny
          </Check2>
          <Check2 checked={!!spec.so_p5} onChange={(v) => set("so_p5", v)}>
            Só P5
          </Check2>
        </div>
      )}

      <div className="space-y-1.5">
        <span className="label block">Moeda</span>
        <CurrencyToggle value={spec.moeda} onChange={(m: Moeda) => set("moeda", m)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Labeled label={`Preço máximo por unidade (${MOEDA_LABEL[spec.moeda]})`}>
          <input className="field w-full" inputMode="numeric" value={spec.max_price || ""} onChange={(e) => set("max_price", Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0)))} />
        </Labeled>
        {spec.target === "item" && (
          <Labeled label="…ou % abaixo da média de 7 dias" hint="Vale o menor dos dois.">
            <input className="field w-full" inputMode="decimal" value={spec.below_avg_pct || ""} onChange={(e) => set("below_avg_pct", Math.min(95, Math.max(0, Number(e.target.value) || 0)))} placeholder="Ex.: 20" />
          </Labeled>
        )}
      </div>

      {snipe && (
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Conta que compra">
            <select className="field w-full" value={spec.account_id ?? ""} onChange={(e) => set("account_id", e.target.value ? Number(e.target.value) : null)}>
              <option value="">Escolha…</option>
              {ids.map((id) => (
                <option key={id} value={Number(id.replace(/\D/g, ""))}>
                  {accs[id]?.nick ?? id}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label={`Orçamento por dia (${MOEDA_LABEL[spec.moeda]})`} hint="Obrigatório: é o máximo que a regra gasta por dia.">
            <input className="field w-full" inputMode="numeric" value={spec.budget_daily || ""} onChange={(e) => set("budget_daily", Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0)))} />
          </Labeled>
          <Labeled label="Máx. de unidades por compra" hint="Vazio = sem limite (até o orçamento).">
            <input className="field w-full" inputMode="numeric" value={spec.qty_max || ""} onChange={(e) => set("qty_max", Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0)))} />
          </Labeled>
          <Labeled label="Consultar a cada (segundos)" hint="Mínimo 5.">
            <input className="field w-full" inputMode="numeric" value={spec.poll_s ?? 10} onChange={(e) => set("poll_s", Math.min(600, Math.max(5, Number(e.target.value) || 10)))} />
          </Labeled>
        </div>
      )}

      <Check2 checked={enabled} onChange={setEnabled}>
        Regra ligada
      </Check2>

      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex justify-end gap-2 pt-1">
        <button className="btn" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className="btn" data-active="true" onClick={save} disabled={busy || invalid}>
          {busy ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </Modal>
  );
}

function RuleRow({ r, onEdit, onChanged, accountNick }: { r: Rule; onEdit: () => void; onChanged: () => void; accountNick?: string }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const s = r.spec;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const price =
    [s.max_price > 0 ? `até ${fmtInt(s.max_price)}` : "", s.below_avg_pct > 0 ? `${s.below_avg_pct}% abaixo da média` : ""].filter(Boolean).join(" · ") || "sem teto";
  return (
    <li className="tile flex flex-wrap items-center gap-x-3 gap-y-2 p-2.5 sm:p-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-void text-poke-gold">{r.kind === "snipe" ? <Crosshair className="size-4" /> : <Bell className="size-4" />}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold">{r.label}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-mute">
          <span className="font-semibold text-fg/80">{r.kind === "snipe" ? `Compra com ${accountNick ?? "conta?"}` : "Avisa no Discord"}</span>
          <span>
            {price} {MOEDA_LABEL[s.moeda]}
          </span>
          {r.kind === "snipe" && (
            <span className="tnum">
              Hoje: {fmtInt(r.spentToday)} / {fmtInt(s.budget_daily ?? 0)}
            </span>
          )}
          {r.lastFire && <span>Último: {fmtWhen(r.lastFire)}</span>}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" onClick={() => act(() => marketApi.toggleRule(r.id))} disabled={busy} aria-pressed={r.enabled} title={r.enabled ? "Desligar" : "Ligar"}>
          <Chip on={r.enabled} label={r.enabled ? "Ligada" : "Desligada"} />
        </button>
        <button className="btn" onClick={onEdit} aria-label="Editar" title="Editar">
          <Pencil className="size-4" />
        </button>
        <button className="btn" onClick={() => setConfirm(true)} aria-label="Excluir" title="Excluir">
          <Trash2 className="size-4" />
        </button>
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

const STATUS_TONE: Record<string, string> = { comprado: "text-poke-green", perdeu_sorteio: "text-poke-gold", recusado: "text-poke-red", erro: "text-poke-red", timeout: "text-poke-red" };

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
  const nickOf = (id?: number | null) => (id ? (accs[`acc${id}`]?.nick ?? `conta ${id}`) : undefined);

  if (rules.loading && !rules.data) return <Loading />;
  if (rules.error && !rules.data) return <ErrorBox error={rules.error} onRetry={rules.reload} />;
  const list = rules.data?.rules ?? [];
  const on = rules.data?.sniperEnabled ?? false;
  const buying = list.filter((r) => r.kind === "snipe" && r.enabled);
  const buyers = Array.from(new Set(buying.map((r) => nickOf(r.spec.account_id)).filter(Boolean)));

  return (
    <div className="space-y-3 sm:space-y-4">
      <section className="card space-y-2 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-extrabold sm:text-lg">
              <Crosshair className="size-5 text-poke-gold" aria-hidden /> Compra automática (sniper)
            </h2>
            <p className="mt-0.5 text-sm">
              {on ? (
                buying.length ? (
                  <>
                    <span className="font-bold text-poke-green">Ligada.</span> {buying.length} regra{buying.length > 1 ? "s" : ""} comprando com <b>{buyers.join(", ")}</b>.
                  </>
                ) : (
                  <>
                    <span className="font-bold text-poke-green">Ligada</span>, mas nenhuma regra de compra está ativa.
                  </>
                )
              ) : (
                <>
                  <span className="font-bold text-mute">Desligada.</span> Nada é comprado sozinho; os alertas continuam funcionando.
                </>
              )}
            </p>
          </div>
          <button className="btn" data-active={on} disabled={switching} onClick={() => (on ? void setSniper(false) : setConfirmOn(true))} aria-pressed={on}>
            <span className={`size-2 rounded-full ${on ? "bg-poke-green" : "bg-mute"}`} />
            {on ? "Desligar" : "Ligar"}
          </button>
        </div>
        {err && <Notice tone="error">{err}</Notice>}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-extrabold sm:text-lg">Regras</h2>
          <button className="btn" data-active="true" onClick={() => setDlg({ kind: "alert" })}>
            <Plus className="size-4" /> Nova regra
          </button>
        </div>
        {list.length === 0 ? (
          <p className="card p-6 text-center text-sm text-mute">
            Nenhuma regra ainda. Crie uma para ser avisado no Discord, ou para comprar sozinho quando o preço estiver bom.
            <br />
            Dica: abra um item na aba Comprar e use <b>Avisar</b> ou <b>Comprar sozinho</b>.
          </p>
        ) : (
          <ul className="space-y-2">
            {list.map((r) => (
              <RuleRow key={r.id} r={r} accountNick={nickOf(r.spec.account_id)} onEdit={() => setDlg({ kind: r.kind, rule: r })} onChanged={reload} />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-extrabold sm:text-lg">Últimas compras</h2>
        {(log.data?.log.length ?? 0) === 0 ? (
          <p className="card p-4 text-center text-sm text-mute">Nada aconteceu ainda.</p>
        ) : (
          <ul className="card divide-y divide-line">
            {log.data?.log.slice(0, 20).map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2 text-sm">
                <span className="tnum text-xs text-mute">{fmtWhen(l.ts * 1000)}</span>
                <span className={`text-xs font-bold uppercase ${STATUS_TONE[l.status] ?? "text-mute"}`}>{l.status.replace("_", " ")}</span>
                <span className="min-w-0 break-words">{l.text}</span>
              </li>
            ))}
          </ul>
        )}
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
