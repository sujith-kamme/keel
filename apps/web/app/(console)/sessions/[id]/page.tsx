import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { KeelError, sessionDetail, type DecisionSummary } from "@/lib/keel";
import { attachDecisions } from "@/lib/sessions-view";

const VERDICT_STYLE: Record<string, string> = {
  ALLOW: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  BLOCK: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
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
      </p>
      <ol className="mt-6 flex max-w-2xl flex-col gap-3">
        {turns.map((t, i) => (
          <li key={i} className={`flex flex-col gap-1 ${t.role === "customer" ? "items-end" : "items-start"}`}>
            <div className="rounded-lg bg-black/5 px-3 py-2 text-sm dark:bg-white/10">{t.text}</div>
            {t.decisions.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {t.decisions.map((d) => (
                  <Chip key={d.decision_id} d={d} />
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
              <Chip key={d.decision_id} d={d} />
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
