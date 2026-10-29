"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { saveSection } from "@/app/(console)/settings/actions";
import { PROMPTS } from "@/lib/prompt-labels";
import { useDrawer } from "@/lib/use-drawer";

const MODEL_DESC: Record<string, string> = {
  "claude-haiku-5-5": "Default. Fastest and cheapest.",
  "claude-sonnet-5-5": "Stronger reasoning, slower replies.",
  "claude-opus-5-5": "Most capable, slowest and most expensive.",
};
const ORDER = ["lenient", "strict"];

/** The agent model and system prompt (PUT /v1/settings/agent), opened from /agents?scope=<agent id>. */
export function ScopeDrawer({
  agentId,
  model,
  prompt,
  models,
  prompts,
  limits,
  policy,
}: {
  agentId: string;
  model: string;
  prompt: string;
  models: readonly string[];
  prompts: readonly string[];
  limits: { refunds: string | null; discounts: string | null };
  /** The policy agent's settings, sent unchanged: the section is saved whole. Task 13 gives it its own drawer. */
  policy: { model: string; prompt: string };
}) {
  const router = useRouter();
  const ref = useRef<HTMLElement>(null);
  const [m, setM] = useState(model);
  const [p, setP] = useState(prompt);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dirty = m !== model || p !== prompt;

  useDrawer(ref, { closeHref: "/agents", initial: "input:checked", fallbackId: "edit-scope" });

  const save = () => {
    setError(null);
    start(async () => {
      const r = await saveSection("agent", {
        policy_agent_model: policy.model,
        policy_agent_prompt: policy.prompt,
        refund_agent_model: m,
        refund_agent_prompt: p,
      });
      if (r.ok) router.push("/agents", { scroll: false });
      else setError(r.message);
    });
  };

  const sortedPrompts = [...prompts].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return (
    <>
      <div className="scrim" aria-hidden="true" onClick={() => router.push("/agents", { scroll: false })} />
      <section ref={ref} className="drawer" role="dialog" aria-modal="true" aria-labelledby="sc-h">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "20px 24px 16px", borderBottom: "1px solid var(--line)" }}>
          <div>
            <h2 id="sc-h" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
              Store support agent
            </h2>
            <p className="mono dim" style={{ margin: "2px 0 0", fontSize: 12 }}>
              {agentId}
            </p>
          </div>
          <Link className="ib" href="/agents" scroll={false} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </Link>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 24 }}>
          <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <legend className="lbl" style={{ padding: 0, marginBottom: 8 }}>
              Model
            </legend>
            {models.map((id) => (
              <label key={id} className={`opt ${id === m ? "on" : ""}`}>
                <input type="radio" name="model" value={id} checked={id === m} onChange={() => setM(id)} />
                <span style={{ flex: 1 }}>
                  <span className="mono" style={{ fontWeight: 500 }}>
                    {id}
                  </span>
                  {MODEL_DESC[id] && (
                    <span className="sm dim" style={{ display: "block" }}>
                      {MODEL_DESC[id]}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <legend className="lbl" style={{ padding: 0, marginBottom: 8 }}>
              System prompt
            </legend>
            {sortedPrompts.map((k) => (
              <label key={k} className={`opt ${k === p ? "on" : ""}`}>
                <input type="radio" name="prompt" value={k} checked={k === p} onChange={() => setP(k)} />
                <span style={{ flex: 1 }}>
                  <span style={{ fontWeight: 500 }}>{PROMPTS[k]?.label ?? k}</span>
                  {PROMPTS[k] && (
                    <span className="sm dim" style={{ display: "block" }}>
                      {PROMPTS[k].desc}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>

          <div className="pnl">
            <div className="pnl-h">
              <h2>Limits</h2>
              <Link href="/policies" className="sm">
                Edit in Policies
              </Link>
            </div>
            {limits.refunds || limits.discounts ? (
              <dl className="facts" style={{ margin: 0 }}>
                {limits.refunds && (
                  <div>
                    <dt>Refunds</dt>
                    <dd>{limits.refunds}</dd>
                  </div>
                )}
                {limits.discounts && (
                  <div>
                    <dt>Discounts</dt>
                    <dd>{limits.discounts}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="pnl-b sm mut" style={{ margin: 0 }}>
                No refund or discount limits in the approved policies.
              </p>
            )}
          </div>
        </div>

        {dirty && (
          <div style={{ display: "flex", gap: 10, padding: "10px 24px", background: "var(--warn-bg)", color: "var(--warn)", borderTop: "1px solid var(--warn-line)", fontSize: 13, lineHeight: "20px" }}>
            <i className="ic ic-shield s14" style={{ marginTop: 3 }} aria-hidden="true" />
            <span>Saving makes certification stale. The agent&apos;s next reply, in every conversation, uses the new settings.</span>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 24px", borderTop: "1px solid var(--line)", background: "var(--canvas)" }}>
          <span className={`sm ${error ? "msg bad" : "mut"}`} role="status" aria-live="polite">
            {error ?? "Recorded in the ledger"}
          </span>
          <span className="acts">
            <Link className="b" href="/agents" scroll={false}>
              Cancel
            </Link>
            <button className="b pri" disabled={pending || !dirty} onClick={save}>
              Save
            </button>
          </span>
        </div>
      </section>
    </>
  );
}
