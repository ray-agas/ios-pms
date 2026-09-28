import { beforeAll, describe, expect, test } from "bun:test";

import bcrypt from "bcryptjs";

import {
  LoginRateLimiter,
  isGoogleSignInAllowed,
  roleForGoogleEmail,
  verifyFallbackLogin,
} from "@/server/auth-policy";
import { ConfigError, parseAuthConfig, parseIgloohomeConfig, parseScopes, type AuthConfig } from "@/server/config";

const SECRET = "x".repeat(40);
let hashB64 = "";

beforeAll(async () => {
  hashB64 = Buffer.from(await bcrypt.hash("correct horse battery", 4)).toString("base64");
});

const fallbackEnv = () => ({ AUTH_SECRET: SECRET, AUTH_FALLBACK_USERNAME: "ops", AUTH_FALLBACK_PASSWORD_HASH_B64: hashB64 });

describe("auth config", () => {
  test("requires a strong AUTH_SECRET", () => {
    expect(() => parseAuthConfig({ ...fallbackEnv(), AUTH_SECRET: "short" })).toThrow(ConfigError);
  });

  test("requires at least one login method", () => {
    expect(() => parseAuthConfig({ AUTH_SECRET: SECRET })).toThrow("No login method");
  });

  test("fallback: decodes the base64 bcrypt hash; the .env account is always super-admin (F2, Q7)", () => {
    const config = parseAuthConfig(fallbackEnv());
    expect(config.fallback?.passwordHash.startsWith("$2")).toBe(true);
    expect(config.fallback?.role).toBe("super_admin");
    expect(config.google).toBeUndefined();
  });

  test("fallback: rejects a value that is not a base64 bcrypt hash", () => {
    expect(() => parseAuthConfig({ ...fallbackEnv(), AUTH_FALLBACK_PASSWORD_HASH_B64: "plain-password" })).toThrow(
      "bcrypt",
    );
  });

  test("fallback: username and hash must come together", () => {
    expect(() => parseAuthConfig({ AUTH_SECRET: SECRET, AUTH_FALLBACK_USERNAME: "ops" })).toThrow(ConfigError);
  });

  test("google: needs both id and secret plus a domain", () => {
    expect(() => parseAuthConfig({ AUTH_SECRET: SECRET, AUTH_GOOGLE_ID: "id" })).toThrow(ConfigError);
    const config = parseAuthConfig({
      AUTH_SECRET: SECRET,
      AUTH_GOOGLE_ID: "id",
      AUTH_GOOGLE_SECRET: "secret",
      AUTH_ALLOWED_EMAIL_DOMAIN: "Bobobox.com",
    });
    expect(config.google?.allowedDomain).toBe("bobobox.com");
  });
});

describe("igloohome config", () => {
  const base = {
    IGLOOHOME_SCOPES: "igloohomeapi/get-devices igloohomeapi/get-properties",
    IGLOOHOME_API_BASE_URL: "https://api.igloodeveloper.co/igloohome",
    IGLOOHOME_AUTH_TOKEN_URL: "https://auth.igloohome.co/oauth2/token",
  };

  test("empty scopes are refused (empty would grant ALL)", () => {
    expect(() => parseScopes({ IGLOOHOME_SCOPES: "  " })).toThrow("explicit scopes");
  });

  test("no credentials yet → undefined, not an error", () => {
    expect(parseIgloohomeConfig(base)).toBeUndefined();
  });

  test("parses a full config with safe defaults", () => {
    const config = parseIgloohomeConfig({ ...base, IGLOOHOME_CLIENT_ID: "id", IGLOOHOME_CLIENT_SECRET: "secret" });
    expect(config?.scopes).toEqual(["igloohomeapi/get-devices", "igloohomeapi/get-properties"]);
    expect(config?.enableBridgeJobs).toBe(false);
    expect(config?.allowedDeviceIds).toEqual([]);
    expect(config?.timeoutMs).toBe(15000);
  });

  test("rejects non-https URLs and half-set credentials", () => {
    expect(() =>
      parseIgloohomeConfig({
        ...base,
        IGLOOHOME_API_BASE_URL: "http://api.example.com",
        IGLOOHOME_CLIENT_ID: "id",
        IGLOOHOME_CLIENT_SECRET: "s",
      }),
    ).toThrow("https");
    expect(() => parseIgloohomeConfig({ ...base, IGLOOHOME_CLIENT_ID: "id" })).toThrow(ConfigError);
  });
});

describe("login policy", () => {
  const googleConfig: AuthConfig = {
    secret: SECRET,
    google: { clientId: "id", clientSecret: "s", allowedDomain: "bobobox.com" },
    allowedEmails: [],
    operatorEmails: ["lead@bobobox.com"],
  };

  test("google: only verified emails in the allowed domain", () => {
    expect(isGoogleSignInAllowed({ email: "a@bobobox.com", email_verified: true }, googleConfig)).toBe(true);
    expect(isGoogleSignInAllowed({ email: "a@bobobox.com", email_verified: false }, googleConfig)).toBe(false);
    expect(isGoogleSignInAllowed({ email: "a@gmail.com", email_verified: true }, googleConfig)).toBe(false);
    expect(isGoogleSignInAllowed({ email: "a@evilbobobox.com", email_verified: true }, googleConfig)).toBe(false);
  });

  test("google: optional allowlist narrows the domain", () => {
    const narrowed = { ...googleConfig, allowedEmails: ["b@bobobox.com"] };
    expect(isGoogleSignInAllowed({ email: "a@bobobox.com", email_verified: true }, narrowed)).toBe(false);
    expect(isGoogleSignInAllowed({ email: "B@bobobox.com", email_verified: true }, narrowed)).toBe(true);
  });

  test("google: viewer unless listed as operator", () => {
    expect(roleForGoogleEmail("someone@bobobox.com", googleConfig)).toBe("viewer");
    expect(roleForGoogleEmail("Lead@bobobox.com", googleConfig)).toBe("operator");
  });

  test("fallback: accepts only the right username and password", async () => {
    const config = parseAuthConfig(fallbackEnv());
    const limiter = new LoginRateLimiter();
    expect(await verifyFallbackLogin("ops", "correct horse battery", config, limiter, "ip")).toEqual({
      username: "ops",
      role: "super_admin",
    });
    expect(await verifyFallbackLogin("ops", "wrong", config, limiter, "ip")).toBeNull();
    expect(await verifyFallbackLogin("other", "correct horse battery", config, limiter, "ip")).toBeNull();
  });

  test("fallback: locks out after repeated failures, even with the right password", async () => {
    const config = parseAuthConfig(fallbackEnv());
    const limiter = new LoginRateLimiter(3, 60_000);
    for (let i = 0; i < 3; i++) await verifyFallbackLogin("ops", "wrong", config, limiter, "ip");
    expect(await verifyFallbackLogin("ops", "correct horse battery", config, limiter, "ip")).toBeNull();
    // A different client is not affected.
    expect(await verifyFallbackLogin("ops", "correct horse battery", config, limiter, "other-ip")).not.toBeNull();
  });

  test("rate limiter window expires", () => {
    let now = 0;
    const limiter = new LoginRateLimiter(1, 1000, () => now);
    limiter.recordFailure("k");
    expect(limiter.isBlocked("k")).toBe(true);
    now = 2000;
    expect(limiter.isBlocked("k")).toBe(false);
  });
});
