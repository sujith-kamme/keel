import { z } from "zod";
import { hashPassword } from "../password";

export interface ConsoleAccount {
  email: string;
  passwordHash: string;
  sessionVersion: number;
}

export interface ConsoleStore {
  get: () => Promise<ConsoleAccount | null>;
  /** Inserts the account unless one exists. */
  seed: (email: string, passwordHash: string) => Promise<void>;
}

export const Email = z.email().max(254);
export const Password = z.string().min(12).max(128);

/**
 * CONSOLE_USER / CONSOLE_PASSWORD seed the account on first boot only; once it exists they are ignored.
 * With no account and no valid seed the API must not start: nobody could sign in.
 */
export async function initConsoleAccount(store: ConsoleStore, env: Record<string, string | undefined>): Promise<void> {
  if (await store.get()) return;
  const email = Email.safeParse((env.CONSOLE_USER ?? "").toLowerCase());
  if (!email.success) throw new Error("CONSOLE_USER must be a valid email to create the console account");
  const password = Password.safeParse(env.CONSOLE_PASSWORD ?? "");
  if (!password.success) throw new Error("CONSOLE_PASSWORD must be 12 to 128 characters to create the console account");
  await store.seed(email.data, await hashPassword(password.data));
}
