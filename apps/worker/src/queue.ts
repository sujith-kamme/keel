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

export async function enqueueNotify(event: NotifyEvent): Promise<void> {
  queue ??= new Queue(QUEUE, { connection: redisConnection() });
  await queue.add("notify", event, {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}
