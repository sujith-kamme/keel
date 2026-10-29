"use client";

import { AllCommunityModule, type AgChartOptions, ModuleRegistry } from "ag-charts-community";
import { AgCharts } from "ag-charts-react";
import { useAgTheme } from "@/lib/ag-theme";
import type { DayCounts, DisputeOutcomes } from "@/lib/overview-view";

ModuleRegistry.registerModules([AllCommunityModule]);

// Same hues as the verdict and outcome badges elsewhere in the console.
const VERDICTS = [
  { key: "ALLOW", fill: "#16a34a" },
  { key: "REWRITE", fill: "#2563eb" },
  { key: "HOLD", fill: "#d97706" },
  { key: "BLOCK", fill: "#dc2626" },
] as const;

export function OverviewCharts({ days, disputes }: { days: DayCounts[]; disputes: DisputeOutcomes }) {
  const { chart } = useAgTheme();
  const base = { theme: chart, background: { visible: false } } as const;

  const decisions: AgChartOptions = {
    ...base,
    title: { text: "Decisions per day (UTC)" },
    data: days,
    series: VERDICTS.map((v) => ({ type: "bar", xKey: "day", yKey: v.key, yName: v.key, stacked: true, fill: v.fill })),
  };

  const outcomes = [
    { outcome: "Won", count: disputes.WON },
    { outcome: "Conceded", count: disputes.CONCEDED },
    { outcome: "Lost", count: disputes.LOST },
    { outcome: "Open", count: disputes.OPEN },
  ];
  const disputeChart: AgChartOptions = {
    ...base,
    title: { text: "Dispute outcomes" },
    data: outcomes,
    series: [{ type: "donut", angleKey: "count", legendItemKey: "outcome", fills: ["#16a34a", "#6b7280", "#dc2626", "#d97706"] }],
  };

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-3">
      <div className="h-80 rounded border border-black/10 p-2 lg:col-span-2 dark:border-white/10">
        <AgCharts options={decisions} style={{ height: "100%" }} />
      </div>
      <div className="h-80 rounded border border-black/10 p-2 dark:border-white/10">
        {outcomes.some((o) => o.count > 0) ? (
          <AgCharts options={disputeChart} style={{ height: "100%" }} />
        ) : (
          <p className="p-4 text-sm opacity-70">No disputes yet.</p>
        )}
      </div>
    </div>
  );
}
