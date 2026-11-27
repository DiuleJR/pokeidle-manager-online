import { useEffect, useMemo, useState } from "react";
import { actions, type AutoHuntSettings, type Hunt } from "@/lib/actions";
import { rankLines, lineMetric, type BestHunts } from "@/lib/huntAdvisor";

/**
 * AutoHunt assistido: o cálculo /hunt ainda depende do Web Worker do navegador.
 * O servidor valida e enfileira as sugestões; não recalcula com o painel fechado.
 */
export function AutoHuntControl({
  account, online, best, currentSlug, hunts,
}: {
  account: string | null;
  online: boolean;
  best: BestHunts | null;
  currentSlug: string | null;
  hunts: Hunt[];
}) {
  const [settings, setSettings] = useState<AutoHuntSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let live = true;
    setSettings(null);
    setNotice("");
    if (account) {
      actions.getAutoHunt(account)
        .then((s) => { if (live) setSettings(s); })
        .catch(() => { if (live) setNotice("Não foi possível carregar as opções do AutoHunt."); });
    }
    return () => { live = false; };
  }, [account]);

  const candidates = useMemo(() => {
    if (!best || !settings) return [];
    const allowed = new Set(hunts.filter((h) => h.nivel <= best.sheet.trainerLevel).map((h) => h.slug));
    // A calculadora marca hunts inviáveis, e por segurança descartamos as de morte em 1 hit.
    return rankLines(best.lines, settings.metric).filter((l) => allowed.has(l.slug) && !l.umHit);
  }, [best, settings?.metric, hunts]);

  useEffect(() => {
    if (!account || !online || !settings?.enabled || !best || !currentSlug) return;
    const target = candidates[0];
    if (!target || target.slug === currentSlug) return;
    const current = best.lines.find((l) => l.slug === currentSlug);
    // O backend volta a validar conta, Pokémon, hunt, rendimento e intervalo.
    let live = true;
    const t = setTimeout(() => {
      actions.suggestAutoHunt(account, {
        metric: settings.metric,
        source_slug: currentSlug,
        target_slug: target.slug,
        pokemon_id: best.sheet.id,
        pokemon_level: best.sheet.level,
        current_rate: current ? lineMetric(current, settings.metric) : 0,
        target_rate: lineMetric(target, settings.metric),
      }).then((res) => {
        if (live && res.action === "queued") setNotice(`AutoHunt: troca para ${target.nome} na fila.`);
      }).catch((err: unknown) => {
        if (live) setNotice(err instanceof Error ? err.message : "Falha ao avaliar a sugestão.");
      });
    }, 450);
    return () => { live = false; clearTimeout(t); };
  }, [account, online, settings?.enabled, settings?.metric, currentSlug, best, candidates]);

  const save = async (patch: Partial<AutoHuntSettings>) => {
    if (!account || !settings || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const updated = await actions.setAutoHunt(account, patch);
      setSettings(updated);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Não foi possível salvar a configuração.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-2 p-3" aria-label="AutoHunt assistido">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-bold">AutoHunt assistido</h3>
          <p className="text-xs text-mute">Troca para a melhor hunt viável sem interromper o combate.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input aria-label="Ativar AutoHunt" type="checkbox" disabled={!settings || busy} checked={!!settings?.enabled}
            onChange={(e) => void save({ enabled: e.target.checked })} />
          {settings?.enabled ? "Ativado" : "Desativado"}
        </label>
      </div>
      {settings && (
        <div className="flex flex-wrap gap-2">
          <label className="text-xs text-mute">Otimizar
            <select className="field ml-2" disabled={busy} value={settings.metric}
              onChange={(e) => void save({ metric: e.target.value as "xp" | "ouro" })}>
              <option value="xp">XP/h</option><option value="ouro">Ouro/h</option>
            </select>
          </label>
          <label className="text-xs text-mute">Ganho mínimo
            <select className="field ml-2" disabled={busy} value={settings.min_gain_pct}
              onChange={(e) => void save({ min_gain_pct: Number(e.target.value) })}>
              {[5, 10, 15, 20, 30, 50].map((v) => <option key={v} value={v}>{v}%</option>)}
            </select>
          </label>
          <label className="text-xs text-mute">Entre trocas
            <select className="field ml-2" disabled={busy} value={settings.cooldown_minutes}
              onChange={(e) => void save({ cooldown_minutes: Number(e.target.value) })}>
              {[5, 10, 15, 30, 60].map((v) => <option key={v} value={v}>{v} min</option>)}
            </select>
          </label>
        </div>
      )}
      <p className="text-xs text-mute">
        Versão inicial: o ranking é calculado com a aba Mapa aberta. O servidor conclui trocas na fila
        com a aba fechada, mas ainda não descobre novas melhores hunts sozinho.
      </p>
      {notice && <p className="text-xs text-poke-gold" role="status">{notice}</p>}
    </section>
  );
}
