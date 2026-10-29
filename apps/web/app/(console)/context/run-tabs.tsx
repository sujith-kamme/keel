"use client";

import { type ReactNode, useState } from "react";

/** The run detail's tabs; every panel is rendered by the server, only the visible one is mounted. */
export function RunTabs({ tabs }: { tabs: { id: string; label: string; count: number; panel: ReactNode }[] }) {
  const [tab, setTab] = useState(tabs[0]!.id);
  const shown = tabs.find((t) => t.id === tab) ?? tabs[0]!;
  return (
    <section className="pnl" style={{ minWidth: 0 }}>
      <div className="tabsu" role="tablist" aria-label="Run detail" style={{ padding: "0 16px" }}>
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={t.id === shown.id} aria-controls="run-panel" className={t.id === shown.id ? "on" : undefined} onClick={() => setTab(t.id)}>
            {t.label}
            <span className="n">{t.count}</span>
          </button>
        ))}
      </div>
      <div id="run-panel" role="tabpanel" aria-labelledby={`tab-${shown.id}`}>
        {shown.panel}
      </div>
    </section>
  );
}
