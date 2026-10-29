import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { buildDisputeRows, disputeKpis, syncedText } from "@/lib/disputes-view";
import { disputes, requireConsole } from "@/lib/operator";
import { DisputeTools, DisputesGrid } from "./disputes-grid";

const LIST_LIMIT = 50;
const n = (x: number) => x.toLocaleString("en-US");

function Header({ synced }: { synced?: string }) {
  return (
    <div className="ph">
      <div>
        <h1>Disputes</h1>
      </div>
      <div className="acts">
        {synced && <span className="sm dim">{synced}</span>}
        <DisputeTools />
      </div>
    </div>
  );
}

async function Disputes() {
  await connection();
  await requireConsole();
  const list = await disputes();
  const rows = buildDisputeRows(list.items);
  const k = disputeKpis(list.items);
  const capped = list.items.length >= LIST_LIMIT;
  return (
    <>
      <Header synced={syncedText(list.last_synced_at, new Date())} />
      <div className="kpis grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <div className="kpi">
          <span className="lbl">Won</span>
          <span className="v">{n(k.won.count)}</span>
          <span className="sm dim">{k.won.total} kept</span>
        </div>
        <div className="kpi">
          <span className="lbl">Conceded</span>
          <span className="v">{n(k.conceded.count)}</span>
          <span className="sm dim">{k.conceded.total} conceded</span>
        </div>
        <div className="kpi">
          <span className="lbl">Lost</span>
          <span className="v">{n(k.lost.count)}</span>
          <span className="sm dim">{k.lost.total} lost</span>
        </div>
        <div className="kpi">
          <span className="lbl">Needs you</span>
          <span className="v">{n(k.needsYou.count)}</span>
          <span className="sm dim">{k.needsYou.count === 0 ? "nothing waiting on you" : `${k.needsYou.total} waiting on a decision`}</span>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="mut">No disputes yet. New PayPal disputes show up here within a few minutes.</p>
      ) : (
        <DisputesGrid rows={rows} note={capped ? `Counts cover the ${LIST_LIMIT} newest disputes` : "Newest first"} />
      )}
    </>
  );
}

export default function Page() {
  return (
    <>
      <Suspense
        fallback={
          <>
            <Header />
            <p className="mut">Loading…</p>
          </>
        }
      >
        <Disputes />
      </Suspense>
      <AutoRefresh ms={3000} />
    </>
  );
}
