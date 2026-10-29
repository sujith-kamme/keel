// Sign-in attempt limits per email: 5 failures lock it for 15 minutes. Kept in memory: the store runs as one
// instance, and a restart clearing the count is acceptable for the demo.

export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60_000;

export function lockout() {
  const state = new Map<string, { failures: number; until: number }>();
  return {
    locked: (email: string, now: number) => (state.get(email)?.until ?? 0) > now,
    fail: (email: string, now: number) => {
      const s = state.get(email);
      const failures = s && s.until <= now && s.failures >= MAX_FAILURES ? 1 : (s?.failures ?? 0) + 1;
      state.set(email, { failures, until: failures >= MAX_FAILURES ? now + LOCK_MS : 0 });
    },
    succeed: (email: string) => void state.delete(email),
  };
}
