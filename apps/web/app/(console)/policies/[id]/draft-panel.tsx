"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { type PolicyRow, policyDiff } from "@/lib/policies-view";
import { utcTime } from "@/lib/overview-view";
import { approve, discard } from "../actions";
import { RuleEditor } from "./rule-editor";

/** The pending draft: what it changes, and approve as drafted, edit before approving, or discard. */
export function DraftPanel({ policyId, active, draft }: { policyId: string; active: PolicyRow | null; draft: PolicyRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const diff = policyDiff(active, draft);
  const changes = diff.filter((d) => d.changed).length;
  const page = `/policies/${encodeURIComponent(policyId)}`;

  function onApprove() {
    if (!window.confirm(`Approve version ${draft.version}? The engine enforces it immediately.`)) return;
    setError(null);
    start(async () => {
      const r = await approve(policyId, draft.version, draft.approved_text, draft.rules);
      if (!r.ok) return setError(r.message);
      router.push(`${page}?approved=${draft.version}`);
    });
  }

  function onDiscard() {
    if (!window.confirm(`Discard draft version ${draft.version}? It is kept in the history but can't be approved.`)) return;
    setError(null);
    start(async () => {
      const r = await discard(policyId, draft.version);
      if (!r.ok) return setError(r.message);
      router.push(`${page}?discarded=${draft.version}`);
    });
  }

  return (
    <section className="pnl" style={{ borderColor: "var(--warn-line)" }} aria-labelledby="dr-h">
      <div className="pnl-h" style={{ background: "var(--warn-bg)", borderColor: "var(--warn-line)", flexWrap: "wrap" }}>
        <div>
          <h2 id="dr-h">Draft v{draft.version} awaiting approval</h2>
          <div className="sm mut">
            Drafted {utcTime(draft.created_at)} UTC · {changes === 1 ? "1 change" : `${changes} changes`}
          </div>
        </div>
        <div className="acts">
          <button type="button" className="b" disabled={pending} onClick={onDiscard}>
            Discard
          </button>
          <button type="button" className="b" aria-expanded={editing} onClick={() => setEditing((e) => !e)}>
            {editing ? "Close editor" : "Edit before approving"}
          </button>
          <button type="button" className="b pri" disabled={pending} onClick={onApprove}>
            {pending ? "Working…" : `Approve v${draft.version}`}
          </button>
        </div>
      </div>
      {error && (
        <p className="msg bad sm" role="alert" style={{ margin: 0, padding: "8px 16px" }}>
          {error}
        </p>
      )}
      <div className="tw">
        <table className="t">
          <thead>
            <tr>
              <th scope="col">Rule</th>
              <th scope="col">{active ? `Active v${active.version}` : "Active"}</th>
              <th scope="col">Draft v{draft.version}</th>
            </tr>
          </thead>
          <tbody>
            {diff.map((d) => (
              <tr key={d.label} style={d.changed ? { background: "var(--warn-bg)" } : undefined}>
                <td>{d.label}</td>
                <td className="mut" style={{ whiteSpace: "normal", textDecoration: d.changed && d.before !== null ? "line-through" : undefined }}>
                  {d.before ?? "—"}
                </td>
                <td style={{ whiteSpace: "normal", fontWeight: d.changed ? 600 : undefined }}>{d.after ?? "Removed"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <RuleEditor key={draft.version} policyId={policyId} active={active} draft={draft} />}
      <div className="tfoot">
        <span>Approving makes certification stale until the Gauntlet runs again.</span>
      </div>
    </section>
  );
}
