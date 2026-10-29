import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { reviewQueue, requireConsole } from "@/lib/operator";
import { buildRows } from "@/lib/review-view";
import { ReviewGrid } from "./review-grid";

async function Queue() {
  await connection();
  await requireConsole();
  const rows = buildRows(await reviewQueue());
  if (rows.length === 0) return <p className="mut">Nothing waiting for review.</p>;
  return <ReviewGrid rows={rows} />;
}

export default function Page() {
  return (
    <>
      <div className="ph">
        <div>
          <h1>Review queue</h1>
          <p>Actions Keel held for a person and sessions it quarantined or escalated. Every decision is written to the ledger.</p>
        </div>
      </div>
      <Suspense fallback={<p className="mut">Loading…</p>}>
        <Queue />
      </Suspense>
      <AutoRefresh ms={3000} />
    </>
  );
}
