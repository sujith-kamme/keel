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
  const cls = danger ? (next ? "b dng" : "b") : "b xs";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {error && (
        <span className="sm" style={{ color: "var(--bad)" }} role="alert">
          {error}
        </span>
      )}
      <button onClick={click} disabled={pending} className={cls}>
        {text}
      </button>
    </span>
  );
}
