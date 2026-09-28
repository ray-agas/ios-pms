// Shows the latest stored igloohome webhook events (already sanitized: PINs are fingerprints).
// Usage: bun run events [limit]      — device IDs are shown redacted.
import { redactDeviceId } from "@/server/igloohome/redaction";
import { desc } from "drizzle-orm";

import { eventOf } from "@/server/igloohome/webhooks";
import { getDb } from "@/server/storage/db";
import { webhookEvents } from "@/server/storage/schema";

const TYPES: Record<number, string> = { 3: "job complete", 5: "activity log", 10: "bridge connection" };
const limit = Number(process.argv[2] ?? 20);

const db = await getDb();
const rows = await db.select().from(webhookEvents).orderBy(desc(webhookEvents.id)).limit(limit);
if (rows.length === 0) console.log("No webhook events stored yet.");

for (const row of rows) {
  const device = row.productId ? redactDeviceId(row.productId) : "-";
  const bridge = row.bridgeId ? redactDeviceId(row.bridgeId) : "-";
  const type = TYPES[row.eventType ?? -1] ?? `type ${row.eventType}`;
  console.log(`#${row.id} ${row.receivedAt.toISOString()} ${type} device=${device} bridge=${bridge} signature=${row.verification}`);
  const data = eventOf(row.body)?.data;
  if (data) console.log("   data:", row.productId ? JSON.stringify(data).replaceAll(row.productId, device) : JSON.stringify(data));
}

// Postgres keeps a connection pool open; exit explicitly (SQLite did not need this).
process.exit(0);
