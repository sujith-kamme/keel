import { createDb, readSettings } from "@keel/db";
import { startWorker } from "./worker";

// The standalone worker only sends notifications: it reads the hook from the settings table per job.
const db = createDb();
startWorker({
  hookUrl: async () => {
    const { zapier_hook_url: url } = await readSettings(db, ["zapier_hook_url"]);
    return typeof url === "string" ? url : null;
  },
});
