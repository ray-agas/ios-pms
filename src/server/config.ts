import "server-only";

import { createHmac, createPublicKey } from "node:crypto";

import { z } from "zod";

import type { Role } from "./domain/models";
import { parsePinKey } from "./crypto/pin-cipher";

// Env validation (docs/architecture/environment-configuration.md). Parsing functions take an env record so they
// are testable; getters read process.env once. No value here may ever be exposed through NEXT_PUBLIC_.

type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const list = (value: string | undefined, separator: RegExp) =>
  (value ?? "")
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);


export interface AuthConfig {
  secret: string;
  google?: { clientId: string; clientSecret: string; allowedDomain: string };
  allowedEmails: string[];
  operatorEmails: string[];
  fallback?: { username: string; passwordHash: string; role: Role };
}

export function parseAuthConfig(env: Env): AuthConfig {
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
    throw new ConfigError("AUTH_SECRET is missing or shorter than 32 characters");
  }

  const googleId = env.AUTH_GOOGLE_ID?.trim();
  const googleSecret = env.AUTH_GOOGLE_SECRET?.trim();
  if (Boolean(googleId) !== Boolean(googleSecret)) {
    throw new ConfigError("Set both AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET, or neither");
  }
  const allowedDomain = (env.AUTH_ALLOWED_EMAIL_DOMAIN ?? "").trim().toLowerCase();
  if (googleId && !allowedDomain) throw new ConfigError("AUTH_ALLOWED_EMAIL_DOMAIN is required when Google login is on");

  const username = env.AUTH_FALLBACK_USERNAME?.trim();
  const hashB64 = env.AUTH_FALLBACK_PASSWORD_HASH_B64?.trim();
  if (Boolean(username) !== Boolean(hashB64)) {
    throw new ConfigError("Set both AUTH_FALLBACK_USERNAME and AUTH_FALLBACK_PASSWORD_HASH_B64, or neither");
  }
  let fallback: AuthConfig["fallback"];
  if (username && hashB64) {
    // Stored base64-encoded because Next.js expands `$VAR` in .env files and bcrypt hashes contain `$`.
    const passwordHash = Buffer.from(hashB64, "base64").toString("utf8");
    if (!/^\$2[aby]\$\d{2}\$.{53}$/.test(passwordHash)) {
      throw new ConfigError("AUTH_FALLBACK_PASSWORD_HASH_B64 is not a base64-encoded bcrypt hash");
    }
    // Plan F2 (Q7): the .env account is the bootstrap super-admin and the break-glass login. AUTH_FALLBACK_ROLE is ignored.
    fallback = { username, passwordHash, role: "super_admin" };
  }

  if (!googleId && !fallback) throw new ConfigError("No login method configured (Google or fallback)");

  return {
    secret: env.AUTH_SECRET,
    google: googleId && googleSecret ? { clientId: googleId, clientSecret: googleSecret, allowedDomain } : undefined,
    allowedEmails: list(env.AUTH_ALLOWED_EMAILS, /,/).map((email) => email.toLowerCase()),
    operatorEmails: list(env.AUTH_OPERATOR_EMAILS, /,/).map((email) => email.toLowerCase()),
    fallback,
  };
}

export interface IgloohomeConfig {
  apiBaseUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  timeoutMs: number;
  enableBridgeJobs: boolean;
  /** M5: creating algoPINs (R2, credentials on real locks). Off unless explicitly "true". */
  enableAlgoPin: boolean;
  /** M5: Bridge PIN jobs 4 (create custom PIN) and 5 (delete PIN). Off unless explicitly "true". */
  enablePinJobs: boolean;
  /** Plan F4b: emergency lock/unlock (jobs 1/2, R3, physical). Off unless explicitly "true". */
  enableRemoteLock: boolean;
  /** Plan G1: lets a super-admin send supported job types to devices the docs do not list for them (switch, keypad). */
  enableExperiments: boolean;
  /** Plan F7: read once, to seed the device registry; the registry is the allowlist afterwards. */
  allowedDeviceIds: string[];
}

/** Scopes must always be explicit: an empty scope list would grant every permission. */
export function parseScopes(env: Env): string[] {
  const scopes = list(env.IGLOOHOME_SCOPES, /\s+/);
  if (scopes.length === 0) throw new ConfigError("IGLOOHOME_SCOPES must list explicit scopes (empty means ALL)");
  return scopes;
}

const httpsUrl = z.url({ protocol: /^https$/ });

/** Returns undefined while credentials are not provided yet; throws on invalid values. */
export function parseIgloohomeConfig(env: Env): IgloohomeConfig | undefined {
  const scopes = parseScopes(env);
  const clientId = env.IGLOOHOME_CLIENT_ID?.trim();
  const clientSecret = env.IGLOOHOME_CLIENT_SECRET?.trim();
  if (!clientId && !clientSecret) return undefined;
  if (!clientId || !clientSecret) throw new ConfigError("Set both IGLOOHOME_CLIENT_ID and IGLOOHOME_CLIENT_SECRET");

  const apiBaseUrl = httpsUrl.safeParse(env.IGLOOHOME_API_BASE_URL);
  const tokenUrl = httpsUrl.safeParse(env.IGLOOHOME_AUTH_TOKEN_URL);
  if (!apiBaseUrl.success) throw new ConfigError("IGLOOHOME_API_BASE_URL must be an https URL");
  if (!tokenUrl.success) throw new ConfigError("IGLOOHOME_AUTH_TOKEN_URL must be an https URL");

  const timeoutMs = Number(env.IGLOOHOME_HTTP_TIMEOUT_MS ?? 15000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    throw new ConfigError("IGLOOHOME_HTTP_TIMEOUT_MS must be an integer between 1000 and 120000");
  }

  return {
    apiBaseUrl: apiBaseUrl.data,
    tokenUrl: tokenUrl.data,
    clientId,
    clientSecret,
    scopes,
    timeoutMs,
    enableBridgeJobs: env.IGLOOHOME_ENABLE_BRIDGE_JOBS?.trim().toLowerCase() === "true",
    enableAlgoPin: env.IGLOOHOME_ENABLE_ALGOPIN?.trim().toLowerCase() === "true",
    enablePinJobs: env.IGLOOHOME_ENABLE_PIN_JOBS?.trim().toLowerCase() === "true",
    enableRemoteLock: env.IGLOOHOME_ENABLE_REMOTE_LOCK?.trim().toLowerCase() === "true",
    enableExperiments: env.IGLOOHOME_ENABLE_EXPERIMENTS?.trim().toLowerCase() === "true",
    allowedDeviceIds: list(env.IGLOOHOME_ALLOWED_DEVICE_IDS, /,/),
  };
}

export interface WebhookConfig {
  publicKeyBase64?: string;
  requireValidSignature: boolean;
  /** Key for PIN fingerprints, derived from AUTH_SECRET (rotating AUTH_SECRET changes all fingerprints). */
  fingerprintKey: string;
  maxBodyBytes: number;
}

export function parseWebhookConfig(env: Env): WebhookConfig {
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) throw new ConfigError("AUTH_SECRET is required for webhook intake");
  const publicKeyBase64 = env.IGLOOHOME_WEBHOOK_PUBLIC_KEY?.trim() || undefined;
  if (publicKeyBase64) {
    try {
      createPublicKey({ key: Buffer.from(publicKeyBase64, "base64"), format: "der", type: "pkcs1" });
    } catch {
      throw new ConfigError("IGLOOHOME_WEBHOOK_PUBLIC_KEY is not a base64 RSA public key (DER, PKCS1)");
    }
  }
  const requireValidSignature = env.IGLOOHOME_WEBHOOK_REQUIRE_VALID_SIGNATURE?.trim().toLowerCase() === "true";
  if (requireValidSignature && !publicKeyBase64) {
    throw new ConfigError("IGLOOHOME_WEBHOOK_REQUIRE_VALID_SIGNATURE=true needs IGLOOHOME_WEBHOOK_PUBLIC_KEY");
  }
  return {
    publicKeyBase64,
    requireValidSignature,
    fingerprintKey: createHmac("sha256", env.AUTH_SECRET).update("iot-pms/pin-fingerprint/v1").digest("hex"),
    maxBodyBytes: 256 * 1024,
  };
}

let webhookConfig: WebhookConfig | undefined;

export function getWebhookConfig(): WebhookConfig {
  webhookConfig ??= parseWebhookConfig(process.env);
  return webhookConfig;
}

let authConfig: AuthConfig | undefined;
let igloohomeConfig: IgloohomeConfig | undefined | null;

export function getAuthConfig(): AuthConfig {
  authConfig ??= parseAuthConfig(process.env);
  return authConfig;
}

export function getIgloohomeConfig(): IgloohomeConfig | undefined {
  if (igloohomeConfig === undefined) igloohomeConfig = parseIgloohomeConfig(process.env) ?? null;
  return igloohomeConfig ?? undefined;
}

/** Plan F7b: how many cabins/rooms the Devices page watches live at once (default 3, 1–10). */
export function getMonitorMax(env: Env = process.env): number {
  const n = Number(env.IOT_PMS_MONITOR_MAX ?? 3);
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new ConfigError("IOT_PMS_MONITOR_MAX must be a whole number from 1 to 10");
  return n;
}

/** Plan F4: the PIN vault key; undefined = vault off (startup refuses that while PIN creation is enabled). */
export function getPinKey(env: Env = process.env): Buffer | undefined {
  return parsePinKey(env.IOT_PMS_PIN_KEY);
}
