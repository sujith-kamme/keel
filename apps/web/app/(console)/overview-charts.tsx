"use client";

import { AllCommunityModule, type AgChartOptions, ModuleRegistry } from "ag-charts-community";
import { AgCharts } from "ag-charts-react";
import { useMemo } from "react";
import { useAgTheme } from "@/lib/ag-theme";
import { dayLabel, type DayCounts, VERDICT_SERIES } from "@/lib/overview-view";

ModuleRegistry.registerModules([AllCommunityModule]);

/** The token's value for the theme showing now; the canvas can't read CSS variables itself. */
function token(name: string, fallback: string) {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function DecisionsChart({ days }: { days: DayCounts[] }) {
  const { chart } = useAgTheme();
  const options = useMemo<AgChartOptions>(
    () => ({
      theme: chart,
      background: { visible: false },
      padding: { top: 8, right: 8, bottom: 0, left: 0 },
      legend: { enabled: false },
      data: days.map((d) => ({ ...d, label: dayLabel(d.day) })),
      series: VERDICT_SERIES.map((v) => ({ type: "bar", xKey: "label", yKey: v.key, yName: v.name, stacked: true, fill: token(v.color, "#888888") })),
    }),
    // The theme name changes with the theme class, so the tokens are re-read then.
    [chart, days],
  );
  return <AgCharts options={options} style={{ height: 220 }} />;
}
