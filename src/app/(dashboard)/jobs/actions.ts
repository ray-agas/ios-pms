"use server";

import { callerOf } from "@/server/application/scopes";

import { auth } from "@/auth";
import type { JobKind } from "@/server/domain/models";
import { refreshJob, startHealthCheck, type JobView, type StartResult } from "@/server/application/health-check";
import { runRemoteLock } from "@/server/application/remote-lock";

const KINDS: JobKind[] = ["lock_battery", "lock_status", "bridge_diagnostics"];

/** Operator only; the allowlist, flag, Bridge link and rate guards are re-checked inside startHealthCheck. */
export async function startHealthCheckAction(deviceRef: string, kind: string): Promise<StartResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, reason: "Not signed in" };
  if (!KINDS.includes(kind as JobKind)) return { ok: false, reason: "Unknown health check" };
  return startHealthCheck({
    deviceRef: String(deviceRef),
    kind: kind as JobKind,
    caller: await callerOf(session.user.role, session.user.uid),
    actor: session.user.email ?? session.user.name ?? "unknown",
  });
}

/** Any signed-in user may watch a job; refreshing is a read (GET /jobs/{id}), throttled server-side. */
export async function refreshJobAction(id: number): Promise<JobView | undefined> {
  if (!(await auth())?.user) return undefined;
  return Number.isSafeInteger(id) ? refreshJob(id) : undefined;
}

/** Plan F4b: emergency lock/unlock. Super-admin, flag, reason, password and rate are all re-checked in runRemoteLock. */
export async function remoteLockAction(deviceRef: string, action: string, reason: string, password: string): Promise<StartResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, reason: "Not signed in" };
  if (action !== "lock" && action !== "unlock") return { ok: false, reason: "Unknown action" };
  return runRemoteLock({
    deviceRef: String(deviceRef),
    action,
    reason: typeof reason === "string" ? reason : "",
    password: typeof password === "string" ? password : "",
    caller: await callerOf(session.user.role, session.user.uid),
    uid: session.user.uid,
    actor: session.user.email ?? session.user.name ?? "unknown",
  });
}
