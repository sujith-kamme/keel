import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { OperatorError, policyVersions, requireConsole } from "@/lib/operator";
import { isPolicyId, ruleSummary } from "@/lib/policies-view";
import { DraftForm } from "./draft-form";
import { RuleEditor } from "./rule-editor";

const when = (iso: string) => iso.replace("T", " ").slice(0, 16);

async function Detail({ params, searchParams }: Pick<PageProps<"/policies/[id]">, "params" | "searchParams">) {
  await connection();
  await requireConsole();
  const { id } = await params;
  if (!isPolicyId(id)) notFound();
  const versions = await policyVersions(id).catch((e: unknown) => {
    if (e instanceof OperatorError && e.status === 404) notFound();
    throw e;
  });
  // Newest first: the first APPROVED is what the engine enforces; a DRAFT above it is pending.
  const active = versions.find((v) => v.status === "APPROVED") ?? null;
  const draft = versions[0]?.status === "DRAFT" ? versions[0] : null;
  const { approved } = await searchParams;
  const justApproved = active !== null && approved === String(active.version);

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{id}</h1>
        <span className="rounded bg-black/10 px-2 py-0.5 text-xs dark:bg-white/10">{(active ?? versions[0])?.type}</span>
      </div>

      {justApproved && (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-900/30">
          Version {active.version} approved and enforced. Certification is now stale:{" "}
          <Link href="/context" className="underline">
            re-run the Gauntlet
          </Link>
          .
        </div>
      )}

      {draft ? (
        <RuleEditor key={draft.version} policyId={id} active={active} draft={draft} />
      ) : (
        active && (
          <div className="mt-6 rounded border border-black/10 p-4 dark:border-white/10">
            <h2 className="font-semibold">Active · v{active.version}</h2>
            <p className="mt-2 text-sm whitespace-pre-wrap">{active.approved_text}</p>
            {active.rules.length > 0 && (
              <ul className="mt-3 list-disc pl-5 text-sm">
                {active.rules.map((r, i) => (
                  <li key={i}>{ruleSummary(r)}</li>
                ))}
              </ul>
            )}
          </div>
        )
      )}

      <div className="mt-6">
        <h2 className="font-semibold">Draft a new version</h2>
        {active ? <DraftForm policyId={id} /> : <p className="mt-2 text-sm opacity-70">Only policies with an approved version can be redrafted.</p>}
      </div>

      <div className="mt-6">
        <h2 className="font-semibold">Version history</h2>
        <table className="mt-2 w-full text-left text-sm">
          <thead className="text-xs opacity-70">
            <tr>
              <th className="py-1 pr-4 font-medium">Version</th>
              <th className="py-1 pr-4 font-medium">Status</th>
              <th className="py-1 pr-4 font-medium">Approved by</th>
              <th className="py-1 pr-4 font-medium">Approved</th>
              <th className="py-1 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.version} className="border-t border-black/10 dark:border-white/10">
                <td className="py-1 pr-4">v{v.version}</td>
                <td className="py-1 pr-4">{v === active ? "ACTIVE" : v.status}</td>
                <td className="py-1 pr-4">{v.approved_by ?? (v.status === "APPROVED" ? "seeded" : "")}</td>
                <td className="py-1 pr-4">{v.approved_at ? when(v.approved_at) : ""}</td>
                <td className="py-1">{when(v.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function Page({ params, searchParams }: PageProps<"/policies/[id]">) {
  return (
    <section>
      <Link href="/policies" className="text-sm underline">
        ← Policies
      </Link>
      <Suspense fallback={<p className="mt-4">Loading…</p>}>
        <Detail params={params} searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
