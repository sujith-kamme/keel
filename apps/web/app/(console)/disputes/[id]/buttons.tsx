"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/operator";
import { decide, sandbox } from "../actions";

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

const ErrorText = ({ message }: { message: string }) => (
  <span className="sm" style={{ color: "var(--bad)" }}>
    {message}
  </span>
);

export function DecisionButtons({ id, actions }: { id: string; actions: ("evidence" | "accept")[] }) {
  const { pending, error, run } = useAction();
  return (
    <>
      {error && <ErrorText message={error} />}
      {actions.includes("accept") && (
        <button className="b" disabled={pending} onClick={run("Accept the claim? PayPal refunds the buyer.", () => decide(id, "accept"))}>
          Accept claim
        </button>
      )}
      {actions.includes("evidence") && (
        <button className="b pri" disabled={pending} onClick={run("Submit Keel's evidence pack to PayPal?", () => decide(id, "evidence"))}>
          Submit evidence
        </button>
      )}
    </>
  );
}

export function SandboxButtons({ id, canEscalate, canRule }: { id: string; canEscalate: boolean; canRule: boolean }) {
  const { pending, error, run } = useAction();
  return (
    <div className="acts" style={{ marginTop: 12 }}>
      <button className="b xs" disabled={pending || !canEscalate} onClick={run("Escalate this dispute to a claim?", () => sandbox(id, "escalate"))}>
        Escalate to claim
      </button>
      <button className="b xs" disabled={pending || !canRule} onClick={run("Resolve in the merchant's favour?", () => sandbox(id, "seller"))}>
        Resolve: seller wins
      </button>
      <button className="b xs" disabled={pending || !canRule} onClick={run("Resolve in the buyer's favour?", () => sandbox(id, "buyer"))}>
        Resolve: buyer wins
      </button>
      {!canRule && <span className="sm dim">PayPal hasn&apos;t offered a ruling yet.</span>}
      {error && <ErrorText message={error} />}
    </div>
  );
}
