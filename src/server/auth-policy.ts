import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import bcrypt from "bcryptjs";

import type { AuthConfig } from "./config";
import type { Role } from "./domain/models";

// Pure login rules, kept out of src/auth.ts so they can be unit-tested without Auth.js.

export function isGoogleSignInAllowed(
  profile: { email?: string | null; email_verified?: boolean | null },
  config: AuthConfig,
): boolean {
  if (!config.google || !profile.email || profile.email_verified !== true) return false;
  const email = profile.email.toLowerCase();
  if (!email.endsWith(`@${config.google.allowedDomain}`)) return false;
  return config.allowedEmails.length === 0 || config.allowedEmails.includes(email);
}

export function roleForGoogleEmail(email: string, config: AuthConfig): Role {
  return config.operatorEmails.includes(email.toLowerCase()) ? "operator" : "viewer";
}

/** In-memory limiter: N failures per window per key. Enough for one localhost/internal instance. */
export class LoginRateLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  isBlocked(key: string): boolean {
    return this.recent(key).length >= this.maxFailures;
  }

  recordFailure(key: string): void {
    this.failures.set(key, [...this.recent(key), this.now()]);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    return (this.failures.get(key) ?? []).filter((at) => at > cutoff);
  }
}

const digest = (value: string) => createHash("sha256").update(value).digest();

export async function verifyFallbackLogin(
  username: string,
  password: string,
  config: AuthConfig,
  limiter: LoginRateLimiter,
  clientKey: string,
): Promise<{ username: string; role: Role } | null> {
  const fallback = config.fallback;
  if (!fallback) return null;

  const key = `${clientKey}|${username.toLowerCase()}`;
  if (limiter.isBlocked(key)) return null;

  // Always run bcrypt, even for a wrong username, so timing does not reveal which part was wrong.
  const usernameOk = timingSafeEqual(digest(username), digest(fallback.username));
  const passwordOk = await bcrypt.compare(password, fallback.passwordHash);
  if (usernameOk && passwordOk) {
    limiter.reset(key);
    return { username: fallback.username, role: fallback.role };
  }
  limiter.recordFailure(key);
  return null;
}
