import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { reviewQueue } from "@/lib/operator";
import { buildRows } from "@/lib/review-view";
import { ReviewGrid } from "./review-grid";

async function Queue() {
  await connection();
  const rows = buildRows(await reviewQueue());
  if (rows.length === 0) return <p className="mt-4 text-sm">Nothing waiting for review.</p>;
  return <ReviewGrid rows={rows} />;
}

export default function Page() {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Review queue</h1>
      <Suspense fallback={<p className="mt-4">Loading…</p>}>
        <Queue />
      </Suspense>
      <AutoRefresh ms={3000} />
    </section>
  );
}
