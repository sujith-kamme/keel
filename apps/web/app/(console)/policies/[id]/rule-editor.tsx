"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { type PolicyRow, type Rule, ruleSummary } from "@/lib/policies-view";
import { approve } from "../actions";

const input = "in w-28";

/** The active rule of the same kind, when the draft changed it. */
function previous(rule: Rule, active: PolicyRow | null): string | null {
  const same = active?.rules.find((r) => r.rule === rule.rule);
  return same && JSON.stringify(same) !== JSON.stringify(rule) ? ruleSummary(same) : null;
}

function NumberField({ rule, onChange }: { rule: Rule; onChange: (r: Rule) => void }) {
  switch (rule.rule) {
    case "within_days_of":
      return (
        <label className="sm mut">
          Days{" "}
          <input type="number" min={1} step={1} className={input} value={Number.isNaN(rule.days) ? "" : rule.days} onChange={(e) => onChange({ ...rule, days: e.target.valueAsNumber })} />
        </label>
      );
    case "discount_percent_le":
      return (
        <label className="sm mut">
          Percent{" "}
          <input type="number" min={0} max={100} step="any" className={input} value={Number.isNaN(rule.percent) ? "" : rule.percent} onChange={(e) => onChange({ ...rule, percent: e.target.valueAsNumber })} />
        </label>
      );
    case "session_budget_le":
    case "daily_budget_le":
    case "auto_approve_le":
      return (
        <label className="sm mut">
          Amount ${" "}
          <input type="number" min={0} step="0.01" className={input} value={rule.amount} onChange={(e) => onChange({ ...rule, amount: e.target.value })} />
        </label>
      );
    default:
      return null;
  }
}

export function RuleEditor({ policyId, active, draft }: { policyId: string; active: PolicyRow | null; draft: PolicyRow }) {
  const router = useRouter();
  const [text, setText] = useState(draft.approved_text);
  const [rules, setRules] = useState(draft.rules.map((rule, key) => ({ key, rule })));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onApprove() {
    if (!window.confirm(`Approve version ${draft.version}? The engine enforces it immediately.`)) return;
    setError(null);
    start(async () => {
      const r = await approve(policyId, draft.version, text, rules.map((r) => r.rule));
      if (!r.ok) return setError(r.message);
      router.push(`/policies/${encodeURIComponent(policyId)}?approved=${draft.version}`);
    });
  }

  return (
    <div className="pnl-b stk" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="fld">
        <label className="lbl" htmlFor="approved-text">
          What the agent may tell customers
        </label>
        <textarea id="approved-text" value={text} onChange={(e) => setText(e.target.value)} rows={4} className="in" style={{ height: "auto", padding: 10, width: "100%" }} />
      </div>
      <ul className="stk" style={{ margin: 0, padding: 0, listStyle: "none", gap: 12 }}>
        {rules.length === 0 && <li className="mut">No rules.</li>}
        {rules.map(({ key, rule }) => {
          const was = previous(rule, active);
          return (
            <li key={key} className="flex flex-wrap items-center gap-3">
              <span className="min-w-56 flex-1">
                {ruleSummary(rule)}
                {was && (
                  <span className="sm block" style={{ color: "var(--warn)" }}>
                    was: {was}
                  </span>
                )}
              </span>
              <NumberField rule={rule} onChange={(next) => setRules((rs) => rs.map((r) => (r.key === key ? { key, rule: next } : r)))} />
              <button type="button" className="b xs" onClick={() => setRules((rs) => rs.filter((r) => r.key !== key))}>
                Remove
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="b pri" disabled={pending} onClick={onApprove}>
          {pending ? "Approving…" : `Approve v${draft.version} with these edits`}
        </button>
        {error && <span className="msg bad sm">{error}</span>}
      </div>
    </div>
  );
}
