// One-time copy of the Slice 1 / M5 SQLite file (var/iot-pms.db) into Postgres (plan F1), so the experiment
// evidence is kept. Ids are preserved; re-running is safe (existing ids are skipped). The SQLite file is not changed.
import { createClient } from "@libsql/client";

import postgres from "postgres";

import { getDb } from "@/server/storage/db";

const path = process.env.SQLITE_IMPORT_PATH || "./var/iot-pms.db";
const sqlite = createClient({ url: `file:${path}` });
await getDb(); // runs migrations first
// Generic column copy, so raw postgres.js rather than the typed Drizzle tables.
const pg = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });

const TABLES: Record<string, { jsonb?: string[] }> = {
  webhook_events: { jsonb: ["body"] },
  api_calls: {},
  provider_jobs: {},
  access_codes: {},
};

for (const [table, opts] of Object.entries(TABLES)) {
  const exists = await sqlite.execute({ sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", args: [table] });
  if (!exists.rows.length) {
    console.log(`${table}: not in SQLite, skipped`);
    continue;
  }
  const { rows, columns } = await sqlite.execute(`SELECT * FROM ${table} ORDER BY id`);
  let copied = 0;
  for (const row of rows) {
    const values = columns.map((c) => row[c] ?? null);
    const placeholders = columns.map((c, i) => (opts.jsonb?.includes(c) ? `$${i + 1}::text::jsonb` : `$${i + 1}`)).join(", ");
    const r = await pg.unsafe(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`, values as never[]);
    copied += r.count;
  }
  // Identity columns do not advance on explicit ids: move them past the highest imported id.
  await pg.unsafe(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${table}), 1))`);
  const [{ n: total }] = await pg.unsafe(`SELECT COUNT(*)::int AS n FROM ${table}`);
  console.log(`${table}: sqlite ${rows.length} · copied ${copied} · postgres now ${total}`);
}
process.exit(0);
