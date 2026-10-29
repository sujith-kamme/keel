import { describe, expect, it } from "vitest";
import { verifyPassword } from "../password";
import { type ConsoleAccount, type ConsoleStore, initConsoleAccount } from "./console";

const PASSWORD = "correct-horse-battery";

function fakeStore(initial: ConsoleAccount | null = null) {
  let account = initial;
  const store: ConsoleStore = {
    get: async () => account && { ...account },
    seed: async (email, passwordHash) => {
      account ??= { email, passwordHash, sessionVersion: 1 };
    },
  };
  return { store, account: () => account };
}

describe("initConsoleAccount", () => {
  it("seeds from env: lowercased email, hashed password", async () => {
    const s = fakeStore();
    await initConsoleAccount(s.store, { CONSOLE_USER: "Admin@Tidewell.com", CONSOLE_PASSWORD: PASSWORD });
    expect(s.account()?.email).toBe("admin@tidewell.com");
    expect(s.account()?.passwordHash).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, s.account()!.passwordHash)).toBe(true);
  });

  it("ignores env once the account exists, even when env is missing", async () => {
    const existing = { email: "ops@example.com", passwordHash: "scrypt$x", sessionVersion: 3 };
    const s = fakeStore(existing);
    await initConsoleAccount(s.store, { CONSOLE_USER: "other@example.com", CONSOLE_PASSWORD: "another-long-password" });
    await initConsoleAccount(s.store, {});
    expect(s.account()).toEqual(existing);
  });

  it("throws at boot with no account and a missing or invalid seed", async () => {
    for (const env of [
      {},
      { CONSOLE_USER: "admin@tidewell.com" },
      { CONSOLE_USER: "judge", CONSOLE_PASSWORD: PASSWORD },
      { CONSOLE_USER: "admin@tidewell.com", CONSOLE_PASSWORD: "short" },
      { CONSOLE_USER: "admin@tidewell.com", CONSOLE_PASSWORD: "x".repeat(129) },
    ]) {
      const s = fakeStore();
      await expect(initConsoleAccount(s.store, env)).rejects.toThrow(/CONSOLE_(USER|PASSWORD)/);
      expect(s.account()).toBeNull();
    }
  });

  it("never puts the password in the error", async () => {
    await expect(initConsoleAccount(fakeStore().store, { CONSOLE_USER: "a@b.co", CONSOLE_PASSWORD: "secret" })).rejects.not.toThrow(/secret/);
  });
});
