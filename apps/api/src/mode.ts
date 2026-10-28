import type { Mode } from "@keel/core";

export type SessionMode = "LIVE" | "CONTEXT";
export type GuardMode = "ENFORCE" | "SHADOW";

/** Ledger mode for a row written for a session: CONTEXT sessions stay CONTEXT, LIVE ones show quarantine. */
export function ledgerMode(sessionMode: string, state: string): Mode {
  if (sessionMode === "CONTEXT") return "CONTEXT";
  return state === "QUARANTINED" ? "QUARANTINE" : "LIVE";
}
