"use server";

import { OperatorError, gridQuery, requireConsole } from "@/lib/operator";

export type AskResult = { ok: true; state: Record<string, unknown> } | { ok: false; message: string };

export async function askGrid(query: unknown, schema: unknown): Promise<AskResult> {
  await requireConsole();
  if (typeof query !== "string" || !query.trim() || query.length > 500 || !schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { ok: false, message: "Invalid request." };
  }
  try {
    return { ok: true, state: await gridQuery(query.trim(), schema as Record<string, unknown>) };
  } catch (e) {
    if (!(e instanceof OperatorError)) throw e;
    if (e.status === 422) return { ok: false, message: "Couldn't turn that into a view. Try naming a column or value." };
    if (e.status === 504 || e.status === 502) return { ok: false, message: "The assistant is unavailable right now." };
    return { ok: false, message: `Request failed (${e.status}).` };
  }
}
