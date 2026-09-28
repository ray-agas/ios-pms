import "server-only";

import type { Db } from "./storage/db";
import { webhookEvents } from "./storage/schema";

import type { WebhookConfig } from "./config";
import { readEnvelope, sanitizeWebhookBody, sha256, verifySignature, type Verification } from "./igloohome/webhooks";

// Store first, process later: igloohome's retry policy is undocumented, so an event we fail to store may be gone
// (activity logs are deleted from the lock once the Bridge has read them). Duplicates are dropped by event id.

export interface IncomingWebhook {
  method: string;
  host: string | null;
  forwardedHost: string | null;
  path: string;
  contentType: string | null;
  date: string | null;
  signature: string | null;
  rawBody: string;
}

export interface IntakeResult {
  status: number;
  body: { ok: boolean; duplicate?: boolean; verification?: Verification; error?: string };
}

export async function receiveWebhook(
  input: IncomingWebhook,
  deps: { db: Db; config: WebhookConfig; now?: () => Date },
): Promise<IntakeResult> {
  const { config, db } = deps;

  if (Buffer.byteLength(input.rawBody, "utf8") > config.maxBodyBytes) {
    return { status: 413, body: { ok: false, error: "payload too large" } };
  }

  const { verification } = verifySignature({
    method: input.method,
    hostCandidates: [input.forwardedHost ?? "", input.host ?? ""],
    path: input.path,
    contentType: input.contentType ?? "",
    date: input.date ?? "",
    rawBody: input.rawBody,
    signatureHeader: input.signature,
    publicKeyBase64: config.publicKeyBase64,
  });

  if (config.requireValidSignature && verification !== "valid") {
    return { status: 401, body: { ok: false, verification, error: "invalid signature" } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: { ok: false, verification, error: "body is not JSON" } };
  }

  const envelope = readEnvelope(parsed);
  const dedupeKey = envelope.eventId ? `event:${envelope.eventId}` : `sha256:${sha256(input.rawBody)}`;
  const inserted = await db
    .insert(webhookEvents)
    .values({
      receivedAt: (deps.now ?? (() => new Date()))(),
      dedupeKey,
      eventId: envelope.eventId ?? null,
      eventType: envelope.eventType ?? null,
      eventDate: envelope.eventDate ?? null,
      productId: envelope.productId ?? null,
      productType: envelope.productType ?? null,
      bridgeId: envelope.bridgeId ?? null,
      verification,
      body: sanitizeWebhookBody(parsed, config.fingerprintKey) as Record<string, unknown>,
    })
    .onConflictDoNothing({ target: webhookEvents.dedupeKey })
    .returning({ id: webhookEvents.id });

  return { status: 200, body: { ok: true, duplicate: inserted.length === 0, verification } };
}
