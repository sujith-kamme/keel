"use client";

import { useRouter } from "next/navigation";

/** Switches the selected run: /context?run=<id>. */
export function RunPicker({ runs, selectedId }: { runs: { id: string; label: string }[]; selectedId: string | undefined }) {
  const router = useRouter();
  return (
    <select className="sel mono" aria-label="Run" value={selectedId ?? ""} onChange={(e) => router.push(`/context?run=${encodeURIComponent(e.target.value)}`)} style={{ maxWidth: "100%" }}>
      {runs.map((r) => (
        <option key={r.id} value={r.id}>
          {r.label}
        </option>
      ))}
    </select>
  );
}
