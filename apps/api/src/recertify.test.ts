import type { AgentId } from "@keel/agent";
import { describe, expect, it, vi } from "vitest";
import { createRecertify } from "./recertify";

const v = (model: string) => ({ agent_model: model, agent_prompt: "strict", extractor_model: "x", extractor_prompt_version: "1", extractor_timeout_ms: 4000, policies: {} });

function setup(latest: Record<string, { status: string; versions: ReturnType<typeof v> } | null>, current: Record<string, ReturnType<typeof v>>) {
  const start = vi.fn(async (_id: AgentId) => {});
  const recertify = createRecertify({ latest: async (id) => latest[id] ?? null, versions: async (id) => current[id]!, start });
  return { recertify, start };
}

describe("recertify", () => {
  it("queues a run only for the agent whose versions changed", async () => {
    const { recertify, start } = setup(
      { agt_policy: { status: "DONE", versions: v("a") }, agt_refund: { status: "DONE", versions: v("a") } },
      { agt_policy: v("a"), agt_refund: v("b") },
    );
    await recertify();
    expect(start.mock.calls.map((c) => c[0])).toEqual(["agt_refund"]);
  });

  it("does not queue behind a run that is already queued or running", async () => {
    const { recertify, start } = setup(
      { agt_policy: { status: "QUEUED", versions: v("a") }, agt_refund: { status: "RUNNING", versions: v("a") } },
      { agt_policy: v("b"), agt_refund: v("b") },
    );
    await recertify();
    expect(start).not.toHaveBeenCalled();
  });

  it("queues an agent that has never run", async () => {
    const { recertify, start } = setup({}, { agt_policy: v("a"), agt_refund: v("a") });
    await recertify();
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("does not retry a failed run on the same versions", async () => {
    const { recertify, start } = setup(
      { agt_policy: { status: "FAILED", versions: v("a") }, agt_refund: { status: "FAILED", versions: v("a") } },
      { agt_policy: v("a"), agt_refund: v("a") },
    );
    await recertify();
    expect(start).not.toHaveBeenCalled();
  });

  it("keeps going when one agent's check throws", async () => {
    const start = vi.fn(async (_id: AgentId) => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const recertify = createRecertify({
      latest: async () => null,
      versions: async (id) => {
        if (id === "agt_policy") throw new Error("boom");
        return v("a");
      },
      start,
    });
    await recertify();
    expect(start.mock.calls.map((c) => c[0])).toEqual(["agt_refund"]);
    expect(err).toHaveBeenCalledWith("recertify failed:", "agt_policy", "boom");
    err.mockRestore();
  });
});
