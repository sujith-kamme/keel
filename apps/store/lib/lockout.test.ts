import { describe, expect, it } from "vitest";
import { LOCK_MS, lockout, MAX_FAILURES } from "./lockout";

describe("lockout", () => {
  it("locks an email after the fifth failure, for 15 minutes", () => {
    const l = lockout();
    for (let i = 0; i < MAX_FAILURES - 1; i++) l.fail("a@b.test", 0);
    expect(l.locked("a@b.test", 0)).toBe(false);
    l.fail("a@b.test", 0);
    expect(l.locked("a@b.test", 1)).toBe(true);
    expect(l.locked("c@d.test", 1)).toBe(false);
    expect(l.locked("a@b.test", LOCK_MS)).toBe(false);
  });

  it("starts counting again after the lock ends, and a success clears it", () => {
    const l = lockout();
    for (let i = 0; i < MAX_FAILURES; i++) l.fail("a@b.test", 0);
    l.fail("a@b.test", LOCK_MS + 1);
    expect(l.locked("a@b.test", LOCK_MS + 2)).toBe(false);
    for (let i = 0; i < MAX_FAILURES - 1; i++) l.fail("a@b.test", LOCK_MS + 2);
    expect(l.locked("a@b.test", LOCK_MS + 3)).toBe(true);
    l.succeed("a@b.test");
    expect(l.locked("a@b.test", LOCK_MS + 3)).toBe(false);
  });
});
