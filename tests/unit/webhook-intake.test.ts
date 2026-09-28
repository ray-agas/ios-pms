import { beforeEach, describe, expect, test } from "bun:test";

import { createHmac, generateKeyPairSync, sign } from "node:crypto";

import { asc } from "drizzle-orm";

import type { Db } from "@/server/storage/db";
import { webhookEvents } from "@/server/storage/schema";

import { ConfigError, parseWebhookConfig, type WebhookConfig } from "@/server/config";
import { pinFingerprint, readEnvelope, signedString, verifySignature } from "@/server/igloohome/webhooks";
import { openTestDb } from "../helpers/db";
import { receiveWebhook, type IncomingWebhook } from "@/server/webhook-intake";

// Synthetic events shaped like docs.igloohome.co/home/webhooks-bridge-event. Keys generated per test run.

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PUBLIC_KEY_B64 = publicKey.export({ format: "der", type: "pkcs1" }).toString("base64");
const SECRET = "s".repeat(40);

/** Signs exactly the way the vendor's validation example expects to verify. */
function vendorSign(req: Pick<IncomingWebhook, "method" | "path" | "contentType" | "date" | "rawBody">, host: string) {
  const keyBytes = Buffer.from(PUBLIC_KEY_B64, "base64");
  const payload = signedString(req.method, host, req.path, req.contentType ?? "", req.date ?? "", req.rawBody);
  const digest = createHmac("sha256", keyBytes).update(payload, "ascii").digest();
  return sign("sha256", digest, privateKey).toString("base64");
}

const activityEvent = {
  payload: {
    event: {
      id: "evt-1",
      type: 5,
      date: "2026-09-26T01:02:03Z",
      proxyTransportMethod: 2,
      accessoryId: "EB1X01bridge",
      data: {
        activityLogs: [
          { logType: 22, entryDate: 1790000000, keyId: 0, operationId: 0, pin: "4642226" },
          { logType: 16, entryDate: 1790000100, keyId: 0, operationId: 0, pin: "111111" },
        ],
      },
    },
    product: { id: "IGB401lock01", type: 1 },
  },
};

function request(body: unknown, overrides: Partial<IncomingWebhook> = {}): IncomingWebhook {
  const base: IncomingWebhook = {
    method: "POST",
    host: "localhost:3000",
    forwardedHost: "iot-webhooks.example.com",
    path: "/api/webhooks/igloohome",
    contentType: "application/json",
    date: "Sat, 26 Sep 2026 01:02:04 GMT",
    signature: null,
    rawBody: JSON.stringify(body),
    ...overrides,
  };
  return base;
}

let db: Db;
let config: WebhookConfig;

beforeEach(async () => {
  db = await openTestDb();
  config = parseWebhookConfig({ AUTH_SECRET: SECRET, IGLOOHOME_WEBHOOK_PUBLIC_KEY: PUBLIC_KEY_B64 });
});

const rows = () => db.select().from(webhookEvents).orderBy(asc(webhookEvents.id));

describe("signature (vendor scheme)", () => {
  test("valid when signed over the public (forwarded) host", () => {
    const req = request(activityEvent);
    const signature = vendorSign(req, "iot-webhooks.example.com");
    const result = verifySignature({
      ...req,
      hostCandidates: [req.forwardedHost!, req.host!],
      contentType: req.contentType!,
      date: req.date!,
      signatureHeader: `"${signature}"`, // quoted like the docs example
      publicKeyBase64: PUBLIC_KEY_B64,
    });
    expect(result).toEqual({ verification: "valid", matchedHost: "iot-webhooks.example.com" });
  });

  test("invalid when the body was changed", () => {
    const req = request(activityEvent);
    const signature = vendorSign(req, "iot-webhooks.example.com");
    const result = verifySignature({
      ...req,
      rawBody: req.rawBody.replace("4642226", "0000000"),
      hostCandidates: [req.forwardedHost!],
      contentType: req.contentType!,
      date: req.date!,
      signatureHeader: signature,
      publicKeyBase64: PUBLIC_KEY_B64,
    });
    expect(result.verification).toBe("invalid");
  });

  test("no key / no signature are reported, not guessed", () => {
    const base = { method: "POST", hostCandidates: ["h"], path: "/p", contentType: "", date: "", rawBody: "{}" };
    expect(verifySignature({ ...base, signatureHeader: "x" }).verification).toBe("no_key"); // signed, key missing
    expect(verifySignature({ ...base, signatureHeader: null }).verification).toBe("no_signature"); // not signed at all
    expect(verifySignature({ ...base, signatureHeader: null, publicKeyBase64: PUBLIC_KEY_B64 }).verification).toBe(
      "no_signature",
    );
  });
});

describe("intake", () => {
  test("stores a signed activity event with PINs replaced by fingerprints", async () => {
    const req = request(activityEvent);
    const result = await receiveWebhook({ ...req, signature: vendorSign(req, "iot-webhooks.example.com") }, { db, config });
    expect(result).toEqual({ status: 200, body: { ok: true, duplicate: false, verification: "valid" } });

    const [row] = await rows();
    expect(row).toMatchObject({
      eventId: "evt-1",
      eventType: 5,
      productId: "IGB401lock01",
      bridgeId: "EB1X01bridge",
      verification: "valid",
    });
    expect(typeof row.body).toBe("object"); // a jsonb object, not a JSON string
    const stored = JSON.stringify(row.body);
    expect(stored).not.toContain("4642226");
    expect(stored).not.toContain("111111");
    expect(stored).toContain(pinFingerprint("4642226", config.fingerprintKey));
  });

  test("duplicate deliveries are stored once", async () => {
    const req = request(activityEvent);
    await receiveWebhook(req, { db, config });
    const second = await receiveWebhook(req, { db, config });
    expect(second.body.duplicate).toBe(true);
    expect(await rows()).toHaveLength(1);
  });

  test("events without an id are de-duplicated by body hash", async () => {
    const noId = { event: { type: 10, data: { isOnline: true } }, product: { id: "EB1X01bridge", type: 1 } };
    await receiveWebhook(request(noId), { db, config });
    await receiveWebhook(request(noId), { db, config });
    expect(await rows()).toHaveLength(1);
  });

  test("unsigned events are kept but marked, unless signatures are required", async () => {
    const result = await receiveWebhook(request(activityEvent), { db, config });
    expect(result.body.verification).toBe("no_signature");
    expect((await rows())[0].verification).toBe("no_signature");

    const strict = { ...config, requireValidSignature: true };
    const rejected = await receiveWebhook(request({ ...activityEvent, payload: { ...activityEvent.payload, event: { ...activityEvent.payload.event, id: "evt-2" } } }), { db, config: strict });
    expect(rejected.status).toBe(401);
    expect(await rows()).toHaveLength(1);
  });

  test("rejects non-JSON and oversized bodies", async () => {
    expect((await receiveWebhook(request({}, { rawBody: "not json" }), { db, config })).status).toBe(400);
    expect((await receiveWebhook(request({}, { rawBody: "x".repeat(config.maxBodyBytes + 1) }), { db, config })).status).toBe(413);
    expect(await rows()).toHaveLength(0);
  });
});

describe("envelope and config", () => {
  test("reads both documented envelope shapes and both Bridge id field names", () => {
    expect(readEnvelope(activityEvent)).toMatchObject({ eventId: "evt-1", eventType: 5, bridgeId: "EB1X01bridge" });
    expect(
      readEnvelope({ event: { id: "e", type: 3, proxyId: "EB1X02" }, product: { id: "IGB4x", type: 1 } }),
    ).toMatchObject({ eventType: 3, bridgeId: "EB1X02", productId: "IGB4x" });
  });

  test("fingerprints are stable per key and differ across keys", () => {
    expect(pinFingerprint("1234", "a")).toBe(pinFingerprint("1234", "a"));
    expect(pinFingerprint("1234", "a")).not.toBe(pinFingerprint("1234", "b"));
  });

  test("config validates the public key and the strict flag", () => {
    expect(() => parseWebhookConfig({ AUTH_SECRET: SECRET, IGLOOHOME_WEBHOOK_PUBLIC_KEY: "bm90LWEta2V5" })).toThrow(
      ConfigError,
    );
    expect(() => parseWebhookConfig({ AUTH_SECRET: SECRET, IGLOOHOME_WEBHOOK_REQUIRE_VALID_SIGNATURE: "true" })).toThrow(
      "needs IGLOOHOME_WEBHOOK_PUBLIC_KEY",
    );
    expect(parseWebhookConfig({ AUTH_SECRET: SECRET }).publicKeyBase64).toBeUndefined();
  });
});
