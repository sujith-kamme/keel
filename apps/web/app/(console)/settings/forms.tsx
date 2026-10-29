"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/operator";
import { changeEmail, changePassword, saveSection, signOutEverywhere, testZapier } from "./actions";

type Msg = { ok: boolean; text: string } | null;

/** Runs a server action in a transition and keeps its outcome as an inline message. */
function useAction() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const run = (fn: () => Promise<ActionResult | { ok: boolean; message: string }>, onOk?: () => void, okText = "Saved") => {
    setMsg(null);
    start(async () => {
      const r = await fn();
      if (r.ok) onOk?.();
      setMsg({ ok: r.ok, text: "message" in r ? r.message : okText });
    });
  };
  return { pending, msg, setMsg, run };
}

/** Always mounted so screen readers announce each new message. */
const Status = ({ msg }: { msg: Msg }) => (
  <span className={`msg ${msg ? (msg.ok ? "ok" : "bad") : ""}`} role="status" aria-live="polite">
    {msg?.text}
  </span>
);

const submit = (fn: () => void) => (e: FormEvent) => {
  e.preventDefault();
  fn();
};

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="fld">
      <label htmlFor={id} className="lbl">
        {label}
      </label>
      {children}
      {hint && (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
    </div>
  );
}

const Models = ({ models }: { models: readonly string[] }) => models.map((m) => <option key={m}>{m}</option>);

const StaleNote = ({ children }: { children: ReactNode }) => (
  <div className="note warn">
    <i className="ic ic-shield s14" style={{ marginTop: 3 }} aria-hidden="true" />
    <span>{children}</span>
  </div>
);

export function EmailForm({ email }: { email: string }) {
  const router = useRouter();
  const [value, setValue] = useState(email);
  const { pending, msg, run } = useAction();
  return (
    <form className="pnl" onSubmit={submit(() => run(() => changeEmail(value), () => router.refresh()))}>
      <div className="pnl-h">
        <h2>Sign-in email</h2>
      </div>
      <div className="pnl-b grid2">
        <Field id="em" label="Email" hint="You sign in with this. Approvals in the ledger are recorded under it.">
          <input id="em" className="in" type="email" required maxLength={254} autoComplete="username" aria-describedby="em-hint" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
      </div>
      <div className="sfoot">
        <Status msg={msg} />
        <button className="b" disabled={pending || value.trim().toLowerCase() === email}>
          Save email
        </button>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [v, setV] = useState({ current: "", next: "", confirm: "" });
  const { pending, msg, run } = useAction();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  return (
    <form
      className="pnl"
      onSubmit={submit(() => run(() => changePassword(v.current, v.next, v.confirm), () => setV({ current: "", next: "", confirm: "" }), "Password updated. Other sessions are signed out."))}
    >
      <div className="pnl-h">
        <h2>Password</h2>
      </div>
      <div className="pnl-b grid2">
        <div style={{ gridColumn: "1 / -1", maxWidth: "calc(50% - 10px)", minWidth: 0 }}>
          <Field id="p0" label="Current password">
            <input id="p0" type="password" className="in" required maxLength={128} autoComplete="current-password" value={v.current} onChange={set("current")} />
          </Field>
        </div>
        <Field id="p1" label="New password" hint="At least 12 characters.">
          <input id="p1" type="password" className="in" required minLength={12} maxLength={128} autoComplete="new-password" aria-describedby="p1-hint" value={v.next} onChange={set("next")} />
        </Field>
        <Field id="p2" label="Confirm new password">
          <input id="p2" type="password" className="in" required minLength={12} maxLength={128} autoComplete="new-password" value={v.confirm} onChange={set("confirm")} />
        </Field>
      </div>
      <div className="sfoot">
        <span>After 5 wrong attempts, sign-in locks for 15 minutes.</span>
        <span className="acts">
          <Status msg={msg} />
          <button className="b" disabled={pending}>
            Update password
          </button>
        </span>
      </div>
    </form>
  );
}

export function SignOutEverywhere() {
  const { pending, msg, run } = useAction();
  return (
    <div className="pnl row" style={{ borderColor: "var(--bad-line)", flexWrap: "wrap" }}>
      <div>
        <div style={{ fontWeight: 500 }}>Sign out everywhere</div>
        <div className="sm mut">Ends every console session, including this one.</div>
      </div>
      <span className="acts">
        <Status msg={msg} />
        <button className="b" style={{ color: "var(--bad)", borderColor: "var(--bad-line)" }} disabled={pending} onClick={() => run(signOutEverywhere)}>
          Sign out everywhere
        </button>
      </span>
    </div>
  );
}

type Guard = { extractor_model: string; extractor_timeout_ms: number; risk_threshold: number; risk_half_life_min: number };
const str = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, String(x)])) as Record<keyof T, string>;

export function GuardForm({ values, models }: { values: Guard; models: readonly string[] }) {
  const [saved, setSaved] = useState(str(values));
  const [v, setV] = useState(saved);
  const { pending, msg, setMsg, run } = useAction();
  const dirty = (Object.keys(v) as (keyof Guard)[]).some((k) => v[k] !== saved[k]);
  const set = (k: keyof Guard) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const save = () =>
    run(
      () =>
        saveSection("guard", {
          extractor_model: v.extractor_model,
          extractor_timeout_ms: Number(v.extractor_timeout_ms),
          risk_threshold: Number(v.risk_threshold),
          risk_half_life_min: Number(v.risk_half_life_min),
        }),
      () => setSaved(v),
    );
  return (
    <form className="pnl" onSubmit={submit(save)}>
      <div className="pnl-b grid2">
        <Field id="xm" label="Reply-check model" hint="Reads each agent reply for commitments no policy allows.">
          <select id="xm" className="in" aria-describedby="xm-hint" value={v.extractor_model} onChange={set("extractor_model")}>
            <Models models={models} />
          </select>
        </Field>
        <Field id="xt" label="Reply-check timeout (ms)" hint="1,000–10,000. A timeout blocks the reply.">
          <input id="xt" className="in" type="number" required min={1000} max={10000} step={1} aria-describedby="xt-hint" value={v.extractor_timeout_ms} onChange={set("extractor_timeout_ms")} />
        </Field>
        <Field id="rt" label="Risk threshold" hint="1–100. A conversation scoring this or higher is quarantined.">
          <input id="rt" className="in" type="number" required min={1} max={100} aria-describedby="rt-hint" value={v.risk_threshold} onChange={set("risk_threshold")} />
        </Field>
        <Field id="rh" label="Risk signal half-life (minutes)" hint="1–1,440. How fast suspicious signals fade.">
          <input id="rh" className="in" type="number" required min={1} max={1440} aria-describedby="rh-hint" value={v.risk_half_life_min} onChange={set("risk_half_life_min")} />
        </Field>
      </div>
      {dirty && <StaleNote>Saving makes certification stale. Run the Gauntlet again to re-certify the versions in production.</StaleNote>}
      <div className="sfoot">
        <Status msg={msg} />
        <span className="acts">
          <button
            type="button"
            className="b"
            disabled={pending || !dirty}
            onClick={() => {
              setV(saved);
              setMsg(null);
            }}
          >
            Cancel
          </button>
          <button className="b pri" disabled={pending || !dirty}>
            Save guard settings
          </button>
        </span>
      </div>
    </form>
  );
}

export function GauntletForm({ values, models }: { values: { gauntlet_customer_model: string; gauntlet_concurrency: number }; models: readonly string[] }) {
  const [model, setModel] = useState(values.gauntlet_customer_model);
  const [concurrency, setConcurrency] = useState(String(values.gauntlet_concurrency));
  const { pending, msg, run } = useAction();
  return (
    <form className="pnl" onSubmit={submit(() => run(() => saveSection("gauntlet", { gauntlet_customer_model: model, gauntlet_concurrency: Number(concurrency) })))}>
      <div className="pnl-b grid2">
        <Field id="cm" label="Simulated customer model" hint="Plays the attacking customer.">
          <select id="cm" className="in" aria-describedby="cm-hint" value={model} onChange={(e) => setModel(e.target.value)}>
            <Models models={models} />
          </select>
        </Field>
        <Field id="cc" label="Parallel conversations" hint="1–10. Higher is faster but uses more API quota.">
          <input id="cc" className="in" type="number" required min={1} max={10} aria-describedby="cc-hint" value={concurrency} onChange={(e) => setConcurrency(e.target.value)} />
        </Field>
      </div>
      <div className="sfoot">
        <Status msg={msg} />
        <button className="b" disabled={pending}>
          Save
        </button>
      </div>
    </form>
  );
}

export function DisputesForm({ values }: { values: { dispute_auto_submit: boolean; dispute_poll_seconds: number } }) {
  const [auto, setAuto] = useState(values.dispute_auto_submit);
  const [confirming, setConfirming] = useState(false);
  const [poll, setPoll] = useState(String(values.dispute_poll_seconds));
  const { pending, msg, run } = useAction();
  // Turning it on asks first; turning it off does not.
  const flip = () => {
    if (auto) {
      setAuto(false);
      setConfirming(false);
    } else setConfirming(true);
  };
  return (
    <form className="pnl" onSubmit={submit(() => run(() => saveSection("disputes", { dispute_auto_submit: auto, dispute_poll_seconds: Number(poll) })))}>
      <div className="row" style={{ borderBottom: "1px solid var(--line-soft)" }}>
        <div>
          <div style={{ fontWeight: 500 }} id="auto-l">
            Act without review
          </div>
          <div className="sm mut" id="auto-d">
            Submit evidence for Defend and accept the claim for Concede, with no person involved. Review cases always wait for you.
          </div>
        </div>
        <label className={`sw ${auto ? "on" : ""}`}>
          <input type="checkbox" role="switch" aria-labelledby="auto-l" aria-describedby="auto-d" checked={auto} onChange={flip} />
          <span />
        </label>
      </div>
      {confirming && (
        <div className="note warn" style={{ borderTop: 0, borderBottom: "1px solid var(--warn-line)", justifyContent: "space-between", flexWrap: "wrap" }}>
          <span>Keel will act on PayPal disputes by itself. Each action is still written to the ledger.</span>
          <span className="acts">
            <button type="button" className="b xs" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="b xs pri"
              onClick={() => {
                setAuto(true);
                setConfirming(false);
              }}
            >
              Turn on
            </button>
          </span>
        </div>
      )}
      <div className="pnl-b grid2">
        <Field id="pi" label="Check PayPal every (seconds)" hint="30–3,600. A backup for missed PayPal webhooks.">
          <input id="pi" className="in" type="number" required min={30} max={3600} aria-describedby="pi-hint" value={poll} onChange={(e) => setPoll(e.target.value)} />
        </Field>
      </div>
      <div className="sfoot">
        <Status msg={msg} />
        <button className="b" disabled={pending || confirming}>
          Save
        </button>
      </div>
    </form>
  );
}

const MASKED = "https://hooks.zapier.com/hooks/catch/••••••/••••••";

export function ZapierCard({ configured: initial }: { configured: boolean }) {
  const [configured, setConfigured] = useState(initial);
  const [editing, setEditing] = useState(!initial);
  const [url, setUrl] = useState("");
  const save = useAction();
  const test = useAction();
  const pending = save.pending || test.pending;
  const saveHook = (hook: string | null) =>
    save.run(
      () => saveSection("zapier", { zapier_hook_url: hook }),
      () => {
        setConfigured(hook !== null);
        setEditing(hook === null);
        setUrl("");
        test.setMsg(null);
      },
      hook === null ? "Removed" : "Saved",
    );
  return (
    <div className="pnl">
      <div className="intg" style={{ borderBottom: "1px solid var(--line)" }}>
        <span className="lg" aria-hidden="true">
          Z
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>Zapier</div>
          <div className="sm mut">Posts an event to your Zap when something needs a person.</div>
        </div>
        <span className={`bdg ${configured ? "ok" : ""}`} style={{ marginLeft: "auto" }}>
          {configured ? "Connected" : "Not configured"}
        </span>
      </div>
      <form className="pnl-b" style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }} onSubmit={submit(() => saveHook(url.trim()))}>
        <div className="fld" style={{ flex: 1, minWidth: 260 }}>
          <label htmlFor="zh" className="lbl">
            Webhook URL
          </label>
          {editing ? (
            <input
              id="zh"
              className="in mono"
              type="url"
              required
              maxLength={2048}
              pattern="https://hooks\.zapier\.com/.*"
              placeholder="https://hooks.zapier.com/hooks/catch/…"
              autoComplete="off"
              aria-describedby="zh-hint"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          ) : (
            <input id="zh" className="in mono" value={MASKED} readOnly aria-describedby="zh-hint" />
          )}
          <span className="hint" id="zh-hint">
            Must start with https://hooks.zapier.com/. Saved hooks can be replaced, not read back.
          </span>
        </div>
        <span className="acts" style={{ marginBottom: 22 }}>
          {editing ? (
            <>
              <button className="b pri" disabled={pending} style={{ height: 36 }}>
                Save hook
              </button>
              {configured && (
                <button type="button" className="b" disabled={pending} style={{ height: 36 }} onClick={() => setEditing(false)}>
                  Cancel
                </button>
              )}
            </>
          ) : (
            <>
              <button type="button" className="b" disabled={pending} style={{ height: 36 }} onClick={() => setEditing(true)}>
                Replace
              </button>
              <button
                type="button"
                className="b"
                disabled={pending}
                style={{ height: 36, color: "var(--bad)" }}
                onClick={() => window.confirm("Remove the Zapier hook? Keel stops sending events.") && saveHook(null)}
              >
                Remove
              </button>
            </>
          )}
          {configured && (
            <button
              type="button"
              className="b"
              disabled={pending}
              style={{ height: 36 }}
              onClick={() => test.run(testZapier)}
            >
              Send test
            </button>
          )}
        </span>
      </form>
      <table className="t">
        <thead>
          <tr>
            <th scope="col">Event sent</th>
            <th scope="col">Name in payload</th>
          </tr>
        </thead>
        <tbody>
          {EVENTS.map(([name, title, desc]) => (
            <tr key={name}>
              <td style={{ whiteSpace: "normal" }}>
                <div style={{ fontWeight: 500 }}>{title}</div>
                <div className="sm mut">{desc}</div>
              </td>
              <td className="mono mut">{name}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sfoot">
        <span>Failed sends are tried up to 5 times.</span>
        <span className="acts">
          <Status msg={save.msg} />
          <Status msg={test.msg} />
        </span>
      </div>
    </div>
  );
}

// The events apps/worker/src/jobs/notify.ts sends (keel.test is only the "Send test" event).
const EVENTS = [
  ["session.quarantined", "Session quarantined", "A conversation crossed the risk threshold."],
  ["action.held", "Action held for approval", "A refund or discount is waiting in the review queue."],
  ["dispute.classified", "Dispute classified", "PayPal opened a dispute and Keel classified it."],
] as const;
