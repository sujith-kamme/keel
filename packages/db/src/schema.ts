import { bigserial, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Append-only ledger (docs/FSD.md §6). Rows are never updated or deleted;
// `hash` chains each entry to the previous one for tamper evidence.
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    decisionId: text("decision_id").notNull(),
    sessionId: text("session_id"),
    orderId: text("order_id"),
    captureId: text("capture_id"),
    disputeId: text("dispute_id"),
    mode: text("mode").notNull(),
    verdict: text("verdict").notNull(),
    reasonCodes: jsonb("reason_codes").$type<string[]>().notNull(),
    payload: jsonb("payload").notNull(),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ledger_decision_idx").on(t.decisionId),
    index("ledger_session_idx").on(t.sessionId),
    index("ledger_order_idx").on(t.orderId),
    index("ledger_capture_idx").on(t.captureId),
    index("ledger_dispute_idx").on(t.disputeId),
  ],
);

// Versioned policies (docs/FSD.md §5.5). A new version is a new row.
export const policies = pgTable(
  "policies",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    policyId: text("policy_id").notNull(),
    version: integer("version").notNull(),
    type: text("type").notNull(),
    approvedText: text("approved_text").notNull(),
    rules: jsonb("rules").notNull(),
    status: text("status").notNull().default("DRAFT"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("policy_version_idx").on(t.policyId, t.version)],
);
