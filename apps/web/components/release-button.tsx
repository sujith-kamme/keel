"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { release } from "@/app/(console)/review/actions";

export function ReleaseButton({ sessionId, className = "b xs" }: { sessionId: string; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const click = () => {
    if (!window.confirm("Release this session back to ACTIVE?")) return;
    setError(null);
    start(async () => {
      const r = await release(sessionId);
      if (r.ok) router.refresh();
      else setError(r.message);
    });
  };
  return (
    <span className="inline-flex items-center gap-2">
      <button onClick={click} disabled={pending} className={className}>
        Release
      </button>
      {error && (
        <span className="sm" style={{ color: "var(--bad)" }}>
          {error}
        </span>
      )}
    </span>
  );
}
