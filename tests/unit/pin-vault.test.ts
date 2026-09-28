import { beforeAll, describe, expect, test } from "bun:test";

import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import { decryptPin, encryptPin, parsePinKey } from "@/server/crypto/pin-cipher";
import { markRevoking, revealPin, storePin } from "@/server/application/pin-vault";
import { pins, providerJobs } from "@/server/storage/schema";
import { listAudit } from "@/server/users";

import { openTestDb } from "../helpers/db";

// PIN vault (plan F4): encryption, storage, reveal audit, revoke linking. Synthetic PINs and device IDs only.

const LOCK = "IGB401lock01";
const OTHER = "IGB401lock02";

beforeAll(() => {
  process.env.AUTH_SECRET ??= "s".repeat(40); // webhook fingerprint key derives from it
  process.env.IOT_PMS_PIN_KEY = randomBytes(32).toString("base64");
});

describe("PIN cipher", () => {
  const key = randomBytes(32);

  test("round trip; every ciphertext is different", () => {
    const a = encryptPin("482913", LOCK, key);
    const b = encryptPin("482913", LOCK, key);
    expect(a).not.toBe(b);
    expect(a).not.toContain("482913");
    expect(decryptPin(a, LOCK, key)).toBe("482913");
  });

  test("a wrong key, another device, or tampering fails", () => {
    const stored = encryptPin("482913", LOCK, key);
    expect(() => decryptPin(stored, LOCK, randomBytes(32))).toThrow();
    expect(() => decryptPin(stored, OTHER, key)).toThrow(); // device bound as additional data
    const [v, iv, tag, ct] = stored.split(".");
    const flipped = Buffer.from(ct, "base64url");
    flipped[0] ^= 1;
    expect(() => decryptPin([v, iv, tag, flipped.toString("base64url")].join("."), LOCK, key)).toThrow();
  });

  test("the key must be exactly 32 bytes", () => {
    expect(parsePinKey(undefined)).toBeUndefined();
    expect(() => parsePinKey(randomBytes(16).toString("base64"))).toThrow("32 bytes");
    expect(parsePinKey(randomBytes(32).toString("base64"))?.length).toBe(32);
  });
});

describe("vault storage", () => {
  test("stores encrypted, reveals with an audit row, and links a later delete by PIN", async () => {
    const db = await openTestDb();
    const id = await storePin({ deviceId: LOCK, kind: "custom", pinType: "2", pin: "482913", accessName: "Housekeeping", actor: "ops" }, db);
    expect(id).toBeNumber();
    const [row] = await db.select().from(pins).where(eq(pins.id, id!));
    expect(row.ciphertext).not.toContain("482913");

    expect(await revealPin(id!, "root", db)).toEqual({ ok: true, pin: "482913" });
    expect((await listAudit(5, db))[0]).toMatchObject({ actor: "root", action: "pin.reveal", target: "IGB4••••••01" });
    expect(JSON.stringify(await listAudit(5, db))).not.toContain("482913");

    // Same PIN on another lock and a different PIN on this lock are not touched.
    const other = await storePin({ deviceId: OTHER, kind: "custom", pinType: "2", pin: "482913", actor: "ops" }, db);
    const job = async () =>
      (await db.insert(providerJobs).values({ createdAt: new Date(), actor: "root", kind: "pin_delete", jobType: 5, deviceId: LOCK, bridgeId: "EB1X01bridge", state: "queued" }).returning({ id: providerJobs.id }))[0].id;
    await markRevoking(LOCK, "000000", await job(), "root", db);
    const deleteJob = await job();
    await markRevoking(LOCK, "482913", deleteJob, "root", db);
    const rows = await db.select().from(pins);
    expect(rows.find((r) => r.id === id)?.revokeJobId).toBe(deleteJob);
    expect(rows.find((r) => r.id === other)?.revokeJobId).toBeNull();
  });
});
