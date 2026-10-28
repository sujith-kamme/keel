"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { type PolicyRow, type Rule, ruleSummary } from "@/lib/policies-view";
import { approve } from "../actions";

const btn = "rounded border border-black/20 px-3 py-1 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10";
const input = "w-28 rounded border border-black/20 bg-transparent px-2 py-1 text-sm dark:border-white/20";

/** The active rule of the same kind, when the draft changed it. */
function previous(rule: Rule, active: PolicyRow | null): string | null {
  const same = active?.rules.find((r) => r.rule === rule.rule);
  return same && JSON.stringify(same) !== JSON.stringify(rule) ? ruleSummary(same) : null;
}

function NumberField({ rule, onChange }: { rule: Rule; onChange: (r: Rule) => void }) {
  switch (rule.rule) {
    case "within_days_of":
      return (
        <label className="text-xs">
          Days{" "}
          <input type="number" min={1} step={1} className={input} value={Number.isNaN(rule.days) ? "" : rule.days} onChange={(e) => onChange({ ...rule, days: e.target.valueAsNumber })} />
        </label>
      );
    case "discount_percent_le":
      return (
        <label className="text-xs">
          Percent{" "}
          <input type="number" min={0} max={100} step="any" className={input} value={Number.isNaN(rule.percent) ? "" : rule.percent} onChange={(e) => onChange({ ...rule, percent: e.target.valueAsNumber })} />
        </label>
      );
    case "session_budget_le":
    case "daily_budget_le":
    case "auto_approve_le":
      return (
        <label className="text-xs">
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
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <div className="rounded border border-black/10 p-4 dark:border-white/10">
        <h2 className="font-semibold">Active{active ? ` · v${active.version}` : ": none"}</h2>
        {active && (
          <>
            <p className="mt-2 text-sm whitespace-pre-wrap">{active.approved_text}</p>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {active.rules.map((r, i) => (
                <li key={i}>{ruleSummary(r)}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="rounded border border-amber-300 p-4 dark:border-amber-700">
        <h2 className="font-semibold">Draft · v{draft.version}</h2>
        <label className="mt-2 block text-xs opacity-80" htmlFor="approved-text">
          What the agent may tell customers
        </label>
        <textarea id="approved-text" value={text} onChange={(e) => setText(e.target.value)} rows={4} className="mt-1 w-full rounded border border-black/20 bg-transparent p-2 text-sm dark:border-white/20" />
        <ul className="mt-3 flex flex-col gap-3">
          {rules.length === 0 && <li className="text-sm opacity-70">No rules.</li>}
          {rules.map(({ key, rule }) => {
            const was = previous(rule, active);
            return (
              <li key={key} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="min-w-56 flex-1">
                  {ruleSummary(rule)}
                  {was && <span className="block text-xs text-amber-700 dark:text-amber-300">was: {was}</span>}
                </span>
                <NumberField rule={rule} onChange={(next) => setRules((rs) => rs.map((r) => (r.key === key ? { key, rule: next } : r)))} />
                <button type="button" className={btn} onClick={() => setRules((rs) => rs.filter((r) => r.key !== key))}>
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className={btn} disabled={pending} onClick={onApprove}>
            {pending ? "Approving…" : `Approve version ${draft.version}`}
          </button>
          {error && <span className="text-sm text-red-700 dark:text-red-300">{error}</span>}
        </div>
      </div>
    </div>
  );
}
