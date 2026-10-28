import { Worker } from "bullmq";
import { type NotifyEvent, notifyConfig, sendNotify } from "./jobs/notify";
import { QUEUE, redisConnection } from "./queue";

/** Handlers that need the API process's dependencies (the Gauntlet runner). */
export interface WorkerHandlers {
  gauntlet?: (runId: string) => Promise<void>;
}

export function startWorker(handlers: WorkerHandlers = {}) {
  const { hookUrl } = notifyConfig(process.env); // a bad URL fails at start-up
  const worker = new Worker(
    QUEUE,
    async (job) => {
      if (job.name === "ping") return { pong: true, at: new Date().toISOString() };
      if (job.name === "notify") return sendNotify(job.data as NotifyEvent, { hookUrl, fetch });
      if (job.name === "gauntlet.run") {
        if (!handlers.gauntlet) throw new Error("No gauntlet handler: run the worker inside the API (RUN_WORKER=true)");
        return handlers.gauntlet((job.data as { run_id: string }).run_id);
      }
      throw new Error(`Unknown job: ${job.name}`);
    },
    // A Gauntlet run lasts minutes; notifications must not wait behind it.
    { connection: redisConnection(), concurrency: 4 },
  );

  worker.on("ready", () => console.log(`keel worker ready on queue "${QUEUE}"`));
  worker.on("failed", (job, err) => console.error(`job ${job?.name} failed: ${err.message}`));
  return worker;
}
