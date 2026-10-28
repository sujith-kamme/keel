import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { CLASS_STYLE, OUTCOME_STYLE, actionLabel, codeLabel, isDisputeId, operatorActions, reasonLabel, type DisputeLedgerView } from "@/lib/disputes-view";
import { OperatorError, dispute } from "@/lib/operator";
import { DecisionButtons, SandboxButtons } from "./buttons";

const VERDICT_STYLE: Record<string, string> = {
  ALLOW: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  BLOCK: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  REWRITE: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  HOLD: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
};

const Chip = ({ value, styles }: { value: string; styles: Record<string, string> }) => (
  <span className={`rounded px-2 py-0.5 text-xs ${styles[value] ?? "bg-black/10 dark:bg-white/10"}`}>{value}</span>
);

function LedgerList({ rows }: { rows: DisputeLedgerView[] }) {
  if (rows.length === 0) return <p className="text-sm opacity-70">None.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => {
        const amount = typeof r.args?.amount === "string" ? ` ${r.args.amount}` : "";
        return (
          <li key={r.decision_id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-36 shrink-0 text-xs opacity-70">{r.created_at.replace("T", " ").slice(0, 16)}</span>
            <Chip value={r.verdict} styles={VERDICT_STYLE} />
            <span>
              {r.action ?? r.tool}
              {amount}
            </span>
            <span className="opacity-80">{r.reason_codes.map(codeLabel).join(", ")}</span>
            {r.reviewer && <span className="text-xs opacity-70">by {r.reviewer}</span>}
            {r.session_id && (
              <Link href={`/sessions/${encodeURIComponent(r.session_id)}`} className="text-xs underline">
                conversation
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!isDisputeId(id)) notFound();
  const d = await dispute(id).catch((e: unknown) => {
    if (e instanceof OperatorError && e.status === 404) notFound();
    throw e;
  });
  const actions = operatorActions(d);
  return (
    <>
      <h1 className="mt-2 text-2xl font-semibold">{d.id}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span>{reasonLabel(d.reason)}</span>
        <span>·</span>
        <span>
          {d.amount} {d.currency}
        </span>
        <span>·</span>
        <span className="opacity-80">
          PayPal: {d.status}
          {d.stage ? ` (${d.stage})` : ""}
        </span>
        <Chip value={d.outcome} styles={OUTCOME_STYLE} />
      </div>

      <div className="mt-6 rounded border border-black/10 p-4 dark:border-white/15">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Keel&apos;s decision</h2>
          {d.classification ? <Chip value={d.classification} styles={CLASS_STYLE} /> : <span className="text-sm opacity-70">Classifying…</span>}
          <span className="text-sm opacity-80">{actionLabel(d.action)}</span>
        </div>
        {d.reason_codes.map((c) => (
          <p key={c} className="mt-2 text-sm">
            {codeLabel(c)}
          </p>
        ))}
        {d.action_error && <p className="mt-2 text-sm text-red-700 dark:text-red-300">PayPal said: {d.action_error}</p>}
        {d.injection === "flagged" && <p className="mt-2 text-sm text-red-700 dark:text-red-300">The buyer&apos;s text was flagged as a prompt injection. It was treated as data only.</p>}
        {actions.length > 0 && <DecisionButtons id={d.id} actions={actions} />}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="font-semibold">What the ledger shows</h2>
          <p className="mb-2 text-xs opacity-70">
            Order {d.order_id ?? "not matched"} · capture {d.capture_id ?? "n/a"}
          </p>
          <LedgerList rows={d.evidence} />
        </div>
        <div>
          <h2 className="font-semibold">Evidence pack</h2>
          {d.has_evidence ? (
            <>
              <p className="mt-2 text-sm">{d.evidence_notes}</p>
              <p className="mt-2 text-xs opacity-70">
                Type {d.evidence_type} · SHA-256 {d.evidence_sha256?.slice(0, 16)}…
              </p>
              <a href={`/disputes/${encodeURIComponent(d.id)}/evidence`} target="_blank" rel="noopener" className="mt-2 inline-block text-sm underline">
                Open PDF
              </a>
            </>
          ) : (
            <p className="mt-2 text-sm opacity-70">No evidence pack (no matching order).</p>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="font-semibold">Buyer&apos;s message</h2>
          {d.buyer_messages.length === 0 ? (
            <p className="mt-2 text-sm opacity-70">None.</p>
          ) : (
            d.buyer_messages.map((m, i) => (
              <blockquote key={i} className="mt-2 border-l-2 border-black/20 pl-3 text-sm whitespace-pre-wrap dark:border-white/20">
                {m}
              </blockquote>
            ))
          )}
        </div>
        <div>
          <h2 className="font-semibold">Keel&apos;s actions</h2>
          <div className="mt-2">
            <LedgerList rows={d.decisions} />
          </div>
        </div>
      </div>

      {d.sandbox && d.outcome === "OPEN" && (
        <div className="mt-6 rounded border border-dashed border-black/20 p-4 dark:border-white/20">
          <h2 className="font-semibold">Sandbox</h2>
          <p className="mt-1 text-xs opacity-70">
            Escalating moves the case to a claim; PayPal then offers a ruling after its review (about 30 minutes in the sandbox).
          </p>
          <SandboxButtons id={d.id} canEscalate={d.offered.includes("escalate")} canRule={d.offered.includes("adjudicate")} />
        </div>
      )}
    </>
  );
}

export default function Page({ params }: PageProps<"/disputes/[id]">) {
  return (
    <section>
      <Link href="/disputes" className="text-sm underline">
        ← Disputes
      </Link>
      <Suspense fallback={<p className="mt-4">Loading…</p>}>
        <Detail params={params} />
      </Suspense>
      <AutoRefresh ms={3000} />
    </section>
  );
}
