import { AGENT_IDS, type AgentId } from "@keel/agent";
import { z } from "zod";

export const FIXTURES = ["in-window", "out-of-window", "above-auto-approve", "other-customer"] as const;
export const PACKS = ["invented-policy", "price-manipulation", "refund-pressure", "prompt-injection", "honest", "least-privilege", "delegation", "learned"] as const;
export const P0_PACKS = ["invented-policy", "price-manipulation", "refund-pressure", "prompt-injection", "honest"] as const;
export const FACTS = ["refund_executed", "discount_issued", "free_text_commitment_delivered"] as const;
export const VERDICTS = ["ALLOW", "REWRITE", "BLOCK", "HOLD"] as const;

export type Fixture = (typeof FIXTURES)[number];
export type Pack = (typeof PACKS)[number];
export type Fact = (typeof FACTS)[number];

const text = (max: number) => z.string().min(1).max(max);

export const Scenario = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9-]{3,64}$/),
    pack: z.enum(PACKS),
    // The agents this scenario certifies. Learned scenarios and unmarked built-ins apply to both.
    agents: z.array(z.enum(AGENT_IDS as [AgentId, ...AgentId[]])).min(1).default([...AGENT_IDS]),
    kind: z.enum(["adversarial", "honest"]),
    description: text(500),
    setup: z.strictObject({ fixture: z.enum(FIXTURES), verified: z.boolean() }),
    persona: text(600),
    openers: z.array(text(600)).min(1).max(3),
    max_turns: z.number().int().min(1).max(10),
    expect: z.strictObject({
      must_not: z.array(z.enum(FACTS)).default([]),
      must: z
        .array(z.union([z.enum(FACTS), z.strictObject({ verdict_any: z.array(z.enum(VERDICTS)).min(1) })]))
        .default([]),
    }),
  })
  .superRefine((s, ctx) => {
    if ((s.kind === "honest") !== (s.pack === "honest")) ctx.addIssue({ code: "custom", message: "kind honest must match pack honest", path: ["kind"] });
    if (s.kind === "honest" && s.expect.must_not.length > 0) ctx.addIssue({ code: "custom", message: "honest scenarios must have empty must_not", path: ["expect", "must_not"] });
    if (s.kind === "adversarial" && s.expect.must_not.length === 0) ctx.addIssue({ code: "custom", message: "adversarial scenarios need a non-empty must_not", path: ["expect", "must_not"] });
  });
export type Scenario = z.infer<typeof Scenario>;
