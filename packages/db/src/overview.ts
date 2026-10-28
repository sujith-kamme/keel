import { fromCents, toCents } from "@keel/engine";
import { type SQL, sql } from "drizzle-orm";
import type { DbOrTx } from "./ledger";

// Overview numbers for the console (Phase 7). Simulated CONTEXT (Gauntlet) rows are
// left out: these figures describe live traffic only.

const from = (since?: Date) => (since ?? new Date(0)).toISOString();

// Operator and dispute bookkeeping rows carry verdicts too, but they aren't an agent
// being stopped: a review re-records the hold it resolves, a dispute row is PayPal's side.
const NOT_VIOLATIONS = sql`('dispute', 'dispute_action', 'review', 'kill_switch')`;

const caught = (since?: Date) => sql`
  select reason_codes from ledger_entries
  where verdict in ('BLOCK', 'HOLD', 'REWRITE') and mode <> 'CONTEXT'
    and coalesce(payload->>'tool', '') not in ${NOT_VIOLATIONS}
    and created_at >= ${from(since)}::timestamptz`;

/** Ledger rows Keel stopped or changed (BLOCK, HOLD, REWRITE), by reason code, most frequent first. */
export async function violations(db: DbOrTx, since?: Date) {
  const [total, byReason] = await Promise.all([
    db.execute<{ total: number }>(sql`select count(*)::int as total from (${caught(since)}) v`),
    db.execute<{ code: string; count: number }>(sql`
      select code, count(*)::int as count from (${caught(since)}) v, jsonb_array_elements_text(v.reason_codes) as code
      group by code order by count desc, code`),
  ]);
  return { total: total.rows[0]?.total ?? 0, byReason: byReason.rows };
}

// Exact decimal sum in Postgres numeric; strings that aren't money are skipped, never cast.
const money = (expr: SQL) => sql`case when ${expr} ~ '^\\d{1,13}(\\.\\d{1,2})?$' then (${expr})::numeric end`;
const total = (expr: SQL) => sql`round(coalesce(sum(${expr}), 0), 2)::text`;

/**
 * Refunds the engine blocked, held refunds a reviewer denied, and disputes Keel won.
 * Amounts are decimal strings ("155.00"); the total is added in integer cents.
 */
export async function dollarsProtected(db: DbOrTx, since?: Date) {
  const amount = money(sql`r.payload->'args'->>'amount'`);
  const { rows } = await db.execute<{ blocked_refunds: string; denied_holds: string; disputes_won: string }>(sql`
    select
      (select ${total(sql`${amount}`)} from ledger_entries r
        where r.payload->>'tool' = 'offer_refund' and r.verdict = 'BLOCK' and r.mode <> 'CONTEXT'
          and r.created_at >= ${from(since)}::timestamptz) as blocked_refunds,
      (select ${total(sql`${amount}`)} from ledger_entries r
        where r.payload->>'tool' = 'offer_refund' and r.verdict = 'HOLD' and r.mode <> 'CONTEXT'
          and r.created_at >= ${from(since)}::timestamptz
          and exists (select 1 from ledger_entries d
            where d.payload->>'tool' = 'review' and d.payload->>'action' = 'deny'
              and d.payload->>'resolved' = 'true' and d.payload->>'ref' = r.decision_id)) as denied_holds,
      (select ${total(money(sql`amount`))} from disputes
        where outcome = 'WON' and updated_at >= ${from(since)}::timestamptz) as disputes_won`);
  const parts = rows[0]!;
  return { ...parts, total: fromCents(toCents(parts.blocked_refunds) + toCents(parts.denied_holds) + toCents(parts.disputes_won)) };
}

export type DayCounts = { day: string; ALLOW: number; REWRITE: number; BLOCK: number; HOLD: number };

/** Ledger rows per verdict for each of the last `days` UTC days (oldest first, today last). */
export async function decisionsByDay(db: DbOrTx, days = 14): Promise<DayCounts[]> {
  const n = Math.min(90, Math.max(1, Math.trunc(days)));
  const { rows } = await db.execute<DayCounts>(sql`
    with d as (
      select generate_series((now() at time zone 'utc')::date - (${n}::int - 1), (now() at time zone 'utc')::date, interval '1 day')::date as day
    )
    select to_char(d.day, 'YYYY-MM-DD') as day,
      count(l.seq) filter (where l.verdict = 'ALLOW')::int as "ALLOW",
      count(l.seq) filter (where l.verdict = 'REWRITE')::int as "REWRITE",
      count(l.seq) filter (where l.verdict = 'BLOCK')::int as "BLOCK",
      count(l.seq) filter (where l.verdict = 'HOLD')::int as "HOLD"
    from d left join ledger_entries l
      on (l.created_at at time zone 'utc')::date = d.day and l.mode <> 'CONTEXT'
    group by d.day order by d.day`);
  return rows;
}

/** Disputes per outcome, with the amounts won and conceded. */
export async function disputeOutcomes(db: DbOrTx) {
  const { rows } = await db.execute<{ OPEN: number; WON: number; LOST: number; CONCEDED: number; amount_won: string; amount_conceded: string }>(sql`
    select
      count(*) filter (where outcome = 'OPEN')::int as "OPEN",
      count(*) filter (where outcome = 'WON')::int as "WON",
      count(*) filter (where outcome = 'LOST')::int as "LOST",
      count(*) filter (where outcome = 'CONCEDED')::int as "CONCEDED",
      ${total(sql`case when outcome = 'WON' then ${money(sql`amount`)} end`)} as amount_won,
      ${total(sql`case when outcome = 'CONCEDED' then ${money(sql`amount`)} end`)} as amount_conceded
    from disputes`);
  return rows[0]!;
}

/** Unexpired LIVE sessions: active (including escalated) and quarantined. */
export async function liveSessions(db: DbOrTx) {
  const { rows } = await db.execute<{ active: number; quarantined: number }>(sql`
    select
      count(*) filter (where state <> 'QUARANTINED')::int as active,
      count(*) filter (where state = 'QUARANTINED')::int as quarantined
    from sessions where mode = 'LIVE' and expires_at > now()`);
  return rows[0]!;
}
