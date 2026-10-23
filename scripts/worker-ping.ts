// Enqueue a ping job and wait for the worker to answer.
import { Queue, QueueEvents } from "bullmq";
import { QUEUE, redisConnection } from "@keel/worker/queue";

// BullMQ does not close connections it was handed, so keep them to quit at the end.
const queueConn = redisConnection();
const eventsConn = redisConnection();
const queue = new Queue(QUEUE, { connection: queueConn });
const events = new QueueEvents(QUEUE, { connection: eventsConn });
try {
  await events.waitUntilReady();
  const job = await queue.add("ping", {});
  console.log("worker answered:", await job.waitUntilFinished(events, 10_000));
} finally {
  await Promise.all([queue.close(), events.close()]);
  await Promise.all([queueConn.quit(), eventsConn.quit()]);
}
