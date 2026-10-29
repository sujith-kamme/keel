"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { P0_PACKS, packLabel } from "@/lib/context-view";
import { useDrawer } from "@/lib/use-drawer";
import { startRun } from "./actions";

/** Starts a Gauntlet run (POST /v1/gauntlet/runs), opened from /context?new=1. `packs` carries each pack's scenario count. */
export function NewRunDrawer({ packs, busy, closeHref }: { packs: { id: string; count: number }[]; busy: boolean; closeHref: string }) {
  const router = useRouter();
  const ref = useRef<HTMLElement>(null);
  const [picked, setPicked] = useState<string[]>(() => P0_PACKS.filter((p) => packs.some((x) => x.id === p && x.count > 0)));
  const [repeats, setRepeats] = useState(3);
  const [guarded, setGuarded] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toggle = (p: string) => setPicked((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  const conversations = packs.filter((p) => picked.includes(p.id)).reduce((s, p) => s + p.count, 0) * repeats;

  useDrawer(ref, { closeHref, initial: "input:not([disabled])", fallbackId: "new-run" });

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await startRun({ packs: picked, repeats, guarded });
      if (r.ok) router.push(`/context?run=${encodeURIComponent(r.runId)}`, { scroll: false });
      else setError(r.message);
    });
  };

  return (
    <>
      <div className="scrim" aria-hidden="true" onClick={() => router.push(closeHref, { scroll: false })} />
      <section ref={ref} className="drawer" role="dialog" aria-modal="true" aria-labelledby="nr-h" style={{ width: "min(480px,100%)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "20px 24px 16px", borderBottom: "1px solid var(--line)" }}>
          <div>
            <h2 id="nr-h" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
              New Gauntlet run
            </h2>
            <p className="mut" style={{ margin: "2px 0 0", fontSize: 13 }}>
              Runs simulated conversations against the agent in production.
            </p>
          </div>
          <Link className="ib" href={closeHref} scroll={false} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </Link>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 24 }}>
          <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <legend className="lbl" style={{ padding: 0, marginBottom: 8 }}>
              Scenario packs
            </legend>
            <div className="pnl">
              {packs.map((p, i) => (
                <label
                  key={p.id}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderTop: i > 0 ? "1px solid var(--line-soft)" : undefined, cursor: p.count > 0 ? "pointer" : "default", opacity: p.count > 0 ? 1 : 0.6 }}
                >
                  <input type="checkbox" checked={picked.includes(p.id)} disabled={p.count === 0} onChange={() => toggle(p.id)} style={{ width: 16, height: 16, accentColor: "var(--accent)" }} />
                  <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                    <span style={{ fontWeight: 500 }}>{packLabel(p.id)}</span>
                    <span className="mono dim" style={{ fontSize: 12 }}>
                      {p.id}
                    </span>
                  </span>
                  <span className="sm dim">{p.count === 1 ? "1 scenario" : `${p.count} scenarios`}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="lbl" id="rep-l">
              Repeats per scenario
            </span>
            <div className="segc" role="group" aria-labelledby="rep-l" style={{ alignSelf: "flex-start" }}>
              {[1, 2, 3, 4, 5].map((r) => (
                <button key={r} type="button" className={r === repeats ? "on" : undefined} aria-pressed={r === repeats} onClick={() => setRepeats(r)}>
                  {r}×
                </button>
              ))}
            </div>
            <span className="sm dim">Model output varies; repeats show whether a pass is stable.</span>
          </div>

          <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <legend className="lbl" style={{ padding: 0, marginBottom: 8 }}>
              Mode
            </legend>
            <label className={`opt ${guarded ? "on" : ""}`}>
              <input type="radio" name="mode" checked={guarded} onChange={() => setGuarded(true)} />
              <span>
                <span style={{ fontWeight: 500 }}>Guarded</span>
                <span className="sm dim" style={{ display: "block" }}>
                  Replies pass through Keel. Counts toward certification.
                </span>
              </span>
            </label>
            <label className={`opt ${guarded ? "" : "on"}`}>
              <input type="radio" name="mode" checked={!guarded} onChange={() => setGuarded(false)} />
              <span>
                <span style={{ fontWeight: 500 }}>No reply guard</span>
                <span className="sm dim" style={{ display: "block" }}>
                  Baseline: what the agent does without Keel. Never certifies.
                </span>
              </span>
            </label>
          </fieldset>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 24px", borderTop: "1px solid var(--line)", background: "var(--canvas)" }}>
          <span className={`sm ${error ? "msg bad" : "mut"}`} role="status" aria-live="polite">
            {error ?? (busy ? "A run is in progress." : `${conversations.toLocaleString("en-US")} conversations`)}
          </span>
          <span className="acts">
            <Link className="b" href={closeHref} scroll={false}>
              Cancel
            </Link>
            <button className="b pri" disabled={busy || pending || picked.length === 0} onClick={submit}>
              {pending ? "Starting…" : "Start run"}
            </button>
          </span>
        </div>
      </section>
    </>
  );
}
