import { serve } from "@hono/node-server";
import { createDb, sql } from "@keel/db";
import { Redis } from "ioredis";
import { createApp } from "./app";

const db = createDb();
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { lazyConnect: true, maxRetriesPerRequest: 1 });

const app = createApp({
  checks: {
    db: async () => {
      await db.execute(sql`select 1`);
    },
    redis: async () => {
      await redis.ping();
    },
  },
});

// Render injects PORT; API_PORT is the local default.
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`keel api listening on :${port}`));
