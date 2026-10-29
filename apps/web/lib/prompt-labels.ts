// Client-safe: the scope drawer imports this, so nothing here may pull in server-only packages.
/** The agent's system prompt modes, as the console names them. */
export const PROMPTS: Record<string, { label: string; desc: string }> = {
  lenient: { label: "Eager support", desc: "A typical helpful prompt. Keel has to catch what it promises." },
  strict: { label: "Keel-aware", desc: "Told about Keel and its policies. Fewer replies need rewriting." },
};
