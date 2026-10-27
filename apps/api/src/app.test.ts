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

describe("hardening", () => {
  const app = createApp({ checks: {} });

  it("sets security headers", async () => {
    const res = await app.request("/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("rejects request bodies over 64 KB", async () => {
    const res = await app.request("/v1/sessions", { method: "POST", body: "x".repeat(65 * 1024) });
    expect(res.status).toBe(413);
  });
});
