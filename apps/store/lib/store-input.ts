import { z } from "zod";

export const DEMO_CUSTOMERS = [
  { email: "maya@gmail.com", name: "Maya" },
  { email: "sam@gmail.com", name: "Sam" },
] as const;

export const customerName = (email: string) => DEMO_CUSTOMERS.find((c) => c.email === email)?.name ?? email;

// PayPal order ids; also the store's order numbers.
export const ORDER_ID = /^[A-Za-z0-9]{1,64}$/;

export const SignInBody = z.object({ email: z.string().trim().toLowerCase().pipe(z.email().max(254)), password: z.string().min(1).max(200) });
export const SessionBody = z.object({ order_id: z.string().regex(ORDER_ID) });
export const VerifyBody = z.object({ code: z.string().regex(/^\d{6}$/) });
export const ChatBody = z.object({ text: z.string().trim().min(1).max(1000) });

/** Where to go after sign-in: a path on this site only, never another origin. */
export const safeNext = (next: unknown): string =>
  typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/orders";

export const CheckoutBody = z.object({
  items: z.array(z.object({ sku: z.string().min(1).max(64), qty: z.number().int().min(1).max(10), size: z.string().regex(/^[A-Z0-9]{1,4}$/).nullable() })).min(1).max(20),
});
export const CaptureBody = z.object({ order_id: z.string().regex(ORDER_ID) });
