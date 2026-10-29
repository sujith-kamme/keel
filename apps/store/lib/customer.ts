import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "./env";
import { seal, unseal } from "./seal";

const NAME = "tidewell_customer";
const DAYS_MS = 7 * 24 * 60 * 60_000;

/** The signed-in shopper's email, or null. */
export async function currentCustomer(): Promise<string | null> {
  const sealed = (await cookies()).get(NAME)?.value;
  return sealed ? (unseal<{ email: string }>(sealed, env().cookieSecret, "customer", new Date())?.email ?? null) : null;
}

/** Pages that need a shopper send guests to sign in, then back. */
export async function requireCustomer(back: string): Promise<string> {
  const email = await currentCustomer();
  if (!email) redirect(`/signin?next=${encodeURIComponent(back)}`);
  return email;
}

export async function startCustomerSession(email: string) {
  const expires = new Date(Date.now() + DAYS_MS);
  (await cookies()).set(NAME, seal({ email }, env().cookieSecret, "customer", expires), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function endCustomerSession() {
  const jar = await cookies();
  jar.delete(NAME);
  jar.delete("keel_chat");
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time check against the one demo password. */
export const passwordMatches = (given: string) => timingSafeEqual(digest(given), digest(env().demoPassword));
