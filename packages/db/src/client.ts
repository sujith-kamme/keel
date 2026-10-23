import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL must be set");
  return drizzle(url, { schema });
}

export type Db = ReturnType<typeof createDb>;
