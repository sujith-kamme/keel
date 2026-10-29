"use client";

import { useState } from "react";

const REASONS = [
  { k: "nr", title: "I didn't receive my item", desc: "It never arrived, or arrived empty." },
  { k: "snad", title: "Item is significantly not as described", desc: "Wrong item, damaged, or missing parts." },
  { k: "unauth", title: "I don't recognise this payment", desc: "Someone else may have used your account." },
];

/** Helps the shopper pick the matching PayPal case type; PayPal asks again, so nothing is sent from here. */
export function Reasons() {
  const [pick, setPick] = useState("nr");
  return (
    <fieldset className="box" style={{ margin: 0, padding: 0 }}>
      <legend className="srr">What went wrong?</legend>
      <div className="box-h">
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }} aria-hidden="true">
          What went wrong?
        </h2>
      </div>
      <div className="box-b" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {REASONS.map((r) => (
          <label key={r.k} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 14px", border: `1px solid ${r.k === pick ? "var(--accent)" : "var(--line)"}`, borderRadius: 10, cursor: "pointer" }}>
            <input type="radio" name="why" checked={r.k === pick} onChange={() => setPick(r.k)} style={{ marginTop: 5, accentColor: "var(--accent)" }} />
            <span>
              <span style={{ fontWeight: 500, display: "block" }}>{r.title}</span>
              <span className="small dim">{r.desc}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
