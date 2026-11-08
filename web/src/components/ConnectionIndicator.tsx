import { useEffect, useState } from "react";
import { useLink } from "@/lib/telemetry";

/** Saúde do link com a VPS: Ao vivo (<5s) / Atrasado (≤15s) / Sem dados / Reconectando. */
export function ConnectionIndicator() {
  const link = useLink();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  const age = link.lastMessageAt ? (now - link.lastMessageAt) / 1000 : null;
  let dot = "bg-poke-green";
  let text = "Ao vivo";
  if (link.state === "connecting") [dot, text] = ["bg-mute animate-pulse", "Conectando"];
  else if (link.state === "reconnecting")
    [dot, text] = ["bg-poke-red animate-pulse", `Reconectando${link.attempts > 1 ? ` #${link.attempts}` : ""}`];
  else if (age === null || age > 15) [dot, text] = ["bg-poke-red", "Sem dados"];
  else if (age > 5) [dot, text] = ["bg-poke-yellow", `Atrasado ${Math.floor(age)}s`];

  return (
    <span
      className="inline-flex items-center gap-2 rounded-lg border border-line bg-tile px-2.5 py-1.5 text-xs font-semibold text-fg sm:px-3 sm:py-2 sm:text-sm"
      title={text}
      role="status"
    >
      <span className={`size-2.5 rounded-full ${dot}`} />
      <span className="hidden sm:inline">{text}</span>
    </span>
  );
}
