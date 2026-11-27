import postgres from "postgres";
import { env } from "~/env";

if (env.DATABASE_URL.includes("zdpzoremwtdcrwpajtmo")) {
  throw new Error(
    "DATABASE_URL points at the shared assessment database. Put your own Supabase session-pooler URI in .env.",
  );
}

const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

export const sql =
  globalForDb.sql ??
  postgres(env.DATABASE_URL, {
    max: 1,
    ssl: "require",
  });

if (env.NODE_ENV !== "production") {
  globalForDb.sql = sql;
}
