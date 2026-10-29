// The merchant's agents. Keel mints each session's capability from `allow`; the
// Gauntlet certifies each agent on its `packs`. Fixed in code: there is no agent CRUD.
export const AGENTS = {
  agt_policy: {
    name: "Policy agent",
    role: "policy",
    allow: ["get_order", "state_policy", "escalate_to_human", "handoff_to_refund"],
    packs: ["invented-policy", "price-manipulation", "prompt-injection", "honest", "least-privilege"],
  },
  agt_refund: {
    name: "Refund agent",
    role: "refund",
    allow: ["get_order", "offer_refund", "offer_discount", "state_policy", "escalate_to_human"],
    packs: ["refund-pressure", "price-manipulation", "prompt-injection", "honest", "delegation"],
  },
} as const;

export type AgentId = keyof typeof AGENTS;
export type AgentRole = (typeof AGENTS)[AgentId]["role"];
export const AGENT_IDS = Object.keys(AGENTS) as AgentId[];
/** Every live conversation starts here. */
export const ENTRY_AGENT: AgentId = "agt_policy";
export const isAgentId = (v: unknown): v is AgentId => typeof v === "string" && Object.hasOwn(AGENTS, v);
