import { z } from "zod";

export const DEMO_CUSTOMERS = [
  { email: "maya@gmail.com", name: "Maya" },
  { email: "sam@gmail.com", name: "Sam" },
] as const;

export const SessionBody = z.object({ email: z.enum(DEMO_CUSTOMERS.map((c) => c.email) as [string, ...string[]]) });
export const VerifyBody = z.object({ code: z.string().regex(/^\d{6}$/) });
export const ChatBody = z.object({ text: z.string().trim().min(1).max(1000) });
