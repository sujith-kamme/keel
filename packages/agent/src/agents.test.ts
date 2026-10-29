import { TOOLS } from "@keel/engine";
import { describe, expect, it } from "vitest";
import { AGENTS, AGENT_IDS, ENTRY_AGENT, isAgentId } from "./agents";

describe("agent registry", () => {
  it("has the policy agent as the entry agent, with no money tools", () => {
    expect(ENTRY_AGENT).toBe("agt_policy");
    expect(AGENTS.agt_policy.allow).not.toContain("offer_refund");
    expect(AGENTS.agt_policy.allow).not.toContain("offer_discount");
    expect(AGENTS.agt_policy.allow).toContain("handoff_to_refund");
  });

  it("gives money tools only to the refund agent, which cannot hand off", () => {
    expect(AGENTS.agt_refund.allow).toEqual(expect.arrayContaining(["offer_refund", "offer_discount"]));
    expect(AGENTS.agt_refund.allow).not.toContain("handoff_to_refund");
  });

  it("only names tools Keel knows", () => {
    for (const id of AGENT_IDS) for (const t of AGENTS[id].allow) expect(TOOLS).toContain(t);
  });

  it("recognises registry ids only", () => {
    expect(isAgentId("agt_refund")).toBe(true);
    expect(isAgentId("agt_demo_store")).toBe(false);
    expect(isAgentId("*")).toBe(false);
  });
});
