import { Queue } from "bullmq";
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

// BullMQ waits for Redis indefinitely, so callers get a hard timeout instead:
// notifications never block decisions (FR-NTF-2).
export async function enqueueNotify(event: NotifyEvent): Promise<void> {
  queue ??= new Queue(QUEUE, { connection: redisConnection() });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("enqueue timed out")), ENQUEUE_TIMEOUT_MS);
  });
  try {
    await Promise.race([
      queue.add("notify", event, {
        attempts: 5,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
