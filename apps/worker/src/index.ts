import { createDb, readSettings } from "@keel/db";
import { startWorker } from "./worker";

// The standalone worker only sends notifications: it reads the hook per job from the settings table the API
// seeds, so ZAPIER_HOOK_URL in this worker's own env is not used.
const db = createDb();
startWorker({
  hookUrl: async () => {
    const { zapier_hook_url: url } = await readSettings(db, ["zapier_hook_url"]);
    return typeof url === "string" ? url : null;
  },
});
