import "server-only";

import { atLeast, type DeviceKind, type JobKind, type Role } from "../domain/models";
import { BRIDGE_DIAGNOSTICS_JOB_TYPE, HEALTH_CHECK_JOB_TYPES, PULL_LOGS_JOB_TYPE } from "../igloohome/codes";
import { supportOf } from "@/lib/device-support";
import { scopeDenial } from "@/lib/scopes";

// Health-check guards (plan §13, first-slice-workflow §2.5). Pure: every input is passed in, so tests cover each rule.
// Order matters only for the message shown; all rules must pass.

export const JOB_TYPE_FOR: Record<JobKind, number> = {
  lock_battery: HEALTH_CHECK_JOB_TYPES.lockBattery,
  lock_status: HEALTH_CHECK_JOB_TYPES.lockStatus,
  bridge_diagnostics: BRIDGE_DIAGNOSTICS_JOB_TYPE,
  pin_create: 4, // M5 E12 (R2): writes a PIN into lock storage
  pin_delete: 5, // M5 E12/E14 (R2): removes a PIN, irreversible
  remote_lock: 1, // F4b (R3): physically locks
  remote_unlock: 2, // F4b (R3): physically unlocks
  pull_logs: PULL_LOGS_JOB_TYPE, // G1 (R2): hands over activity logs and deletes them from the lock
};

/** Scope each job kind needs (plan F3; DOC, research 03-auth §3). */
export const JOB_SCOPE: Record<JobKind, string> = {
  lock_battery: "igloohomeapi/get-battery-level-bridge-proxied-job",
  lock_status: "igloohomeapi/get-device-status-bridge-proxied-job",
  bridge_diagnostics: "igloohomeapi/get-device-status-bridge-proxied-job", // Bridge-targeted status job
  pin_create: "igloohomeapi/create-pin-bridge-proxied-job",
  pin_delete: "igloohomeapi/delete-pin-bridge-proxied-job",
  remote_lock: "igloohomeapi/lock-bridge-proxied-job",
  remote_unlock: "igloohomeapi/unlock-bridge-proxied-job",
  pull_logs: "igloohomeapi/get-activity-logs-bridge-proxied-job",
};

/** Plan G1: kinds iot-pms lets a super-admin experiment on (the docs list Bridge jobs for locks only). */
const EXPERIMENT_KINDS: DeviceKind[] = ["lock", "switch", "keypad"];
/** Jobs that need a reason and the person's password every time, experiment or not. */
export const CONFIRM_KINDS: JobKind[] = ["remote_lock", "remote_unlock", "pull_logs"];

export const BRIDGE_TARGETED_WINDOW_MS = 5 * 60_000; // documented: max 1 request / 5 min (H29)
export const DEFAULT_JOB_WINDOW_MS = 2 * 60_000; // polling window when GET /jobs has no expiryDate

export interface HealthCheckInput {
  role?: Role;
  enabled: boolean; // IGLOOHOME_ENABLE_BRIDGE_JOBS (R1) or IGLOOHOME_ENABLE_PIN_JOBS (pin_create / pin_delete)
  allowlist: string[]; // enabled managed devices (device registry, plan F7; full ids)
  kind: JobKind;
  device: { id: string; kind: DeviceKind };
  bridgeId?: string; // Bridge that serves the device (from topology); the device itself for bridge_diagnostics
  scope?: string; // defaults to JOB_SCOPE[kind]
  grantedScopes?: string[]; // the caller's scopes (plan F3); omitted = scope not checked here
  ceiling?: string[]; // what igloohome grants our client, to explain a refusal
  /** Plan G1: super-admin with IGLOOHOME_ENABLE_EXPERIMENTS=true; allows supported jobs on undocumented device kinds. */
  experiments?: boolean;
  recentJobs: { deviceId: string; bridgeId: string; kind: JobKind; state: string; createdAt: string; expiresAt?: string; retryAfterS?: number }[];
  now: Date;
}

export type HealthCheckDecision =
  | { allowed: true; jobType: number; bridgeId: string; /** undocumented device/job combination (G1) */ experimental?: boolean }
  | { allowed: false; reason: string; retryAt?: string };

export function checkHealthCheck(input: HealthCheckInput): HealthCheckDecision {
  const deny = (reason: string, retryAt?: string): HealthCheckDecision => ({ allowed: false, reason, retryAt });
  const now = input.now.getTime();

  if (!atLeast(input.role, "operator")) return deny("Operator role required");
  const isPinJob = input.kind === "pin_create" || input.kind === "pin_delete";
  const isLockCommand = input.kind === "remote_lock" || input.kind === "remote_unlock";
  if ((isLockCommand || input.kind === "pull_logs") && !atLeast(input.role, "super_admin")) return deny("Super-admin role required");
  if (!input.enabled) {
    if (isLockCommand) return deny("Emergency lock/unlock is off (IGLOOHOME_ENABLE_REMOTE_LOCK is not true)");
    return deny(isPinJob ? "PIN jobs are off (IGLOOHOME_ENABLE_PIN_JOBS is not true)" : "Health checks are off (IGLOOHOME_ENABLE_BRIDGE_JOBS is not true)");
  }
  if (input.grantedScopes) {
    const why = scopeDenial(input.scope ?? JOB_SCOPE[input.kind], { scopes: input.grantedScopes, ceiling: input.ceiling ?? input.grantedScopes });
    if (why) return deny(why);
  }

  const isBridgeJob = input.kind === "bridge_diagnostics";
  if (isBridgeJob && input.device.kind !== "bridge") return deny("Bridge diagnostics run on a Bridge only");
  // The docs list Bridge proxied jobs for locks only. A super-admin may try them on a switch or keypad (G1).
  let experimental = false;
  // Hardware-proven combinations (G1, EXP-20260928-01) are regular features; failed ones are refused with the reason.
  const proven = isBridgeJob ? undefined : supportOf(input.device.kind, input.kind);
  const canTry = input.experiments && atLeast(input.role, "super_admin") && EXPERIMENT_KINDS.includes(input.device.kind);
  if (proven && proven.support !== "works" && !canTry) return deny(proven.note);
  if (!isBridgeJob && input.device.kind !== "lock" && proven?.support !== "works") {
    const what = isPinJob ? "PIN jobs" : isLockCommand ? "Lock/unlock" : "This Bridge job";
    if (!canTry) {
      return deny(
        EXPERIMENT_KINDS.includes(input.device.kind)
          ? `${what} ${isPinJob ? "are" : "is"} documented for locks only; a super-admin can try it on a ${input.device.kind} as an experiment (IGLOOHOME_ENABLE_EXPERIMENTS)`
          : `${what} cannot target a ${input.device.kind}`,
      );
    }
    experimental = true;
  }

  const bridgeId = isBridgeJob ? input.device.id : input.bridgeId;
  if (!bridgeId) return deny("No Bridge link reported by the API for this device");
  if (!input.allowlist.includes(input.device.id)) return deny("Device is not managed by iot-pms, or is disabled (Devices → Manage)");
  if (!input.allowlist.includes(bridgeId)) return deny("Bridge is not managed by iot-pms, or is disabled (Devices → Manage)");

  // One job at a time per device: a second request while one is queued only adds load on the lock.
  const inFlight = input.recentJobs.find(
    (job) =>
      job.deviceId === input.device.id &&
      (job.state === "requested" || job.state === "queued" || job.state === "unknown") &&
      now < (job.expiresAt ? Date.parse(job.expiresAt) : Date.parse(job.createdAt) + DEFAULT_JOB_WINDOW_MS),
  );
  if (inFlight) {
    // retryAt lets the page re-enable the buttons by itself when the window ends.
    const until = inFlight.expiresAt ? Date.parse(inFlight.expiresAt) : Date.parse(inFlight.createdAt) + DEFAULT_JOB_WINDOW_MS;
    return deny("Another job for this device is still waiting for the lock", new Date(until).toISOString());
  }

  // igloohome's 429 Retry-After wins over our own window.
  for (const job of input.recentJobs) {
    if (job.bridgeId !== bridgeId || job.retryAfterS === undefined) continue;
    const until = Date.parse(job.createdAt) + job.retryAfterS * 1000;
    if (now < until) return deny("igloohome asked us to wait (429)", new Date(until).toISOString());
  }

  if (isBridgeJob) {
    const last = input.recentJobs
      // E6 (EXP-20260926-01): igloohome's 429 counted a proxied lock-status job (also job 10) on the same Bridge.
      .filter((job) => (job.kind === "bridge_diagnostics" || job.kind === "lock_status") && job.bridgeId === bridgeId && job.state !== "rejected")
      .map((job) => Date.parse(job.createdAt))
      .sort((a, b) => b - a)[0];
    if (last !== undefined && now < last + BRIDGE_TARGETED_WINDOW_MS) {
      return deny("Bridge diagnostics: max 1 job-10 request per Bridge per 5 minutes", new Date(last + BRIDGE_TARGETED_WINDOW_MS).toISOString());
    }
  }

  return { allowed: true, jobType: JOB_TYPE_FOR[input.kind], bridgeId, ...(experimental ? { experimental } : {}) };
}

// --- algoPIN issue (M5, R2) ----------------------------------------------------------------------------

export interface AlgoPinIssueInput {
  role?: Role;
  enabled: boolean; // IGLOOHOME_ENABLE_ALGOPIN
  allowlist: string[];
  deviceId: string;
  algoPinCapable: boolean; // listed by GET /devices/support-pins (API)
  grantedScopes: string[]; // the caller's scopes (plan F3)
  ceiling?: string[]; // what igloohome grants our client, to explain a refusal
  scope?: string; // scope the chosen type needs; omitted when only the device is being checked
}

export function checkAlgoPinIssue(input: AlgoPinIssueInput): { allowed: true } | { allowed: false; reason: string } {
  if (!atLeast(input.role, "operator")) return { allowed: false, reason: "Operator role required" };
  if (!input.enabled) return { allowed: false, reason: "algoPIN creation is off (IGLOOHOME_ENABLE_ALGOPIN is not true)" };
  if (!input.allowlist.includes(input.deviceId)) return { allowed: false, reason: "Device is not managed by iot-pms, or is disabled (Devices → Manage)" };
  if (!input.algoPinCapable) return { allowed: false, reason: "igloohome does not list this device as algoPIN-capable" };
  const why = scopeDenial(input.scope, { scopes: input.grantedScopes, ceiling: input.ceiling ?? input.grantedScopes });
  if (why) return { allowed: false, reason: why };
  return { allowed: true };
}
