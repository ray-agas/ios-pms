import "server-only";

import { and, asc, eq, inArray, or, sql } from "drizzle-orm";

import type { Db } from "./db";
import { webhookEvents } from "./schema";

// Webhook-event lookups shared by jobs and access codes. jsonb paths cover both envelope shapes (with/without payload).

const jobIdOf = sql<string>`coalesce(${webhookEvents.body}->'payload'->'event'->'data'->>'jobId', ${webhookEvents.body}->'event'->'data'->>'jobId')`;

/** Provider job ids (of those given) that already have a job-complete event (type 3). */
export async function completedJobIds(db: Db, providerJobIds: string[]): Promise<Set<string>> {
  if (providerJobIds.length === 0) return new Set();
  const rows = await db
    .select({ jobId: jobIdOf })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.eventType, 3), inArray(jobIdOf, providerJobIds)));
  return new Set(rows.map((r) => r.jobId));
}

/** First job-complete event (type 3) for a provider job id. */
export async function jobCompleteEvent(db: Db, providerJobId: string) {
  const [row] = await db
    .select()
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.eventType, 3),
        or(
          sql`(${webhookEvents.body}->'payload'->'event'->'data'->>'jobId') = ${providerJobId}`,
          sql`(${webhookEvents.body}->'event'->'data'->>'jobId') = ${providerJobId}`,
        ),
      ),
    )
    .orderBy(asc(webhookEvents.id))
    .limit(1);
  return row;
}
