import type { ReasonCode, Verdict } from "@keel/core";

export interface RiskRow {
  tool: string;
  verdict: Verdict;
  reason_codes: ReasonCode[];
  order_id: string | null;
  injection_from_customer: boolean;
  created_at: string;
}
export interface RiskSignal { kind: "INJECTION" | "REPEATED_AFTER_BLOCK" | "FOREIGN_ORDER"; weight: number; at: string }
export interface RiskConfig { threshold: number; half_life_min: number }

export const RISK_WEIGHTS = { INJECTION: 40, REPEATED_AFTER_BLOCK: 15, FOREIGN_ORDER: 30 } as const;

const MONEY_TOOLS = ["offer_refund", "offer_discount"];
const refused = (r: RiskRow) => r.verdict === "BLOCK" || r.verdict === "HOLD";

// Signals come from the session's ledger rows since the last reviewer release.
// `rows` must be in ledger order (oldest first, by seq).
export function signals(rows: RiskRow[], sessionOrderIds: string[]): RiskSignal[] {
  const lastRelease = rows.map((r) => r.tool).lastIndexOf("release");
  const out: RiskSignal[] = [];
  let seenRefusedMoney = false;
  for (const r of rows.slice(lastRelease + 1)) {
    const add = (kind: RiskSignal["kind"]) => out.push({ kind, weight: RISK_WEIGHTS[kind], at: r.created_at });
    if (r.tool === "guard" && r.injection_from_customer) add("INJECTION");
    if (MONEY_TOOLS.includes(r.tool) && refused(r)) {
      if (seenRefusedMoney) add("REPEATED_AFTER_BLOCK");
      seenRefusedMoney = true;
    }
    if (r.reason_codes.includes("CAPABILITY_OUT_OF_SCOPE") && r.order_id !== null && !sessionOrderIds.includes(r.order_id)) add("FOREIGN_ORDER");
  }
  return out;
}

export function score(sigs: RiskSignal[], now: Date, cfg: RiskConfig): number {
  const total = sigs.reduce((sum, s) => {
    const t = Date.parse(s.at);
    // A timestamp that does not parse counts at full weight (fail closed).
    const ageMin = Number.isFinite(t) ? Math.max(0, (now.getTime() - t) / 60_000) : 0;
    return sum + s.weight * 0.5 ** (ageMin / cfg.half_life_min);
  }, 0);
  return Math.round(total);
}

export function shouldQuarantine(score: number, state: string, cfg: RiskConfig): boolean {
  return score >= cfg.threshold && (state === "ACTIVE" || state === "ESCALATED");
}

function positive(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a number > 0`);
  return n;
}

export function riskConfig(env: { RISK_THRESHOLD?: string; RISK_HALF_LIFE_MIN?: string }): RiskConfig {
  return {
    threshold: positive("RISK_THRESHOLD", env.RISK_THRESHOLD, 60),
    half_life_min: positive("RISK_HALF_LIFE_MIN", env.RISK_HALF_LIFE_MIN, 30),
  };
}
