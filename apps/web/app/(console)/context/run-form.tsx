"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { P0_PACKS } from "@/lib/context-view";
import { startRun } from "./actions";

export function RunForm({ busy, hasLearned }: { busy: boolean; hasLearned: boolean }) {
  const router = useRouter();
  const [packs, setPacks] = useState<string[]>([...P0_PACKS]);
  const [repeats, setRepeats] = useState(3);
  const [guarded, setGuarded] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toggle = (p: string) => setPacks((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  const submit = () => {
    setError(null);
    start(async () => {
      const r = await startRun({ packs, repeats, guarded });
      if (r.ok) router.push(`/context?run=${encodeURIComponent(r.runId)}`);
      else setError(r.message);
    });
  };
  const all = hasLearned ? [...P0_PACKS, "learned"] : [...P0_PACKS];
  return (
    <form
      className="mt-6 flex max-w-2xl flex-col gap-3 rounded border border-black/10 p-4 dark:border-white/10"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h2 className="text-sm font-medium">Start a run</h2>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <legend className="sr-only">Packs</legend>
        {all.map((p) => (
          <label key={p} className="inline-flex items-center gap-1">
            <input type="checkbox" checked={packs.includes(p)} onChange={() => toggle(p)} /> {p}
          </label>
        ))}
        {!hasLearned && <span className="text-xs opacity-60">learned (no learned scenarios yet)</span>}
      </fieldset>
      <label className="text-sm">
        Repeats{" "}
        <select value={repeats} onChange={(e) => setRepeats(Number(e.target.value))} className="rounded border border-black/20 bg-transparent px-1 dark:border-white/20">
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="flex gap-4 text-sm">
        <legend className="sr-only">Reply guard</legend>
        <label className="inline-flex items-center gap-1">
          <input type="radio" name="guarded" checked={guarded} onChange={() => setGuarded(true)} /> Guarded
        </label>
        <label className="inline-flex items-center gap-1">
          <input type="radio" name="guarded" checked={!guarded} onChange={() => setGuarded(false)} /> Without reply guard
        </label>
      </fieldset>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || pending || packs.length === 0} className="rounded border border-black/20 px-3 py-1 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10">
          {pending ? "Starting…" : "Start run"}
        </button>
        {busy && <span className="text-xs opacity-70">A run is in progress.</span>}
        {error && <span className="text-xs text-red-700 dark:text-red-300">{error}</span>}
      </div>
    </form>
  );
}
