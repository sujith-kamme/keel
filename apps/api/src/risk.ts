import { type DbOrTx, and, appendLedger, agentControls, asc, eq, inArray, ledgerEntries, sessions } from "@keel/db";
import { type RiskConfig, type RiskRow, type RiskSignal, score, shouldQuarantine, signals } from "@keel/risk";
import type { NotifyEvent } from "@keel/worker/queue";
import { type GuardMode, type SessionMode, ledgerMode } from "./mode";

export interface RiskService {
  /** Session state, whether its agent is frozen (own row or "*"), and the current score. Throws on DB error or unknown session (callers fail closed). */
  control(sessionId: string): Promise<{ state: string; agent_frozen: boolean; score: number; mode: SessionMode; guard_mode: GuardMode }>;
  /** Recompute; on crossing the threshold set QUARANTINED, append a `risk` ledger row, enqueue session.quarantined. */
  assess(sessionId: string): Promise<{ score: number; quarantined: boolean }>;
  detail(sessionId: string): Promise<{ score: number; threshold: number; signals: RiskSignal[] }>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function customerInjection(payload: Record<string, unknown>): boolean {
  if (payload.tool !== "guard" || !isRecord(payload.input) || !isRecord(payload.input.extraction)) return false;
  const found = payload.input.extraction.injection_signals;
  return Array.isArray(found) && found.some((s) => isRecord(s) && s.source === "customer");
}

export function createRisk(
  db: DbOrTx,
  opts: {
    /** Read per scoring call, so a changed threshold or half-life applies without a restart. */
    cfg: () => Promise<RiskConfig>;
    enqueue: (e: NotifyEvent) => Promise<void>;
    consoleUrl: string;
    now: () => Date;
    newId: (prefix: string) => string;
    appendLedger?: typeof appendLedger;
  },
): RiskService {
  const append = opts.appendLedger ?? appendLedger;

  async function load(sessionId: string) {
    const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    if (!session) throw new Error(`unknown session ${sessionId}`);
    const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.sessionId, sessionId)).orderBy(asc(ledgerEntries.seq));
    const rows: RiskRow[] = entries.map((e) => {
      const payload = isRecord(e.payload) ? e.payload : {};
      return {
        tool: typeof payload.tool === "string" ? payload.tool : "",
        verdict: e.verdict as RiskRow["verdict"],
        reason_codes: e.reasonCodes as RiskRow["reason_codes"],
        order_id: e.orderId,
        injection_from_customer: customerInjection(payload),
        created_at: e.createdAt.toISOString(),
      };
    });
    const sigs = signals(rows, session.orderIds);
    const cfg = await opts.cfg();
    return { session, sigs, cfg, score: score(sigs, opts.now(), cfg) };
  }

  return {
    control: async (sessionId) => {
      const { session, score: s } = await load(sessionId);
      const controls = await db
        .select()
        .from(agentControls)
        .where(inArray(agentControls.agentId, [session.agentId, "*"]));
      return {
        state: session.state,
        agent_frozen: controls.some((c) => c.frozen),
        score: s,
        mode: session.mode as SessionMode,
        guard_mode: session.guardMode as GuardMode,
      };
    },

    assess: async (sessionId) => {
      const { session, sigs, cfg, score: s } = await load(sessionId);
      let state = session.state;
      if (shouldQuarantine(s, state, cfg)) {
        const decisionId = opts.newId("dec");
        const quarantined = await db.transaction(async (tx) => {
          const updated = await tx
            .update(sessions)
            .set({ state: "QUARANTINED" })
            .where(and(eq(sessions.id, sessionId), inArray(sessions.state, ["ACTIVE", "ESCALATED"])))
            .returning({ id: sessions.id });
          if (updated.length !== 1) return false;
          await append(tx, {
            decision_id: decisionId,
            session_id: sessionId,
            order_id: null,
            capture_id: null,
            dispute_id: null,
            mode: ledgerMode(session.mode, "QUARANTINED"),
            verdict: "HOLD",
            reason_codes: ["RISK_THRESHOLD"],
            payload: { tool: "risk", score: s, threshold: cfg.threshold, signals: sigs },
          });
          return true;
        });
        const [current] = await db.select({ state: sessions.state }).from(sessions).where(eq(sessions.id, sessionId));
        state = current?.state ?? state;
        // Simulated sessions never page anyone.
        if (quarantined && session.mode !== "CONTEXT") {
          try {
            await opts.enqueue({
              event: "session.quarantined",
              session_id: sessionId,
              decision_id: decisionId,
              reason_codes: ["RISK_THRESHOLD"],
              score: s,
              console_url: `${opts.consoleUrl}/sessions/${encodeURIComponent(sessionId)}`,
              at: opts.now().toISOString(),
            });
          } catch {
            console.error(`notify enqueue failed: session.quarantined ${sessionId}`);
          }
        }
      }
      return { score: s, quarantined: state === "QUARANTINED" };
    },

    detail: async (sessionId) => {
      const { sigs, cfg, score: s } = await load(sessionId);
      return { score: s, threshold: cfg.threshold, signals: sigs };
    },
  };
}
