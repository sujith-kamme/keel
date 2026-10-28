import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { AddToGauntlet } from "@/components/add-to-gauntlet";
import { ReleaseButton } from "@/components/release-button";
import { KeelError, sessionDetail, type DecisionSummary, type SessionDetail } from "@/lib/keel";
import { canLearn } from "@/lib/context-view";
import { canRelease } from "@/lib/review-view";
import { attachDecisions, riskLevel, riskWidth, signalLabel } from "@/lib/sessions-view";

const VERDICT_STYLE: Record<string, string> = {
  ALLOW: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  BLOCK: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  REWRITE: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  HOLD: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
};

function Chip({ d }: { d: DecisionSummary }) {
  const style = VERDICT_STYLE[d.verdict] ?? "bg-black/10 dark:bg-white/10";
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${style}`}>
      {[d.tool, d.verdict, d.reason_codes.join(", "), d.order_id].filter(Boolean).join(" · ")}
    </span>
  );
}

function GuardChip({ d }: { d: DecisionSummary & { guard: NonNullable<DecisionSummary["guard"]> } }) {
  const { guard } = d;
  const style = VERDICT_STYLE[d.verdict] ?? "bg-black/10 dark:bg-white/10";
  const unavailable = guard.latency_ms === null || d.reason_codes.includes("EXTRACTOR_UNAVAILABLE");
  return (
    <div className="flex flex-col gap-1">
      <span className={`self-start rounded px-2 py-0.5 text-xs ${style}`}>{["guard", d.verdict, d.reason_codes.join(", ")].filter(Boolean).join(" · ")}</span>
      <details open={d.verdict !== "ALLOW"} className="text-xs">
        <summary className="cursor-pointer">Why</summary>
        <p className={d.verdict === "ALLOW" ? "" : "line-through"}>{guard.draft}</p>
        {guard.commitments.length > 0 ? (
          <ul className="list-disc pl-4">
            {guard.commitments.map((c, i) => (
              <li key={i}>
                {c.type}: &ldquo;{c.quoted_text}&rdquo;
              </li>
            ))}
          </ul>
        ) : (
          <p>No commitments found</p>
        )}
        <p className="opacity-70">{unavailable ? "Extractor unavailable" : `Extractor: ${guard.latency_ms} ms`}</p>
      </details>
    </div>
  );
}

const DecisionChip = ({ d }: { d: DecisionSummary }) => (d.guard ? <GuardChip d={{ ...d, guard: d.guard }} /> : <Chip d={d} />);

const RISK_BAR = { low: "bg-green-500", medium: "bg-amber-500", high: "bg-red-500" };

function RiskMeter({ risk }: { risk: SessionDetail["risk"] }) {
  if (!risk) return <p className="mt-4 text-sm opacity-70">Risk unavailable</p>;
  const now = new Date();
  return (
    <div className="mt-4 max-w-md">
      <div className="flex justify-between text-xs">
        <span>Risk</span>
        <span>
          {risk.score} / {risk.threshold}
        </span>
      </div>
      <div className="mt-1 h-2 rounded bg-black/10 dark:bg-white/10">
        <div className={`h-2 rounded ${RISK_BAR[riskLevel(risk.score, risk.threshold)]}`} style={{ width: `${riskWidth(risk.score, risk.threshold)}%` }} />
      </div>
      {risk.signals.length > 0 && (
        <ul className="mt-2 text-xs opacity-80">
          {risk.signals.map((s, i) => (
            <li key={i}>{signalLabel(s, now)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const detail = await sessionDetail(id).catch((e) => {
    if (e instanceof KeelError && e.status === 404) notFound();
    throw e;
  });
  const { session } = detail;
  const { turns, unlinked } = attachDecisions(detail.turns, detail.decisions);
  return (
    <>
      <h1 className="text-2xl font-semibold">{session.claimed_email}</h1>
      <p className="mt-1 text-sm opacity-70">
        {session.verified ? "Verified" : "Not verified"} · {session.state} · agent {session.agent_id}
        {session.state === "QUARANTINED" && (
          <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-xs text-red-800 dark:bg-red-900/40 dark:text-red-200">QUARANTINED</span>
        )}
        {session.mode === "CONTEXT" && (
          <span className="ml-2 rounded bg-black/10 px-2 py-0.5 text-xs dark:bg-white/10">Context run</span>
        )}
        {session.mode === "LIVE" && canRelease(session.state) && (
          <span className="ml-2">
            <ReleaseButton sessionId={session.id} />
          </span>
        )}
        {session.mode === "LIVE" && canLearn(session.state, detail.decisions.map((d) => d.verdict)) && (
          <span className="ml-2">
            <AddToGauntlet sessionId={session.id} />
          </span>
        )}
      </p>
      <RiskMeter risk={detail.risk} />
      <ol className="mt-6 flex max-w-2xl flex-col gap-3">
        {turns.map((t, i) => (
          <li key={i} className={`flex flex-col gap-1 ${t.role === "customer" ? "items-end" : "items-start"}`}>
            <div className="rounded-lg bg-black/5 px-3 py-2 text-sm dark:bg-white/10">{t.text}</div>
            {t.decisions.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {t.decisions.map((d) => (
                  <DecisionChip key={d.decision_id} d={d} />
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
      {unlinked.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-medium">Other decisions</h2>
          <div className="mt-2 flex flex-wrap gap-1">
            {unlinked.map((d) => (
              <DecisionChip key={d.decision_id} d={d} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export default function Page({ params }: PageProps<"/sessions/[id]">) {
  return (
    <section>
      <Link href="/sessions" className="text-sm underline">
        ← Back to sessions
      </Link>
      <Suspense fallback={<p className="mt-4">Loading…</p>}>
        <Detail params={params} />
      </Suspense>
      <AutoRefresh ms={3000} />
    </section>
  );
}
