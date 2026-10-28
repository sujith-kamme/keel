"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/operator";
import { decide, sandbox } from "../actions";

const btn = "rounded border border-black/20 px-3 py-1 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10";

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (confirmText: string, fn: () => Promise<ActionResult>) => () => {
    if (!window.confirm(confirmText)) return;
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.ok) router.refresh();
      else setError(r.message);
    });
  };
  return { pending, error, run };
}

export function DecisionButtons({ id, actions }: { id: string; actions: ("evidence" | "accept")[] }) {
  const { pending, error, run } = useAction();
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {actions.includes("evidence") && (
        <button className={btn} disabled={pending} onClick={run("Submit Keel's evidence pack to PayPal?", () => decide(id, "evidence"))}>
          Submit evidence
        </button>
      )}
      {actions.includes("accept") && (
        <button className={btn} disabled={pending} onClick={run("Accept the claim? PayPal refunds the buyer.", () => decide(id, "accept"))}>
          Accept claim
        </button>
      )}
      {error && <span className="text-sm text-red-700 dark:text-red-300">{error}</span>}
    </div>
  );
}

export function SandboxButtons({ id, canEscalate, canRule }: { id: string; canEscalate: boolean; canRule: boolean }) {
  const { pending, error, run } = useAction();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button className={btn} disabled={pending || !canEscalate} onClick={run("Escalate this dispute to a claim?", () => sandbox(id, "escalate"))}>
        Escalate to claim
      </button>
      <button className={btn} disabled={pending || !canRule} onClick={run("Resolve in the merchant's favour?", () => sandbox(id, "seller"))}>
        Resolve: seller wins
      </button>
      <button className={btn} disabled={pending || !canRule} onClick={run("Resolve in the buyer's favour?", () => sandbox(id, "buyer"))}>
        Resolve: buyer wins
      </button>
      {!canRule && <span className="text-xs opacity-70">PayPal hasn&apos;t offered a ruling yet.</span>}
      {error && <span className="text-sm text-red-700 dark:text-red-300">{error}</span>}
    </div>
  );
}
