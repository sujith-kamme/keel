"use client";

import { themeQuartz } from "ag-grid-community";
import { useTheme } from "./use-theme";

// Params are the v3 CSS variables, so the grid follows the theme class with no re-render.
const grid = themeQuartz.withParams({
  backgroundColor: "var(--raised)",
  foregroundColor: "var(--text)",
  borderColor: "var(--line)",
  headerBackgroundColor: "var(--canvas)",
  accentColor: "var(--accent)",
  rowHoverColor: "var(--hover)",
  selectedRowBackgroundColor: "var(--sel)",
  fontFamily: "inherit",
  browserColorScheme: "inherit",
});

/** The shared AG Grid theme and the AG Charts theme name for the current resolved theme. */
export function useAgTheme() {
  const { resolved } = useTheme();
  return { grid, chart: resolved === "dark" ? "ag-default-dark" : "ag-default" } as const;
}
