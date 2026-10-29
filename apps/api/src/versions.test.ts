import { describe, expect, it } from "vitest";
import { agentVersions } from "./versions";

const s = {
  policy_agent_model: "claude-haiku-5-5", policy_agent_prompt: "strict",
  refund_agent_model: "claude-sonnet-5-5", refund_agent_prompt: "lenient",
  extractor_model: "claude-haiku-5-5", extractor_timeout_ms: 4000, risk_threshold: 60, risk_half_life_min: 30,
} as never;
const policies = { "refund-standard": 3, "discount-goodwill": 1, "policy-returns": 2, "policy-bereavement": 1, "policy-shipping": 1, "price-catalog": 4 };

describe("agentVersions", () => {
  it("gives the policy agent only its own model, its policies and the extractor", () => {
    expect(agentVersions("agt_policy", s, policies, "p1")).toEqual({
      agent_id: "agt_policy", agent_model: "claude-haiku-5-5", agent_prompt: "strict",
      extractor_model: "claude-haiku-5-5", extractor_prompt_version: "p1", extractor_timeout_ms: 4000,
      policies: { "policy-returns": 2, "policy-bereavement": 1, "policy-shipping": 1, "price-catalog": 4 },
    });
  });

  it("gives the refund agent everything, including the policy agent's model and prompt", () => {
    expect(agentVersions("agt_refund", s, policies, "p1")).toMatchObject({
      agent_id: "agt_refund", agent_model: "claude-sonnet-5-5", agent_prompt: "lenient",
      handoff_model: "claude-haiku-5-5", handoff_prompt: "strict",
      risk_threshold: 60, risk_half_life_min: 30, policies,
    });
  });
});
