import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENTS, AGENT_IDS } from "@keel/agent";
import { loadBuiltin, parseScenario } from "./index";

const IDS = [
  "bereavement-retroactive", "one-device-rule", "lifetime-warranty",
  "legally-binding-agreement", "one-dollar-item", "stacked-discounts",
  "colleague-promised", "above-captured", "outside-window", "double-refund",
  "instruction-injection", "fake-system-message",
  "in-policy-refund", "policy-question", "shipping-question", "order-status", "small-refund",
  "direct-refund", "direct-discount", "inflated-handoff", "promised-by-support",
];

const base = {
  id: "test-scenario", pack: "refund-pressure", kind: "adversarial", description: "d",
  setup: { fixture: "in-window", verified: true }, persona: "p", openers: ["hi"], max_turns: 3,
  expect: { must_not: ["refund_executed"] },
};
const yaml = (o: object) => JSON.stringify(o);
function dir(files: Record<string, string>) {
  const d = mkdtempSync(join(tmpdir(), "gauntlet-"));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(d, name, ".."), { recursive: true });
    writeFileSync(join(d, name), body);
  }
  return d;
}

describe("built-in scenarios", () => {
  const all = loadBuiltin();
  it("has exactly the 21 built-in ids", () => expect(all.map((s) => s.id).sort()).toEqual([...IDS].sort()));
  it("has at least 2 scenarios per certified pack", () => {
    for (const p of new Set(AGENT_IDS.flatMap((id) => AGENTS[id].packs))) expect(all.filter((s) => s.pack === p).length).toBeGreaterThanOrEqual(2);
  });
  it("assigns every built-in scenario to at least one agent, covering each agent's packs", () => {
    for (const id of AGENT_IDS) {
      const mine = all.filter((s) => s.agents.includes(id));
      for (const pack of AGENTS[id].packs) expect(mine.some((s) => s.pack === pack), `${id} has no ${pack} scenario`).toBe(true);
    }
    expect(all.find((s) => s.id === "stacked-discounts")!.agents).toEqual(["agt_refund"]);
    expect(all.find((s) => s.id === "fake-system-message")!.agents).toEqual(["agt_policy", "agt_refund"]);
  });
});

describe("loader", () => {
  it("rejects duplicate ids", () => {
    const d = dir({ "a/one.yaml": yaml(base), "b/two.yaml": yaml(base) });
    expect(() => loadBuiltin(d)).toThrow(/Duplicate scenario id test-scenario/);
  });
  it("names the invalid file", () => {
    const d = dir({ "bad-one.yaml": yaml({ ...base, max_turns: 99 }) });
    expect(() => loadBuiltin(d)).toThrow(/bad-one\.yaml/);
  });
});

describe("scenario rules", () => {
  it("accepts a valid adversarial scenario", () => expect(parseScenario(base).expect.must).toEqual([]));
  it("rejects honest kind outside the honest pack", () => expect(() => parseScenario({ ...base, kind: "honest", expect: {} })).toThrow());
  it("rejects honest pack with adversarial kind", () => expect(() => parseScenario({ ...base, pack: "honest" })).toThrow());
  it("rejects honest scenario with must_not", () => expect(() => parseScenario({ ...base, pack: "honest", kind: "honest" })).toThrow());
  it("rejects adversarial scenario with empty must_not", () => expect(() => parseScenario({ ...base, expect: {} })).toThrow());
  it("rejects unknown fixture", () => expect(() => parseScenario({ ...base, setup: { fixture: "nope", verified: true } })).toThrow());
  it("rejects unknown keys", () => expect(() => parseScenario({ ...base, extra: 1 })).toThrow());
});
