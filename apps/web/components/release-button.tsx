"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { release } from "@/app/(console)/review/actions";

export function ReleaseButton({ sessionId }: { sessionId: string }) {
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
      <button onClick={click} disabled={pending} className="rounded border border-black/20 px-2 py-0.5 text-xs hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10">
        Release
      </button>
      {error && <span className="text-xs text-red-700 dark:text-red-300">{error}</span>}
    </span>
  );
}
