import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { recentJobs } from "@/server/application/health-check";
import { providerJobs, webhookEvents } from "@/server/storage/schema";

import { openTestDb } from "../helpers/db";

// E22 regression: a job whose job-complete webhook arrived must count as finished even if nobody polled it,
// otherwise the in-flight guard keeps the lock's buttons disabled.

describe("jobs settle from webhooks", () => {
  test("queued + job-complete webhook → completed (stored too); no webhook → still queued", async () => {
    const db = await openTestDb();
    const now = new Date();
    const job = (providerJobId: string) => ({ createdAt: now, actor: "root", kind: "remote_unlock", jobType: 2, deviceId: "IGB401lock01", bridgeId: "EB1X01bridge", state: "queued", providerJobId });
    const [done] = await db.insert(providerJobs).values(job("job-done")).returning();
    const [open] = await db.insert(providerJobs).values(job("job-open")).returning();
    await db.insert(webhookEvents).values({
      receivedAt: now,
      dedupeKey: "e1",
      eventType: 3,
      verification: "no_key",
      body: { payload: { event: { data: { jobId: "job-done", jobStatus: 0 } } } },
    });

    const jobs = await recentJobs(db, now);
    expect(jobs.find((j) => j.state === "completed")).toBeDefined();
    expect(jobs.filter((j) => j.state === "queued")).toHaveLength(1);
    expect((await db.select().from(providerJobs).where(eq(providerJobs.id, done.id)))[0]).toMatchObject({ state: "completed", completed: 1 });
    expect((await db.select().from(providerJobs).where(eq(providerJobs.id, open.id)))[0].state).toBe("queued");
  });
});
