import "server-only";

import { createHash, createHmac, createPublicKey, verify } from "node:crypto";

import { redact } from "./redaction";

// igloohome webhooks (docs.igloohome.co/home/webhook-security, webhooks-bridge-event).
// The signature scheme is unusual (HMAC keyed with the PUBLIC key, then RSA verify of the HMAC digest).
// It is implemented exactly like the vendor's Node example and must be proven on a real event before trusting it.

export type Verification = "valid" | "invalid" | "no_key" | "no_signature" | "error";

export interface SignatureInput {
  method: string;
  hostCandidates: string[]; // Host header and x-forwarded-host: behind a tunnel either may be the one igloohome signed
  path: string;
  contentType: string;
  date: string;
  rawBody: string;
  signatureHeader: string | null;
  publicKeyBase64?: string;
}

export function signedString(method: string, host: string, path: string, contentType: string, date: string, body: string) {
  return [method.toUpperCase(), host, path, contentType, date, body].join("|");
}

export function verifySignature(input: SignatureInput): { verification: Verification; matchedHost?: string } {
  // Check the header first: "no_key" then means igloohome DID sign, we just cannot check it yet.
  const signatureText = input.signatureHeader?.trim().replace(/^"|"$/g, ""); // docs example shows it quoted
  if (!signatureText) return { verification: "no_signature" };
  if (!input.publicKeyBase64) return { verification: "no_key" };
  try {
    const keyBytes = Buffer.from(input.publicKeyBase64, "base64");
    const publicKey = createPublicKey({ key: keyBytes, format: "der", type: "pkcs1" });
    const signature = Buffer.from(signatureText, "base64");
    for (const host of [...new Set(input.hostCandidates.filter(Boolean))]) {
      const payload = signedString(input.method, host, input.path, input.contentType, input.date, input.rawBody);
      const digest = createHmac("sha256", keyBytes).update(payload, "ascii").digest();
      if (verify("sha256", digest, publicKey, signature)) return { verification: "valid", matchedHost: host };
    }
    return { verification: "invalid" };
  } catch {
    return { verification: "error" };
  }
}

// --- Envelope ---------------------------------------------------------------

export interface WebhookEnvelope {
  eventId?: string;
  eventType?: number;
  eventDate?: string;
  productId?: string;
  productType?: number;
  bridgeId?: string;
}

const str = (value: unknown) => (typeof value === "string" && value ? value : undefined);
const num = (value: unknown) => (typeof value === "number" ? value : undefined);

/** Docs show both `{payload:{event,product}}` and `{event,product}` (D9) — accept either. */
export function readEnvelope(body: unknown): WebhookEnvelope {
  const root = (body ?? {}) as Record<string, unknown>;
  const container = (root.payload && typeof root.payload === "object" ? root.payload : root) as Record<string, unknown>;
  const event = (container.event ?? {}) as Record<string, unknown>;
  const product = (container.product ?? {}) as Record<string, unknown>;
  return {
    eventId: str(event.id),
    eventType: num(event.type),
    eventDate: str(event.date),
    productId: str(product.id),
    productType: num(product.type),
    bridgeId: str(event.proxyId) ?? str(event.accessoryId), // D10: field name differs between docs pages
  };
}

// --- Sanitising ---------------------------------------------------------------

const PIN_KEYS = new Set(["pin", "newPin", "customPin"]);

/** Stable, non-reversible fingerprint so a PIN can later be matched to an issued credential without storing it. */
export function pinFingerprint(pin: string, key: string): string {
  return createHmac("sha256", key).update(`igloohome-pin:${pin}`).digest("hex").slice(0, 16);
}

function fingerprintPins(value: unknown, key: string): unknown {
  if (Array.isArray(value)) return value.map((item) => fingerprintPins(item, key));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [field, inner] of Object.entries(value)) {
      if (PIN_KEYS.has(field) && (typeof inner === "string" || typeof inner === "number")) {
        out[`${field}Fingerprint`] = pinFingerprint(String(inner), key);
      } else {
        out[field] = fingerprintPins(inner, key);
      }
    }
    return out;
  }
  return value;
}

/** What gets stored: PINs → fingerprints, any other secret-looking field redacted. The raw body is never stored. */
export function sanitizeWebhookBody(body: unknown, fingerprintKey: string): unknown {
  return redact(fingerprintPins(body, fingerprintKey));
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * The event inside a stored webhook body. igloohome sends two envelope shapes (with and without `payload`), and
 * event.data differs per type, so it is read loosely here, in one place.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function eventOf(body: unknown): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = body as any;
  return b?.payload?.event ?? b?.event ?? {};
}
