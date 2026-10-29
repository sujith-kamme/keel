import type { AgentId } from "@keel/agent";
import type { Versions } from "@keel/gauntlet";
import { type Settings, agentSettings } from "./settings-schema";

// The policy agent quotes these; the price catalog backs price claims in either agent's replies.
const POLICY_AGENT_POLICIES = ["policy-returns", "policy-bereavement", "policy-shipping", "price-catalog"];

/** An agent's certification snapshot: the inputs that, when changed, make its certification stale (spec section 1). */
export function agentVersions(id: AgentId, s: Settings, policies: Record<string, number>, extractorPromptVersion: string): Versions {
  const own = agentSettings(s, id);
  const base: Versions = {
    agent_id: id,
    agent_model: own.model,
    agent_prompt: own.prompt,
    extractor_model: s.extractor_model,
    extractor_prompt_version: extractorPromptVersion,
    extractor_timeout_ms: s.extractor_timeout_ms,
    policies: id === "agt_policy" ? Object.fromEntries(Object.entries(policies).filter(([k]) => POLICY_AGENT_POLICIES.includes(k))) : policies,
  };
  if (id === "agt_policy") return base;
  const from = agentSettings(s, "agt_policy");
  return { ...base, risk_threshold: s.risk_threshold, risk_half_life_min: s.risk_half_life_min, handoff_model: from.model, handoff_prompt: from.prompt };
}
