import "server-only";

import bcrypt from "bcryptjs";

import { LoginRateLimiter } from "../auth-policy";
import { getAuthConfig } from "../config";
import type { Db } from "../storage/db";
import { audit, findUserById, verifyPassword } from "../users";

// Step-up confirmation (plans F4b, G1): risky jobs need a reason and the person's own password each time, so an
// unattended open session cannot run them. Shared by lock/unlock, experiments and job 15.

export const REASON_MIN = 10;

/**
 * Wrong step-up passwords are limited like logins (5 per 15 min per person), so an open session cannot be used to
 * guess the password (F6 follow-up review). ponytail: in memory, per process, like the login limiter.
 */
export const stepUpLimiter = new LoginRateLimiter();

export interface Confirmation {
  reason: string;
  password: string;
}

/** Re-checks the signed-in person's own password (the break-glass .env account has no database row). */
export async function confirmPassword(uid: number | undefined, password: string, db?: Db): Promise<boolean> {
  if (!password) return false;
  if (uid) {
    const user = await findUserById(uid, db);
    return Boolean(user && (await verifyPassword(user.username, password, db)));
  }
  const fallback = getAuthConfig().fallback;
  return Boolean(fallback && (await bcrypt.compare(password, fallback.passwordHash)));
}

/** Refusal text, or undefined when the reason and password are fine. A wrong password is audited. */
export async function checkConfirmation(
  confirm: Confirmation | undefined,
  who: { uid?: number; actor: string },
  what: { action: string; deviceRef: string },
  db?: Db,
): Promise<string | undefined> {
  const reason = confirm?.reason?.trim() ?? "";
  if (reason.length < REASON_MIN || reason.length > 200) return `Give a reason (${REASON_MIN}–200 characters)`;
  const key = `step-up|${who.uid ?? who.actor}`;
  if (stepUpLimiter.isBlocked(key)) {
    await audit(who.actor, `${what.action}_refused`, what.deviceRef, "too many wrong passwords", db);
    return "Too many wrong passwords. Wait 15 minutes, or sign out and in again later.";
  }
  if (!(await confirmPassword(who.uid, confirm?.password ?? "", db))) {
    stepUpLimiter.recordFailure(key);
    await audit(who.actor, `${what.action}_refused`, what.deviceRef, "wrong password", db);
    return "Password is not correct";
  }
  stepUpLimiter.reset(key);
  return undefined;
}
