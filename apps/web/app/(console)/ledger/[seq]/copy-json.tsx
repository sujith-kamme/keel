"use client";

import { useState } from "react";

/** Copies the entry, as the API returns it, to the clipboard. */
export function CopyJson({ value }: { value: unknown }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = () =>
    navigator.clipboard.writeText(JSON.stringify(value, null, 2)).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  return (
    <button type="button" className="b" onClick={copy}>
      {copied === null ? "Copy JSON" : copied ? "Copied" : "Copy failed"}
    </button>
  );
}
