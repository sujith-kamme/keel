import { Worker } from "bullmq";
import { type NotifyEvent, notifyConfig, sendNotify } from "./jobs/notify";
import { QUEUE, redisConnection } from "./queue";

export function startWorker() {
  const { hookUrl } = notifyConfig(process.env); // a bad URL fails at start-up
  const worker = new Worker(
    QUEUE,
    async (job) => {
      if (job.name === "ping") return { pong: true, at: new Date().toISOString() };
      if (job.name === "notify") return sendNotify(job.data as NotifyEvent, { hookUrl, fetch });
      throw new Error(`Unknown job: ${job.name}`);
    },
    { connection: redisConnection() },
  );

  worker.on("ready", () => console.log(`keel worker ready on queue "${QUEUE}"`));
  worker.on("failed", (job, err) => console.error(`job ${job?.name} failed: ${err.message}`));
  return worker;
}
