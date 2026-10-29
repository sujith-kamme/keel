import { Worker } from "bullmq";
import { type NotifyEvent, sendNotify } from "./jobs/notify";
import { QUEUE, redisConnection } from "./queue";

/** Handlers that need the API process's dependencies (the Gauntlet runner). */
export interface WorkerHandlers {
  /** The Zapier hook URL, read per notify job (null skips the send). */
  hookUrl: () => Promise<string | null>;
  gauntlet?: (runId: string) => Promise<void>;
  dispute?: { sync: (disputeId: string) => Promise<void>; poll: () => Promise<number> };
}

/** The job processor; exported so tests can run jobs without Redis. */
export function processor(handlers: WorkerHandlers) {
  return async (job: { name: string; data: unknown }) => {
    if (job.name === "ping") return { pong: true, at: new Date().toISOString() };
    if (job.name === "notify") return sendNotify(job.data as NotifyEvent, { hookUrl: await handlers.hookUrl(), fetch });
    if (job.name === "gauntlet.run") {
      if (!handlers.gauntlet) throw new Error("No gauntlet handler: run the worker inside the API (RUN_WORKER=true)");
      return handlers.gauntlet((job.data as { run_id: string }).run_id);
    }
    if (job.name === "dispute.sync" || job.name === "dispute.poll") {
      if (!handlers.dispute) throw new Error("No dispute handler: run the worker inside the API (RUN_WORKER=true)");
      if (job.name === "dispute.poll") return handlers.dispute.poll();
      return handlers.dispute.sync((job.data as { dispute_id: string }).dispute_id);
    }
    throw new Error(`Unknown job: ${job.name}`);
  };
}

export function startWorker(handlers: WorkerHandlers) {
  const worker = new Worker(
    QUEUE,
    processor(handlers),
    // A Gauntlet run lasts minutes; notifications must not wait behind it.
    { connection: redisConnection(), concurrency: 4 },
  );

  worker.on("ready", () => console.log(`keel worker ready on queue "${QUEUE}"`));
  worker.on("failed", (job, err) => console.error(`job ${job?.name} failed: ${err.message}`));
  return worker;
}
