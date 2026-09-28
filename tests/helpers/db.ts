import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import { MIGRATIONS_FOLDER, type Db } from "@/server/storage/db";
import * as schema from "@/server/storage/schema";

// In-process Postgres for tests (plan F1, F1b): same Drizzle schema and migrations as production, no Docker needed.
// One engine per test process; every call starts from an empty, freshly migrated schema.
let engine: PGlite | undefined;

export async function openTestDb(): Promise<Db> {
  engine ??= new PGlite();
  await engine.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;");
  const db = drizzle(engine, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db as unknown as Db;
}
