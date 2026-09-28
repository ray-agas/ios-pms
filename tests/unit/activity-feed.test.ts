import { describe, expect, test } from "bun:test";

import { getActivityFeed } from "@/server/application/dashboard";
import { parseWebhookConfig } from "@/server/config";
import { openTestDb } from "../helpers/db";
import { receiveWebhook } from "@/server/webhook-intake";

// The feed is sent to the browser (Activity page, /api/activity), so it must carry display IDs only.

const LOCK = "IGB401lock01";
const BRIDGE = "EB1X01bridge";

const event = (id: string, logs: { logType: number; entryDate: number; pin?: string }[]) => ({
  payload: {
    event: { id, type: 5, date: "2026-09-26T01:02:03Z", accessoryId: BRIDGE, data: { activityLogs: logs } },
    product: { id: LOCK, type: 1 },
  },
});

async function seed() {
  const db = await openTestDb();
  const config = parseWebhookConfig({ AUTH_SECRET: "s".repeat(40) });
  for (const body of [
    event("e1", [
      { logType: 19, entryDate: 1790000000, pin: "4642226" },
      { logType: 13, entryDate: 1790000001 },
    ]),
    event("e2", [{ logType: 16, entryDate: 1790000100, pin: "111111" }]),
  ]) {
    await receiveWebhook(
      { method: "POST", host: "localhost:3000", forwardedHost: null, path: "/api/webhooks/igloohome", contentType: "application/json", date: null, signature: null, rawBody: JSON.stringify(body) },
      { db, config, now: () => new Date("2026-09-26T01:02:04Z") },
    );
  }
  return db;
}

describe("activity feed", () => {
  test("never exposes full device IDs or PINs", async () => {
    const feed = await getActivityFeed({ includeSystem: true }, await seed());
    const json = JSON.stringify(feed);
    expect(json).not.toContain(LOCK);
    expect(json).not.toContain(BRIDGE);
    expect(json).not.toContain("4642226");
    expect(feed.items[0].deviceDisplay).toBe("IGB4••••••01");
  });

  test("hides clock syncs by default, newest first, and pages by row id", async () => {
    const db = await seed();
    const feed = await getActivityFeed({}, db);
    expect(feed.items.map((i) => i.logType)).toEqual([16, 19]);
    expect(feed.hiddenSystem).toBe(1);
    expect(feed.items[1].pinFingerprint).toBeString();

    const after = await getActivityFeed({ afterRowId: feed.lastRowId }, db);
    expect(after.items).toEqual([]);
    expect(after.lastRowId).toBe(feed.lastRowId);
  });

  test("a log re-sent after a Bridge reconnect (new event id) shows once (EXP-20260926-03)", async () => {
    const db = await seed();
    const again = event("e1-resent", [{ logType: 19, entryDate: 1790000000, pin: "4642226" }]);
    await receiveWebhook(
      { method: "POST", host: "localhost:3000", forwardedHost: null, path: "/api/webhooks/igloohome", contentType: "application/json", date: null, signature: null, rawBody: JSON.stringify(again) },
      { db, config: parseWebhookConfig({ AUTH_SECRET: "s".repeat(40) }), now: () => new Date("2026-09-26T01:05:00Z") },
    );
    const feed = await getActivityFeed({}, db);
    expect(feed.items.filter((i) => i.logType === 19)).toHaveLength(1);
  });
});
