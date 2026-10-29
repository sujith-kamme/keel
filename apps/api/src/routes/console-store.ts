import { type Db, consoleAccount, eq } from "@keel/db";
import type { ConsoleAccount, ConsoleStore } from "./console";

const ROW = 1;

const toAccount = (r: typeof consoleAccount.$inferSelect): ConsoleAccount => ({
  email: r.email,
  passwordHash: r.passwordHash,
  sessionVersion: r.sessionVersion,
});

export function createConsoleStore(db: Db): ConsoleStore {
  return {
    get: async () => {
      const [row] = await db.select().from(consoleAccount).where(eq(consoleAccount.id, ROW));
      return row ? toAccount(row) : null;
    },
    seed: async (email, passwordHash) => {
      await db.insert(consoleAccount).values({ id: ROW, email, passwordHash }).onConflictDoNothing();
    },
  };
}
