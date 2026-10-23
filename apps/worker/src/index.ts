import { Worker } from "bullmq";
import { QUEUE, redisConnection } from "./queue";

const worker = new Worker(
  QUEUE,
  async (job) => {
    if (job.name === "ping") return { pong: true, at: new Date().toISOString() };
    throw new Error(`Unknown job: ${job.name}`);
  },
  { connection: redisConnection() },
);

worker.on("ready", () => console.log(`keel worker ready on queue "${QUEUE}"`));
worker.on("failed", (job, err) => console.error(`job ${job?.name} failed: ${err.message}`));
