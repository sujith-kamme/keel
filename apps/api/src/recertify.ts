import { AGENT_IDS, type AgentId } from "@keel/agent";
import { type Versions, versionDiff } from "@keel/gauntlet";

export interface RecertifyDeps {
  /** The agent's newest guarded full-pack run, any status. */
  latest: (agentId: AgentId) => Promise<{ status: string; versions: Versions } | null>;
  versions: (agentId: AgentId) => Promise<Versions>;
  start: (agentId: AgentId) => Promise<void>;
}

/**
 * Queues a guarded run for each agent whose inputs changed since its newest run.
 * Coalesced: nothing is queued while that agent has a run queued or running; when
 * that run finishes this is called again and catches any change made meanwhile.
 */
export function createRecertify(deps: RecertifyDeps): () => Promise<void> {
  return async () => {
    for (const id of AGENT_IDS) {
      const [run, current] = await Promise.all([deps.latest(id), deps.versions(id)]);
      if (run && (run.status === "QUEUED" || run.status === "RUNNING")) continue;
      if (run && versionDiff(run.versions, current).length === 0) continue;
      await deps.start(id);
    }
  };
}
