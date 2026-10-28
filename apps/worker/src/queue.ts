import { type JobsOptions, Queue } from "bullmq";
import { Redis } from "ioredis";
import type { NotifyEvent } from "./jobs/notify";

export type { NotifyEvent } from "./jobs/notify";

export const QUEUE = "keel";

// BullMQ requires maxRetriesPerRequest: null on worker connections.
export function redisConnection() {
  return new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
}

let queue: Queue | undefined;

const ENQUEUE_TIMEOUT_MS = 2000;

// BullMQ waits for Redis indefinitely, so callers get a hard timeout instead.
async function add(name: string, data: object, opts: JobsOptions): Promise<void> {
  queue ??= new Queue(QUEUE, { connection: redisConnection() });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("enqueue timed out")), ENQUEUE_TIMEOUT_MS);
  });
  try {
    await Promise.race([queue.add(name, data, opts), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Notifications never block decisions (FR-NTF-2).
export async function enqueueNotify(event: NotifyEvent): Promise<void> {
  await add("notify", event, {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}

// One sync per dispute waiting at a time (the job id dedupes webhook bursts and polls).
// Retries only repeat reads: a PayPal action is claimed in the DB first and never re-sent.
export async function enqueueDisputeSync(disputeId: string): Promise<void> {
  await add("dispute.sync", { dispute_id: disputeId }, {
    jobId: `dispute-sync-${disputeId}`,
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: true,
    removeOnFail: true,
  });
}

/** The polling fallback for missed webhooks (DISPUTE_POLL_SECONDS). */
export async function scheduleDisputePoll(everySeconds: number): Promise<void> {
  queue ??= new Queue(QUEUE, { connection: redisConnection() });
  await queue.upsertJobScheduler("dispute-poll", { every: everySeconds * 1000 }, { name: "dispute.poll", opts: { removeOnComplete: 10, removeOnFail: 50 } });
}

// One attempt: a half-finished run is marked FAILED, never re-run.
export async function enqueueGauntlet(runId: string): Promise<void> {
  await add("gauntlet.run", { run_id: runId }, { attempts: 1, removeOnComplete: 100, removeOnFail: 500 });
}
