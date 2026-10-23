import { describe, expect, it } from "vitest";
import { createApp } from "./app";

describe("GET /health", () => {
  it("returns 200 when every check passes", async () => {
    const app = createApp({ checks: { db: async () => {}, redis: async () => {} } });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", checks: { db: "ok", redis: "ok" } });
  });

  it("returns 503 and names the failing dependency", async () => {
    const app = createApp({
      checks: {
        db: async () => {},
        redis: async () => {
          throw new Error("connection refused");
        },
      },
    });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded", checks: { db: "ok", redis: "down" } });
  });
});
