"use server";

import { redirect } from "next/navigation";
import { passwordMatches, startCustomerSession, endCustomerSession } from "@/lib/customer";
import { lockout } from "@/lib/lockout";
import { DEMO_CUSTOMERS, safeNext, SignInBody } from "@/lib/store-input";

const attempts = lockout();

export type SignInState = { error: string } | null;

export async function signIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const body = SignInBody.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!body.success) return { error: "Enter your email and password." };
  const { email, password } = body.data;
  const now = Date.now();
  if (attempts.locked(email, now)) return { error: "Too many attempts. Try again in 15 minutes." };
  // Only the demo customers have accounts; any other email fails like a wrong password.
  if (!DEMO_CUSTOMERS.some((c) => c.email === email) || !passwordMatches(password)) {
    attempts.fail(email, now);
    return { error: "That email and password don't match." };
  }
  attempts.succeed(email);
  await startCustomerSession(email);
  redirect(safeNext(form.get("next")));
}

export async function signOut() {
  await endCustomerSession();
  redirect("/");
}
