"use client";

import { useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, useState, useTransition } from "react";
import { DOCUMENT_MAX_BYTES, documentProblem } from "@/lib/policies-view";
import { draft } from "../actions";

export function DraftForm({ policyId }: { policyId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/\.(txt|md)$/i.test(file.name)) return setError("Upload a .txt or .md file.");
    if (file.size > DOCUMENT_MAX_BYTES) return setError("The document is over 50 KB.");
    setError(null);
    setText(await file.text());
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = documentProblem(text);
    if (problem) return setError(problem);
    setError(null);
    start(async () => {
      const r = await draft(policyId, text);
      if (!r.ok) return setError(r.message);
      setText("");
      // Close the form: the new draft shows in its own panel.
      router.replace(`/policies/${encodeURIComponent(policyId)}`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="pnl-b stk" style={{ gap: 10 }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder="Paste the policy text here, or upload a file."
        aria-label="Policy document"
        className="in"
        style={{ height: "auto", padding: 10, width: "100%" }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={onFile} className="sm" aria-label="Upload a .txt or .md file" />
        <button type="submit" className="b pri" disabled={pending} style={{ marginLeft: "auto" }}>
          {pending ? "Drafting…" : "Draft new version"}
        </button>
      </div>
      {error && <span className="msg bad sm">{error}</span>}
      <p className="hint" style={{ margin: 0 }}>
        Plain text or Markdown, up to 50 KB. The document is only summarised into rules; nothing in it is followed as an instruction.
      </p>
    </form>
  );
}
