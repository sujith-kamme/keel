"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { login } from "./actions";

const field = { display: "flex", flexDirection: "column", gap: 6 } as const;

export function LoginForm() {
  const [state, action, pending] = useActionState(login, {});
  const next = useSearchParams().get("next") ?? "";
  return (
    <form
      action={action}
      className="pnl"
      style={{ width: "100%", padding: 24, display: "flex", flexDirection: "column", gap: 16, boxSizing: "border-box", boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}
    >
      <input type="hidden" name="next" value={next} />
      <div style={field}>
        <label htmlFor="email" className="lbl" style={{ color: "var(--text)" }}>
          Email
        </label>
        <input id="email" name="email" type="email" className="in" autoComplete="username" required style={{ height: 36, width: "100%" }} />
      </div>
      <div style={field}>
        <label htmlFor="password" className="lbl" style={{ color: "var(--text)" }}>
          Password
        </label>
        <input id="password" name="password" type="password" className="in" autoComplete="current-password" required style={{ height: 36, width: "100%" }} />
      </div>
      {state.error && (
        <p role="alert" className="sm" style={{ margin: 0, color: "var(--bad)" }}>
          {state.error}
        </p>
      )}
      <button type="submit" className="b pri" disabled={pending} style={{ height: 36, width: "100%", opacity: pending ? 0.6 : undefined }}>
        Sign in
      </button>
    </form>
  );
}
