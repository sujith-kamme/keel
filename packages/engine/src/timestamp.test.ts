import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readTimestampReply, timestampRequest } from "./timestamp";

// sha256("keel"); the fixtures are `openssl ts -query -digest <hash> -sha256 -no_nonce -cert`
// and FreeTSA's reply to it.
const HASH = "d6dba7e8a54d32d2cf8eef5b0e648c5c388079827039a1e56a9bfb282fc883ab";
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

describe("timestampRequest", () => {
  it("matches openssl's request byte for byte", () => {
    expect(Buffer.from(timestampRequest(HASH)).toString("hex")).toBe(Buffer.from(fixture("freetsa-keel.tsq")).toString("hex"));
  });

  it("rejects anything but a sha256 hex digest", () => {
    expect(() => timestampRequest("abc")).toThrow();
  });
});

describe("readTimestampReply", () => {
  it("accepts FreeTSA's granted reply and reads the signing time", () => {
    expect(readTimestampReply(fixture("freetsa-keel.tsr"), HASH)).toEqual({ signed_at: new Date("2026-11-06T21:53:46Z") });
  });

  it("rejects a reply for another hash", () => {
    expect(readTimestampReply(fixture("freetsa-keel.tsr"), "00".repeat(32))).toBeNull();
  });

  it("rejects a refused reply", () => {
    expect(readTimestampReply(Uint8Array.from([0x30, 0x05, 0x30, 0x03, 0x02, 0x01, 0x02]), HASH)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(readTimestampReply(Uint8Array.from([0x30, 0x80, 0x01]), HASH)).toBeNull();
    expect(readTimestampReply(new Uint8Array(), HASH)).toBeNull();
  });
});
