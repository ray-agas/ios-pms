import "server-only";

import { and, desc, eq, gte, inArray } from "drizzle-orm";

import { getIgloohomeConfig } from "../config";
import { ProviderError } from "../igloohome/errors";
import { redactDeviceId } from "../igloohome/redaction";
import { getDb } from "../storage/db";
import { auditEvents, deviceState, managedDevices, providerJobs, spaces, webhookEvents } from "../storage/schema";
import { eventOf } from "../igloohome/webhooks";
import { LOG_TYPES } from "../igloohome/codes";
import { audit } from "../users";
import { igloohomeAs } from "./dashboard";
import { managedAllowlist } from "./device-registry";
import { loadTargets, recentJobs, type StartResult } from "./health-check";
import { checkHealthCheck, JOB_SCOPE } from "./safety";
import type { Caller } from "./scopes";
import { checkConfirmation } from "./step-up";

export { confirmPassword, REASON_MIN } from "./step-up";

// Emergency lock/unlock (plan F4b, R3, physical). Super-admin only, off unless IGLOOHOME_ENABLE_REMOTE_LOCK=true,
// a reason and the person's own password every time, at most 3 unlocks per lock per 10 minutes, never retried.
// The call uses a token that carries only the one physical scope it needs.

export type LockAction = "lock" | "unlock";
const KIND = { lock: "remote_lock", unlock: "remote_unlock" } as const;
export const UNLOCK_LIMIT = { count: 3, windowMs: 10 * 60_000 };

export interface LockOption {
  allowed: boolean;
  reason?: string;
  retryAt?: string; // when a temporary refusal (job in flight) ends
  experimental?: boolean; // G1: not documented for this device kind (switch, keypad)
}

/** Per lock display ID: may this caller lock / unlock it now, and if not, why. */
export async function remoteLockOptions(caller: Caller): Promise<Record<string, Record<LockAction, LockOption>>> {
  const config = getIgloohomeConfig();
  if (!config) return {};
  const now = new Date();
  const [targets, jobs, allowlist] = await Promise.all([loadTargets(), getDb().then((db) => recentJobs(db, now)), managedAllowlist()]);
  const out: Record<string, Record<LockAction, LockOption>> = {};
  // Locks, the switch (proven, G1) and the keypad (shown with why it does nothing: no motor).
  for (const t of targets.filter((x) => x.kind === "lock" || x.kind === "switch" || x.kind === "keypad")) {
    const decide = (action: LockAction): LockOption => {
      const d = checkHealthCheck({
        role: caller.role,
        enabled: config.enableRemoteLock,
        allowlist,
        kind: KIND[action],
        device: { id: t.device.deviceId, kind: t.kind },
        bridgeId: t.bridge?.deviceId,
        grantedScopes: caller.scopes,
        ceiling: caller.ceiling,
        experiments: caller.experiments,
        recentJobs: jobs,
        now,
      });
      if (!d.allowed) return { allowed: false, reason: d.reason, retryAt: d.retryAt };
      const limited = action === "unlock" ? unlockLimit(jobs, t.device.deviceId, now) : undefined;
      return limited ? { allowed: false, reason: limited } : { allowed: true, experimental: d.experimental };
    };
    out[redactDeviceId(t.device.deviceId)] = { lock: decide("lock"), unlock: decide("unlock") };
  }
  return out;
}

export function unlockLimit(jobs: { deviceId: string; kind: string; state: string; createdAt: string }[], deviceId: string, now: Date): string | undefined {
  const recent = jobs.filter(
    (j) => j.deviceId === deviceId && j.kind === "remote_unlock" && j.state !== "rejected" && now.getTime() - Date.parse(j.createdAt) < UNLOCK_LIMIT.windowMs,
  );
  return recent.length >= UNLOCK_LIMIT.count ? `${UNLOCK_LIMIT.count} unlocks on this lock in the last 10 minutes; wait before the next one` : undefined;
}

export async function runRemoteLock(input: {
  deviceRef: string;
  action: LockAction;
  reason: string;
  password: string;
  caller: Caller;
  uid?: number;
  actor: string;
}): Promise<StartResult> {
  const config = getIgloohomeConfig();
  if (!config) return { ok: false, reason: "igloohome credentials are not set" };
  if (input.action !== "lock" && input.action !== "unlock") return { ok: false, reason: "Unknown action" };
  const reason = input.reason.trim();
  const refused = await checkConfirmation({ reason, password: input.password }, { uid: input.uid, actor: input.actor }, { action: `device.${input.action}`, deviceRef: input.deviceRef });
  if (refused) return { ok: false, reason: refused };

  const db = await getDb();
  const now = new Date();
  const target = (await loadTargets()).find((t) => redactDeviceId(t.device.deviceId) === input.deviceRef);
  if (!target) return { ok: false, reason: "Lock not found in the live device list" };
  const kind = KIND[input.action];
  const jobs = await recentJobs(db, now);
  const decision = checkHealthCheck({
    role: input.caller.role,
    enabled: config.enableRemoteLock,
    allowlist: await managedAllowlist(db),
    kind,
    device: { id: target.device.deviceId, kind: target.kind },
    bridgeId: target.bridge?.deviceId,
    grantedScopes: input.caller.scopes,
    ceiling: input.caller.ceiling,
    experiments: input.caller.experiments,
    recentJobs: jobs,
    now,
  });
  if (!decision.allowed) return { ok: false, reason: decision.reason, retryAt: decision.retryAt };
  const experimental = Boolean(decision.experimental);
  const limited = input.action === "unlock" ? unlockLimit(jobs, target.device.deviceId, now) : undefined;
  if (limited) return { ok: false, reason: limited };

  // A token with only this job's scope (and job status for polling).
  const api = igloohomeAs([JOB_SCOPE[kind], "igloohomeapi/get-job-status"], { physical: true });
  if (!api) return { ok: false, reason: "No usable token for this action" };

  const place = await placeOf(target.device.deviceId);
  const [{ id }] = await db
    .insert(providerJobs)
    .values({ createdAt: now, actor: input.actor, kind, jobType: decision.jobType, deviceId: target.device.deviceId, bridgeId: decision.bridgeId, state: "requested", experimental })
    .returning({ id: providerJobs.id });
  await audit(input.actor, `device.${input.action}`, input.deviceRef, `${experimental ? `EXPERIMENT on ${target.kind} · ` : ""}${place} · job #${id} · ${reason}`);

  try {
    const created = await api.createLockJob(target.device.deviceId, decision.bridgeId, decision.jobType as 1 | 2);
    await db.update(providerJobs).set({ state: "queued", providerJobId: created.jobId, httpStatus: 200 }).where(eq(providerJobs.id, id));
    return { ok: true, id };
  } catch (error) {
    const e = error instanceof ProviderError ? error : new ProviderError("unavailable", (error as Error).message);
    await db
      .update(providerJobs)
      .set({ state: e.status === undefined ? "unknown" : "rejected", httpStatus: e.status ?? null, errorCode: e.code, errorMessage: e.message, retryAfterS: e.retryAfterSeconds ?? null })
      .where(eq(providerJobs.id, id));
    return { ok: false, reason: e.message, id };
  }
}

async function placeOf(deviceId: string) {
  const db = await getDb();
  const [row] = await db
    .select({ name: spaces.name, kind: spaces.kind })
    .from(managedDevices)
    .leftJoin(spaces, eq(spaces.id, managedDevices.spaceId))
    .where(eq(managedDevices.deviceId, deviceId));
  return row?.name ? `${row.kind} ${row.name}` : "no cabin or room";
}

/** Activity log types that mean "locked again" (locked by any means, or auto-relocked). */
const LOCKED_LOGS = new Set(
  Object.entries(LOG_TYPES)
    .filter(([, info]) => /^(Locked|Auto-relocked)/.test(info.label))
    .map(([type]) => Number(type)),
);

export interface EmergencyNotice {
  id: number;
  at: string;
  actor: string;
  action: LockAction;
  deviceRef: string;
  detail?: string;
  spaceId?: number;
  /** Unlock only: a later lock was sent, or the lock has reported "locked" since. */
  relocked?: boolean;
}

/** Emergency actions of the last 24 hours, newest first, for the Overview banner. */
export async function recentEmergencyActions(): Promise<EmergencyNotice[]> {
  const db = await getDb();
  const since = new Date(Date.now() - 24 * 3_600_000);
  const [events, managed, states] = await Promise.all([
    db.select().from(auditEvents).where(and(inArray(auditEvents.action, ["device.unlock", "device.lock"]), gte(auditEvents.at, since))).orderBy(desc(auditEvents.at)),
    db.select().from(managedDevices),
    db.select().from(deviceState),
  ]);
  const byRef = new Map(managed.map((m) => [redactDeviceId(m.deviceId), m]));
  const stateByRef = new Map(states.map((s) => [redactDeviceId(s.deviceId), s]));
  // A lock-type activity log after the unlock also counts: the switch re-locks by itself (log 48, EXP-20260928-01).
  const logs = await db
    .select({ productId: webhookEvents.productId, body: webhookEvents.body })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.eventType, 5), gte(webhookEvents.receivedAt, since)));
  const lockedAt = new Map<string, number[]>();
  for (const row of logs) {
    if (!row.productId) continue;
    for (const log of (eventOf(row.body)?.data?.activityLogs ?? []) as { logType?: number; entryDate?: number }[]) {
      if (typeof log.entryDate === "number" && LOCKED_LOGS.has(Number(log.logType))) {
        const ref = redactDeviceId(row.productId);
        lockedAt.set(ref, [...(lockedAt.get(ref) ?? []), log.entryDate * 1000]);
      }
    }
  }
  return events.map((e) => {
    const action = e.action === "device.unlock" ? "unlock" : "lock";
    const ref = e.target ?? "";
    const later = events.some((x) => x.action === "device.lock" && x.target === e.target && x.at > e.at);
    const state = stateByRef.get(ref);
    const reportedLocked = (state?.lockState === "locked" && state.fetchedAt > e.at) || (lockedAt.get(ref) ?? []).some((t) => t > e.at.getTime());
    return {
      id: e.id,
      at: e.at.toISOString(),
      actor: e.actor,
      action,
      deviceRef: ref,
      detail: e.detail ?? undefined,
      spaceId: byRef.get(ref)?.spaceId ?? undefined,
      relocked: action === "unlock" ? later || reportedLocked : undefined,
    };
  });
}
