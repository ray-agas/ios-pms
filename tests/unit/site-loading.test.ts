import { describe, expect, test } from "bun:test";

import { liveDetails } from "@/server/application/dashboard";
import type { IgloohomeClient } from "@/server/igloohome/client";
import { deviceState, webhookEvents } from "@/server/storage/schema";

import { openTestDb } from "../helpers/db";

// Plan F7b: live detail only for the devices asked for, reused for 30 s unless the device sent an event since,
// and every fresh result kept as the last-known state.

function fakeClient() {
  const calls: string[] = [];
  const api = {
    getDevice: async (id: string) => {
      calls.push(id);
      return { deviceId: id, type: "Lock", batteryLevel: 55, lockStatus: "LOCKED", lastSync: "2026-09-27T01:00:00Z", linkedDevices: [] };
    },
  } as unknown as IgloohomeClient;
  return { api, calls };
}

describe("live detail for watched devices", () => {
  test("fetches only the given devices, reuses the result, and refetches after a new event", async () => {
    const db = await openTestDb();
    const { api, calls } = fakeClient();

    expect((await liveDetails(api, [], db)).size).toBe(0);
    expect(calls).toEqual([]);

    await liveDetails(api, ["IGB401lockA1", "IGB401lockB1"], db);
    expect(calls.sort()).toEqual(["IGB401lockA1", "IGB401lockB1"]);
    const stored = await db.select().from(deviceState);
    expect(stored.find((r) => r.deviceId === "IGB401lockA1")).toMatchObject({ battery: 55, lockState: "locked", lastSyncAt: "2026-09-27T01:00:00Z" });

    await liveDetails(api, ["IGB401lockA1"], db);
    expect(calls).toHaveLength(2); // cached

    await new Promise((r) => setTimeout(r, 5));
    await db.insert(webhookEvents).values({ receivedAt: new Date(), dedupeKey: "e1", eventType: 5, productId: "IGB401lockA1", verification: "no_key", body: {} });
    await liveDetails(api, ["IGB401lockA1", "IGB401lockB1"], db);
    expect(calls.filter((c) => c === "IGB401lockA1")).toHaveLength(2); // the lock moved: fetch again
    expect(calls.filter((c) => c === "IGB401lockB1")).toHaveLength(1); // no event: still cached
  });
});
