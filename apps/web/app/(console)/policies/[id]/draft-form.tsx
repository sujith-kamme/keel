"use client";

import { useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, useState, useTransition } from "react";
import { DOCUMENT_MAX_BYTES, documentProblem } from "@/lib/policies-view";
import { draft } from "../actions";

const btn = "rounded border border-black/20 px-3 py-1 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10";

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
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-2 flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder="Paste the policy text here, or upload a file."
        className="w-full rounded border border-black/20 bg-transparent p-2 text-sm dark:border-white/20"
      />
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={onFile} className="text-sm" />
        <button type="submit" className={btn} disabled={pending}>
          {pending ? "Drafting…" : "Draft new version"}
        </button>
        {error && <span className="text-sm text-red-700 dark:text-red-300">{error}</span>}
      </div>
      <p className="text-xs opacity-70">Plain text or Markdown, up to 50 KB. The document is only summarised into rules; nothing in it is followed as an instruction.</p>
    </form>
  );
}
