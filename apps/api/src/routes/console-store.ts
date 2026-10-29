import { type Db, type DbOrTx, appendLedger, consoleAccount, eq, sql } from "@keel/db";
import type { ConsoleAccount, ConsoleStore } from "./console";

const ROW = 1;

const toAccount = (r: typeof consoleAccount.$inferSelect): ConsoleAccount => ({
  email: r.email,
  passwordHash: r.passwordHash,
  sessionVersion: r.sessionVersion,
});

export function createConsoleStore(db: Db): ConsoleStore {
  /** Runs `fn` with the account row locked, in one transaction with its ledger append. */
  const locked = <T>(fn: (tx: DbOrTx, row: typeof consoleAccount.$inferSelect) => Promise<T>) =>
    db.transaction(async (tx) => {
      const [row] = await tx.select().from(consoleAccount).where(eq(consoleAccount.id, ROW)).for("update");
      if (!row) throw new Error("console account missing");
      return fn(tx, row);
    });

  return {
    get: async () => {
      const [row] = await db.select().from(consoleAccount).where(eq(consoleAccount.id, ROW));
      return row ? toAccount(row) : null;
    },
    seed: async (email, passwordHash) => {
      await db.insert(consoleAccount).values({ id: ROW, email, passwordHash }).onConflictDoNothing();
    },
    setEmail: (email, entry) =>
      locked(async (tx, row) => {
        await tx.update(consoleAccount).set({ email, updatedAt: sql`now()` }).where(eq(consoleAccount.id, ROW));
        await appendLedger(tx, entry(row.email));
      }),
    setPassword: (fromHash, toHash, entry) =>
      locked(async (tx, row) => {
        if (row.passwordHash !== fromHash) return null;
        const [updated] = await tx
          .update(consoleAccount)
          .set({ passwordHash: toHash, passwordChangedAt: sql`now()`, sessionVersion: sql`${consoleAccount.sessionVersion} + 1`, updatedAt: sql`now()` })
          .where(eq(consoleAccount.id, ROW))
          .returning({ v: consoleAccount.sessionVersion });
        await appendLedger(tx, entry);
        return updated!.v;
      }),
    revokeSessions: (entry) =>
      locked(async (tx) => {
        const [updated] = await tx
          .update(consoleAccount)
          .set({ sessionVersion: sql`${consoleAccount.sessionVersion} + 1`, updatedAt: sql`now()` })
          .where(eq(consoleAccount.id, ROW))
          .returning({ v: consoleAccount.sessionVersion });
        await appendLedger(tx, entry);
        return updated!.v;
      }),
  };
}
