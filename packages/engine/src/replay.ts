import { canonicalJson } from "./canonical";
import { type DecisionInput, type DecisionResult, decide } from "./decide";

export interface DecisionPayload {
  input: DecisionInput;
  result: DecisionResult;
}

/** Re-runs a stored decision and reports whether the engine still agrees (DP-6). */
export function replay(payload: DecisionPayload): { same: boolean; replayed: DecisionResult } {
  const replayed = decide(payload.input);
  return { same: canonicalJson(replayed) === canonicalJson(payload.result), replayed };
}
