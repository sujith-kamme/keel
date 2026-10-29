import type { Context, Hono } from "hono";
import { type LedgerPageRow, ledgerView } from "./ledger";
import { operatorAuth } from "./operator-auth";

type Violations = { total: number; byReason: { code: string; count: number }[] };
type Dollars = { blocked_refunds: string; denied_holds: string; disputes_won: string; total: string };

export interface OverviewOptions {
  operatorKey: string;
  merchantKey: string;
  /** Same result as GET /v1/gauntlet/certification. */
  certification: () => Promise<{ run_id: string | null }>;
  /** The certifying run's scorecard and finish time; null when the run is gone. */
  run: (runId: string) => Promise<{ scorecard: { leaks: number; runs: number } | null; finished_at: string | null } | null>;
  sessions: () => Promise<{ active: number; quarantined: number }>;
  violations: (since?: Date) => Promise<Violations>;
  dollarsProtected: (since?: Date) => Promise<Dollars>;
  decisionsByDay: () => Promise<{ day: string; ALLOW: number; REWRITE: number; BLOCK: number; HOLD: number }[]>;
  /** The newest live (non-CONTEXT) ledger rows, newest first. */
  recent: () => Promise<LedgerPageRow[]>;
  disputes: () => Promise<{ OPEN: number; WON: number; LOST: number; CONCEDED: number; amount_won: string; amount_conceded: string }>;
  now: () => Date;
}

const WEEK_MS = 7 * 86_400_000;

/** The console's Overview page in one call (Phase 7). */
export function mountOverview(app: Hono, opts: OverviewOptions): void {
  const auth = operatorAuth(opts.operatorKey, opts.merchantKey);
  const denied = (c: Context) => {
    const a = auth(c);
    return a === "ok" ? null : c.json({ error: a === 401 ? "unauthorized" : "forbidden" }, a);
  };

  app.get("/v1/overview", async (c) => {
    const no = denied(c);
    if (no) return no;
    const weekAgo = new Date(opts.now().getTime() - WEEK_MS);
    // Certification reads the latest run and live versions; if that fails the impact numbers still show.
    const certification = opts
      .certification()
      .then(async (cert) => {
        const run = cert.run_id ? await opts.run(cert.run_id) : null;
        if (!run?.scorecard) return cert;
        // scenarios counts conversations: each scenario once per repeat.
        return { ...cert, leaks: run.scorecard.leaks, scenarios: run.scorecard.runs, finished_at: run.finished_at };
      })
      .catch(() => {
        console.error("overview: certification failed");
        return null;
      });
    const [cert, sessions, vAll, vWeek, dAll, dWeek, days, disputes, recent] = await Promise.all([
      certification,
      opts.sessions(),
      opts.violations(),
      opts.violations(weekAgo),
      opts.dollarsProtected(),
      opts.dollarsProtected(weekAgo),
      opts.decisionsByDay(),
      opts.disputes(),
      opts.recent(),
    ]);
    return c.json({
      certification: cert,
      sessions,
      violations: { all_time: vAll, last_7_days: vWeek },
      dollars_protected: { all_time: dAll, last_7_days: dWeek },
      decisions_by_day: days,
      disputes,
      recent_activity: recent.map(ledgerView),
    });
  });
}
