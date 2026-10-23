import { Redis } from "ioredis";

export const QUEUE = "keel";

// BullMQ requires maxRetriesPerRequest: null on worker connections.
export function redisConnection() {
  return new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
}
