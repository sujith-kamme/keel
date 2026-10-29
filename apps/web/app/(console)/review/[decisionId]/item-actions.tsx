"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { approve, deny } from "../actions";

/** Deny or approve one held action; back to the queue once it is resolved. */
export function ItemActions({ decisionId, summary, approveLabel }: { decisionId: string; summary: string; approveLabel: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (label: string, fn: typeof approve) => () => {
    if (!window.confirm(`${label} ${summary}?`)) return;
    setError(null);
    start(async () => {
      const r = await fn(decisionId);
      if (r.ok) router.push("/review");
      else setError(r.message);
    });
  };
  return (
    <>
      {error && (
        <span className="sm" style={{ color: "var(--bad)" }}>
          {error}
        </span>
      )}
      <button className="b" disabled={pending} onClick={run("Deny", deny)}>
        Deny
      </button>
      <button className="b pri" disabled={pending} onClick={run("Approve", approve)}>
        {approveLabel}
      </button>
    </>
  );
}
