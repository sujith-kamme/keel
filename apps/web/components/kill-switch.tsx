"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setAgentFrozen } from "@/app/(console)/agents/actions";

export function KillSwitch({ agentId, frozen, label, danger }: { agentId: string; frozen: boolean; label: string; danger?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const next = !frozen;
  const text = `${next ? "Freeze" : "Unfreeze"} ${label}`;
  const click = () => {
    if (!window.confirm(`${text}?`)) return;
    setError(null);
    start(async () => {
      const r = await setAgentFrozen(agentId, next);
      if (r.ok) router.refresh();
      else setError(r.message);
    });
  };
  const tone = danger && next ? "border-red-600 bg-red-600 text-white hover:bg-red-700" : "border-black/20 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10";
  return (
    <div className="flex items-center gap-2">
      <button onClick={click} disabled={pending} className={`rounded border px-3 py-1 text-sm disabled:opacity-50 ${tone}`}>
        {text}
      </button>
      {error && <span className="text-xs text-red-700 dark:text-red-300">{error}</span>}
    </div>
  );
}
