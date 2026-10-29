import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { policies, requireConsole } from "@/lib/operator";
import { enforces, policyDiff, policyName, policyType, shortDate } from "@/lib/policies-view";
import { type PolicyListRow, PolicyTable } from "./policy-table";

async function List() {
  await connection();
  await requireConsole();
  const list = await policies();
  if (list.length === 0) return <p className="mut">No policies yet. Run the policy seed.</p>;
  const drafts = list.filter((p) => p.draft !== null);
  const rows: PolicyListRow[] = list.map((p) => ({
    id: p.policy_id,
    name: policyName(p.policy_id),
    type: policyType(p.type),
    enforces: p.active ? enforces(p.active.rules) : "Nothing until a version is approved",
    version: p.active?.version ?? null,
    draft: p.draft?.version ?? null,
    lastChange: shortDate([p.active?.created_at, p.draft?.created_at].filter((d) => d !== undefined).sort().at(-1) ?? ""),
  }));
  return (
    <>
      {drafts.length > 0 && (
        <div className="pnl" style={{ display: "flex", flexDirection: "column", borderColor: "var(--warn-line)", background: "var(--warn-bg)" }}>
          {drafts.map((p, i) => {
            const changes = policyDiff(p.active, p.draft!).filter((d) => d.changed).length;
            return (
              <div key={p.policy_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", flexWrap: "wrap", borderTop: i > 0 ? "1px solid var(--warn-line)" : undefined }}>
                {i === 0 && (
                  <span className="st warn" style={{ color: "var(--warn)", fontWeight: 500 }}>
                    {drafts.length} {drafts.length === 1 ? "draft" : "drafts"} awaiting approval
                  </span>
                )}
                <span className="mut">
                  {policyName(p.policy_id)} v{p.draft!.version} · {changes === 1 ? "1 change" : `${changes} changes`}
                </span>
                <Link href={`/policies/${encodeURIComponent(p.policy_id)}`} className="b xs" style={{ marginLeft: "auto" }}>
                  Review draft
                </Link>
              </div>
            );
          })}
        </div>
      )}
      <PolicyTable rows={rows} />
    </>
  );
}

export default function Page() {
  return (
    <>
      <div className="ph">
        <div>
          <h1>Policies</h1>
        </div>
      </div>
      <Suspense fallback={<p className="mut">Loading…</p>}>
        <List />
      </Suspense>
    </>
  );
}
