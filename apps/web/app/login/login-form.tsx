"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { login } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, {});
  const next = useSearchParams().get("next") ?? "";
  const field = "rounded border border-black/20 bg-transparent px-3 py-2 text-sm dark:border-white/20";
  return (
    <form action={action} className="flex w-72 flex-col gap-3">
      <img src="/keel-logo-on-light-transparent.svg" alt="Keel" className="h-10 w-auto self-start dark:hidden" />
      <img src="/keel-logo-on-dark-transparent.svg" alt="Keel" className="hidden h-10 w-auto self-start dark:block" />
      <h1 className="text-lg font-semibold">Keel console</h1>
      <input type="hidden" name="next" value={next} />
      <input name="email" type="email" placeholder="Email" autoComplete="username" required className={field} />
      <input name="password" type="password" placeholder="Password" autoComplete="current-password" required className={field} />
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      <button disabled={pending} className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black">
        Sign in
      </button>
    </form>
  );
}
