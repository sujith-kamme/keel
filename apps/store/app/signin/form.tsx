"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn } from "./actions";

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <form action={action} style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <h1 className="serif" style={{ margin: 0, fontSize: 26, lineHeight: "32px", fontWeight: 500 }}>
          Sign in
        </h1>
        <p className="mut" style={{ margin: "4px 0 0" }}>
          Track orders, get help, and check out faster.
        </p>
      </div>
      <input type="hidden" name="next" value={next} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label htmlFor="email" className="sl">
          Email
        </label>
        <input id="email" name="email" type="email" className="sin" autoComplete="email" required defaultValue="maya@gmail.com" />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label htmlFor="password" className="sl">
          Password
        </label>
        <input id="password" name="password" type="password" className="sin" autoComplete="current-password" required />
      </div>
      {state?.error && (
        <p role="alert" className="small" style={{ margin: 0, color: "var(--bad)" }}>
          {state.error}
        </p>
      )}
      <button type="submit" className="sbtn pri" disabled={pending} style={{ width: "100%" }}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className="small dim" style={{ margin: 0 }}>
        Demo accounts: maya@gmail.com and sam@gmail.com, with the demo password from the submission.
      </p>
      <Link href="/" className="small mut">
        Continue as guest
      </Link>
    </form>
  );
}
