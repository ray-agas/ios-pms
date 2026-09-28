import "server-only";

import path from "node:path";

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import * as schema from "./schema";

// Postgres through Drizzle (plan F1, F1b). App: postgres.js; tests: PGlite (tests/helpers/db.ts), same schema and
// migrations. Schema lives in schema.ts; `bun run db:generate` writes migrations to db/migrations; they run at startup.

/** The database type every module uses; both the postgres.js and the PGlite Drizzle instances satisfy it. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "db/migrations");

/**
 * One-time hand-over from the pre-Drizzle migration runner (tables created by 0001/0002, recorded in
 * public.schema_migrations). Records the Drizzle baseline as applied, the way Drizzle itself would, so the tables are
 * not created again. The baseline was checked for drift against the live database before the switch (plan F1b).
 */
async function adoptLegacySchema(sql: postgres.Sql) {
  const [legacy] = await sql`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present`;
  if (!legacy.present) return;
  const [baseline] = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  await sql.begin(async (tx) => {
    await tx`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await tx`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`;
    const [{ n }] = await tx`SELECT COUNT(*)::int AS n FROM drizzle.__drizzle_migrations`;
    if (n === 0) await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${baseline.hash}, ${baseline.folderMillis})`;
    await tx`DROP TABLE public.schema_migrations`;
  });
  console.info("[iot-pms] adopted the existing database as the Drizzle baseline");
}

export async function openPostgres(url: string): Promise<Db> {
  const client = postgres(url, { max: 5, onnotice: () => {} });
  await adoptLegacySchema(client);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

let shared: Promise<Db> | undefined;

export function getDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (!url) return Promise.reject(new Error("DATABASE_URL is not set (see db/README.md)"));
  shared ??= openPostgres(url);
  return shared;
}

/** Postgres unique violation (23505). Drizzle wraps driver errors, so the cause is checked too. */
export const isUniqueViolation = (error: unknown) =>
  [error, (error as { cause?: unknown })?.cause].some((e) => (e as { code?: string })?.code === "23505");

/** Dates leave the storage layer as ISO strings (the shape the views were written for). */
export const iso = (d: Date | null | undefined): string | undefined => (d ? d.toISOString() : undefined);
