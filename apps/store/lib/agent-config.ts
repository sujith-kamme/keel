import { AGENT_IDS, type AgentId, agentModel, promptMode, type AgentModel, type PromptMode } from "@keel/agent";

export type AgentConfig = Record<AgentId, { model: AgentModel; prompt: PromptMode }>;

const TTL_MS = 5_000;
const TIMEOUT_MS = 5_000;

/** Reads the agent model and prompt from the API settings, the same values the Gauntlet certifies. Failure throws: no fallback default. */
export function agentConfigReader(deps: { url: string; key: string; fetch?: typeof fetch; now?: () => number }): () => Promise<AgentConfig> {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  let cached: { value: AgentConfig; at: number } | undefined;
  return async () => {
    if (cached && now() - cached.at < TTL_MS) return cached.value;
    const res = await doFetch(`${deps.url}/v1/agent-config`, {
      headers: { authorization: `Bearer ${deps.key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`agent-config responded ${res.status}`);
    const body = (await res.json()) as { agents?: Record<string, { model?: string; prompt?: string }> };
    const value = Object.fromEntries(
      AGENT_IDS.map((id) => [id, { model: agentModel(body.agents?.[id]?.model), prompt: promptMode(body.agents?.[id]?.prompt) }]),
    ) as AgentConfig;
    cached = { value, at: now() };
    return value;
  };
}
