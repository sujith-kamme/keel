import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("stores scrypt params, a 16-byte salt and a 64-byte key", async () => {
    const parts = (await hashPassword("correct horse battery")).split("$");
    expect(parts.slice(0, 4)).toEqual(["scrypt", "32768", "8", "1"]);
    expect(Buffer.from(parts[4]!, "base64")).toHaveLength(16);
    expect(Buffer.from(parts[5]!, "base64")).toHaveLength(64);
  });

  it("verifies the right password only", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterY", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same password")).not.toBe(await hashPassword("same password"));
  });

  it("reads the params from the stored string", async () => {
    const { scrypt } = await import("node:crypto");
    const salt = Buffer.alloc(16, 7);
    const key = await new Promise<Buffer>((resolve, reject) =>
      scrypt("pw-with-other-params", salt, 32, { N: 1024, r: 4, p: 2 }, (e, k) => (e ? reject(e) : resolve(k))),
    );
    const stored = `scrypt$1024$4$2$${salt.toString("base64")}$${key.toString("base64")}`;
    expect(await verifyPassword("pw-with-other-params", stored)).toBe(true);
    expect(await verifyPassword("other", stored)).toBe(false);
  });

  it("rejects malformed stored values instead of throwing", async () => {
    for (const bad of ["", "plain", "bcrypt$1$2$3$4$5", "scrypt$abc$8$1$AA==$AA==", "scrypt$1000$8$1$AA==$AA==", "scrypt$32768$8$1$$"]) {
      expect(await verifyPassword("x", bad)).toBe(false);
    }
  });
});
