import "server-only";


import { getIgloohomeConfig } from "../config";
import type { DeviceKind, JobInterpretation, JobKind } from "../domain/models";
import { JOB_STATUS_WEBHOOK } from "../igloohome/codes";
import { ProviderError } from "../igloohome/errors";
import { toDeviceSnapshot, toJobStatus } from "../igloohome/mapping";
import { eventOf } from "../igloohome/webhooks";
import { redact, redactDeviceId, redactDeviceIdsInJson } from "../igloohome/redaction";
import type { VendorDevice } from "../igloohome/schemas";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { getDb, iso, type Db } from "../storage/db";
import { completedJobIds, jobCompleteEvent } from "../storage/events";
import { listManaged, managedAllowlist } from "./device-registry";
import { supportOf } from "@/lib/device-support";
import type { Caller } from "./scopes";
import { providerJobs } from "../storage/schema";
import { igloohome, igloohomeAs, listAllDevicesOnce } from "./dashboard";
import { checkHealthCheck, CONFIRM_KINDS, DEFAULT_JOB_WINDOW_MS, type HealthCheckInput } from "./safety";
import { checkConfirmation, type Confirmation } from "./step-up";
import { audit } from "../users";

// Bridge health checks (M4): lock battery (job 9), lock/door status (job 10), Bridge diagnostics (targeted job 10).
// A 200 on the POST means "queued at the Bridge", never "done". Job POSTs are never retried (client + here).

export type JobState = "requested" | "queued" | "unknown" | "completed" | "expired" | "rejected";

const POLL_MIN_INTERVAL_MS = 2_000;
const RECENT_WINDOW_MS = 30 * 60_000;

export const KIND_LABEL: Record<JobKind, string> = {
  lock_battery: "Lock battery",
  lock_status: "Lock / door status",
  bridge_diagnostics: "Bridge diagnostics",
  pin_create: "Create custom PIN",
  pin_delete: "Delete PIN",
  remote_lock: "Emergency lock",
  remote_unlock: "Emergency unlock",
  pull_logs: "Pull activity logs",
};

// --- Topology lookup (full IDs stay in this module) -------------------------------

export interface Target {
  device: VendorDevice;
  kind: DeviceKind;
  bridge?: VendorDevice;
}

export async function loadTargets(): Promise<Target[]> {
  const devices = await listAllDevicesOnce();
  const kindOf = (d: VendorDevice) => toDeviceSnapshot(d, "").kind;
  const bridges = devices.filter((d) => kindOf(d) === "bridge");
  return devices.map((device) => ({
    device,
    kind: kindOf(device),
    bridge: bridges.find((b) => b.linkedDevices.some((link) => link.deviceId === device.deviceId)),
  }));
}

const OPEN_STATES = ["requested", "queued", "unknown"];

/**
 * A job whose job-complete webhook arrived is finished, even if nobody polled GET /jobs. Without this, jobs stayed
 * "queued" and kept the in-flight guard closed (E22: 8 of 9 emergency jobs). Settles on read: the webhook intake
 * only stores. Every job reader goes through here.
 */
async function settle<T extends typeof providerJobs.$inferSelect>(db: Db, rows: T[]): Promise<T[]> {
  const open = rows.filter((r) => OPEN_STATES.includes(r.state) && r.providerJobId);
  if (open.length === 0) return rows;
  const done = await completedJobIds(db, open.map((r) => r.providerJobId!));
  const ids = open.filter((r) => done.has(r.providerJobId!)).map((r) => r.id);
  if (ids.length === 0) return rows;
  await db.update(providerJobs).set({ state: "completed", completed: 1 }).where(and(inArray(providerJobs.id, ids), inArray(providerJobs.state, OPEN_STATES)));
  return rows.map((r) => (ids.includes(r.id) ? { ...r, state: "completed", completed: 1 } : r));
}

export async function recentJobs(db: Db, now: Date): Promise<HealthCheckInput["recentJobs"]> {
  const rows = await db
    .select()
    .from(providerJobs)
    .where(gte(providerJobs.createdAt, new Date(now.getTime() - RECENT_WINDOW_MS)))
    .orderBy(desc(providerJobs.id))
    .then((r) => settle(db, r));
  return rows.map((r) => ({
    deviceId: r.deviceId,
    bridgeId: r.bridgeId,
    kind: r.kind as JobKind,
    state: r.state,
    createdAt: r.createdAt.toISOString(),
    expiresAt: iso(r.expiresAt),
    retryAfterS: r.retryAfterS ?? undefined,
  }));
}

function kindsFor(kind: DeviceKind): JobKind[] {
  if (kind === "bridge") return ["bridge_diagnostics"];
  if (kind === "lock" || kind === "switch" || kind === "keypad") return ["lock_battery", "lock_status"]; // switch/keypad: shown, then refused or offered as an experiment
  return [];
}

// --- Options for the UI ------------------------------------------------------------

export interface HealthCheckOption {
  kind: JobKind;
  label: string;
  allowed: boolean;
  reason?: string;
  retryAt?: string;
  deviceRef: string;
  bridgeRef?: string;
}

/** Per display ID, the health checks the UI may offer and why any is disabled. Server decides; UI only shows. */
export async function healthCheckOptions(caller: Caller): Promise<Record<string, HealthCheckOption[]>> {
  const api = igloohome();
  const config = getIgloohomeConfig();
  if (!api || !config) return {};
  const now = new Date();
  const [targets, jobs, allowlist] = await Promise.all([loadTargets(), getDb().then((db) => recentJobs(db, now)), managedAllowlist()]);
  const out: Record<string, HealthCheckOption[]> = {};
  for (const t of targets) {
    const deviceRef = redactDeviceId(t.device.deviceId);
    out[deviceRef] = kindsFor(t.kind).map((kind) => {
      const decision = checkHealthCheck({
        role: caller.role,
        enabled: config.enableBridgeJobs,
        allowlist,
        grantedScopes: caller.scopes,
        ceiling: caller.ceiling,
        experiments: caller.experiments,
        kind,
        device: { id: t.device.deviceId, kind: t.kind },
        bridgeId: t.bridge?.deviceId,
        recentJobs: jobs,
        now,
      });
      const bridge = kind === "bridge_diagnostics" ? t.device : t.bridge;
      return {
        kind,
        label: KIND_LABEL[kind],
        // Experiments need a reason and a password, which this one-click launcher has no room for (G1).
        allowed: decision.allowed && !decision.experimental,
        reason: !decision.allowed
          ? decision.reason
          : decision.experimental
            ? `Undocumented for a ${t.kind}: run it as an experiment in Developer → Try it (reason and password needed)`
            : undefined,
        retryAt: decision.allowed ? undefined : decision.retryAt,
        deviceRef,
        bridgeRef: bridge ? redactDeviceId(bridge.deviceId) : undefined,
      };
    });
  }
  return out;
}

// --- Start ----------------------------------------------------------------------------

export type StartResult = { ok: true; id: number } | { ok: false; reason: string; retryAt?: string; id?: number };

export async function startHealthCheck(input: {
  deviceRef: string;
  kind: JobKind;
  caller: Caller;
  actor: string;
  /** Reason + password: required for experiments and job 15 (plan G1), ignored otherwise. */
  confirm?: Confirmation;
  uid?: number;
}): Promise<StartResult> {
  const api = igloohomeAs(input.caller.scopes); // token carries only this user's scopes (plan F3)
  const config = getIgloohomeConfig();
  if (!api || !config) return { ok: false, reason: "igloohome credentials are not set" };
  if (!["lock_battery", "lock_status", "bridge_diagnostics", "pull_logs"].includes(input.kind)) return { ok: false, reason: "Unknown health check" }; // PIN jobs: pin-jobs.ts

  const db = await getDb();
  const now = new Date();
  const target = (await loadTargets()).find((t) => redactDeviceId(t.device.deviceId) === input.deviceRef);
  if (!target) return { ok: false, reason: "Device not found in the live device list" };

  // Re-checked here even though the UI already asked: the server is the only authority.
  const decision = checkHealthCheck({
    role: input.caller.role,
    enabled: config.enableBridgeJobs,
    allowlist: await managedAllowlist(db),
    grantedScopes: input.caller.scopes,
    ceiling: input.caller.ceiling,
    experiments: input.caller.experiments,
    kind: input.kind,
    device: { id: target.device.deviceId, kind: target.kind },
    bridgeId: target.bridge?.deviceId,
    recentJobs: await recentJobs(db, now),
    now,
  });
  if (!decision.allowed) return { ok: false, reason: decision.reason, retryAt: decision.retryAt };
  const experimental = Boolean(decision.experimental);
  if (experimental || CONFIRM_KINDS.includes(input.kind)) {
    const action = experimental ? "device.experiment" : `device.${input.kind}`;
    const refused = await checkConfirmation(input.confirm, { uid: input.uid, actor: input.actor }, { action, deviceRef: input.deviceRef });
    if (refused) return { ok: false, reason: refused };
  }

  const [{ id }] = await db
    .insert(providerJobs)
    .values({ createdAt: now, actor: input.actor, kind: input.kind, jobType: decision.jobType, deviceId: target.device.deviceId, bridgeId: decision.bridgeId, state: "requested", experimental })
    .returning({ id: providerJobs.id });
  if (experimental || CONFIRM_KINDS.includes(input.kind)) {
    await audit(input.actor, experimental ? "device.experiment" : `device.${input.kind}`, input.deviceRef, `${KIND_LABEL[input.kind]} (job ${decision.jobType}) on ${target.kind} · job #${id} · ${input.confirm!.reason.trim()}`);
  }

  try {
    const created =
      input.kind === "bridge_diagnostics"
        ? await api.createBridgeDiagnosticsJob(decision.bridgeId)
        : await api.createProxiedJob(target.device.deviceId, decision.bridgeId, decision.jobType as 9 | 10 | 15);
    await db.update(providerJobs).set({ state: "queued", providerJobId: created.jobId, httpStatus: 200 }).where(eq(providerJobs.id, id));
    return { ok: true, id };
  } catch (error) {
    const e = error instanceof ProviderError ? error : new ProviderError("unavailable", (error as Error).message);
    // No HTTP status = timeout / network: igloohome may still have queued it. Never retried; shown as unknown.
    const state: JobState = e.status === undefined ? "unknown" : "rejected";
    await db
      .update(providerJobs)
      .set({ state, httpStatus: e.status ?? null, errorCode: e.code, errorMessage: e.message, retryAfterS: e.retryAfterSeconds ?? null })
      .where(eq(providerJobs.id, id));
    return { ok: false, reason: e.message, id };
  }
}

// --- Read / poll ----------------------------------------------------------------------

export interface JobView {
  id: number;
  createdAt: string;
  actor: string;
  kind: JobKind;
  kindLabel: string;
  jobType: number;
  deviceRef: string;
  bridgeRef: string;
  state: JobState;
  providerJobId?: string;
  httpStatus?: number;
  errorCode?: string;
  errorMessage?: string;
  retryAfterS?: number;
  pollUntil: string;
  expiresAt?: string;
  completed?: boolean;
  polledJobStatus?: number;
  interpretations: JobInterpretation[];
  rawJob?: string;
  polls: number;
  polledAt?: string;
  webhook?: { receivedAt: string; jobStatus?: number; meaning?: string; data: string; verification: string };
  /** Device-reported fields: webhook `data`, else polled `jobResponse.opResult` (same fields, EXP-20260926-01). */
  result?: Record<string, unknown>;
}

function toView(row: typeof providerJobs.$inferSelect, webhook?: JobView["webhook"]): JobView {
  const polledJobStatus = row.rawJobStatus ?? undefined;
  const createdAt = row.createdAt.toISOString();
  const expiresAt = iso(row.expiresAt);
  const rawJob = row.rawJob ? redactDeviceIdsInJson(row.rawJob) : undefined; // re-masked on read (older rows)
  return {
    id: row.id,
    createdAt,
    actor: row.actor,
    kind: row.kind as JobKind,
    kindLabel: KIND_LABEL[row.kind as JobKind] ?? row.kind,
    jobType: row.jobType,
    deviceRef: redactDeviceId(row.deviceId),
    bridgeRef: redactDeviceId(row.bridgeId),
    state: row.state as JobState,
    providerJobId: row.providerJobId ?? undefined,
    httpStatus: row.httpStatus ?? undefined,
    errorCode: row.errorCode ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    retryAfterS: row.retryAfterS ?? undefined,
    pollUntil: expiresAt ?? new Date(row.createdAt.getTime() + DEFAULT_JOB_WINDOW_MS).toISOString(),
    expiresAt,
    completed: row.completed === null ? undefined : row.completed === 1,
    polledJobStatus,
    interpretations:
      polledJobStatus === undefined ? [] : toJobStatus({ jobId: "", jobResponse: { jobStatus: polledJobStatus } }).interpretations,
    rawJob,
    polls: row.polls,
    polledAt: iso(row.polledAt),
    webhook,
    result: resultOf(webhook, rawJob),
  };
}

function resultOf(webhook: JobView["webhook"], rawJob?: string): Record<string, unknown> | undefined {
  const parse = (text?: string) => {
    try {
      return text ? JSON.parse(text) : undefined;
    } catch {
      return undefined;
    }
  };
  const fields = parse(webhook?.data) ?? parse(rawJob)?.jobResponse?.opResult;
  if (!fields || typeof fields !== "object") return undefined;
  const rest = Object.fromEntries(Object.entries(fields).filter(([key]) => !["jobId", "jobStatus", "result"].includes(key)));
  return Object.keys(rest).length ? rest : undefined;
}

async function findWebhook(db: Db, providerJobId?: string): Promise<JobView["webhook"]> {
  if (!providerJobId) return undefined;
  const row = await jobCompleteEvent(db, providerJobId);
  if (!row) return undefined;
  const data = eventOf(row.body)?.data ?? {};
  return {
    receivedAt: row.receivedAt.toISOString(),
    jobStatus: typeof data.jobStatus === "number" ? data.jobStatus : undefined,
    meaning: typeof data.jobStatus === "number" ? JOB_STATUS_WEBHOOK[data.jobStatus]?.meaning : undefined,
    data: redactDeviceIdsInJson(JSON.stringify(redact(data))),
    verification: row.verification,
  };
}

export async function getJob(id: number): Promise<JobView | undefined> {
  const db = await getDb();
  const [row] = await settle(db, await db.select().from(providerJobs).where(eq(providerJobs.id, id)));
  if (!row) return undefined;
  return toView(row, await findWebhook(db, row.providerJobId ?? undefined));
}

export async function listJobs(limit = 30): Promise<JobView[]> {
  const db = await getDb();
  const rows = await settle(db, await db.select().from(providerJobs).orderBy(desc(providerJobs.id)).limit(Math.min(limit, 200)));
  return Promise.all(rows.map(async (row) => toView(row, await findWebhook(db, row.providerJobId ?? undefined))));
}

/** One GET /jobs/{jobId} if the job is still open (R0, safe to repeat). Throttled so several tabs cannot hammer it. */
export async function refreshJob(id: number): Promise<JobView | undefined> {
  const db = await getDb();
  const job = await getJob(id);
  const api = igloohome();
  if (!job || !api || job.state !== "queued" || !job.providerJobId) return job;

  const now = Date.now();
  if (job.polledAt && now - Date.parse(job.polledAt) < POLL_MIN_INTERVAL_MS) return job;

  try {
    const polled = await api.getJob(job.providerJobId);
    const status = toJobStatus(polled);
    const expiresAt = status.expiresAt ?? job.expiresAt;
    const pollUntil = expiresAt ? Date.parse(expiresAt) : Date.parse(job.createdAt) + DEFAULT_JOB_WINDOW_MS;
    const state: JobState = status.completed ? "completed" : now > pollUntil ? "expired" : "queued";
    await db
      .update(providerJobs)
      .set({
        state,
        completed: status.completed === undefined ? null : status.completed ? 1 : 0,
        rawJobStatus: status.rawJobStatus ?? null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        rawJob: redactDeviceIdsInJson(JSON.stringify(redact(polled))),
        polledAt: new Date(now),
        polls: sql`${providerJobs.polls} + 1`,
        errorCode: null,
        errorMessage: null,
      })
      .where(eq(providerJobs.id, id));
  } catch (error) {
    const e = error instanceof ProviderError ? error : new ProviderError("unavailable", (error as Error).message);
    const state: JobState = now > Date.parse(job.pollUntil) ? "expired" : "queued";
    await db
      .update(providerJobs)
      .set({ state, errorCode: e.code, errorMessage: e.message, polledAt: new Date(now), polls: sql`${providerJobs.polls} + 1` })
      .where(eq(providerJobs.id, id));
  }
  return getJob(id);
}

// --- Experiment findings (plan G1) ---------------------------------------------------------------

export interface ExperimentFinding {
  kind: JobKind;
  label: string;
  status: "works" | "no_effect" | "failed" | "no_result" | "pending";
  detail: string;
  at: string;
  jobId: number;
}

/** Latest outcome per device and job kind of every experiment (undocumented device/job combination). */
export async function experimentFindings(): Promise<Record<string, ExperimentFinding[]>> {
  const db = await getDb();
  const rows = await settle(db, await db.select().from(providerJobs).where(eq(providerJobs.experimental, true)).orderBy(desc(providerJobs.id)).limit(200));
  const kindOf = new Map((await listManaged(db)).map((m) => [m.deviceId, m.kind as DeviceKind | null]));
  const out: Record<string, ExperimentFinding[]> = {};
  const seen = new Set<string>();
  for (const row of rows) {
    const ref = redactDeviceId(row.deviceId);
    const key = `${ref}:${row.kind}`;
    if (seen.has(key)) continue; // newest first: keep the latest per device and kind
    seen.add(key);
    const view = toView(row, await findWebhook(db, row.providerJobId ?? undefined));
    const result = view.webhook?.jobStatus;
    const windowOver = Date.now() > Date.parse(view.pollUntil);
    const proven = supportOf(kindOf.get(row.deviceId) ?? "unknown", row.kind as JobKind);
    const finding: Omit<ExperimentFinding, "kind" | "label" | "at" | "jobId"> =
      result === 0 && proven?.support === "no_effect"
        ? { status: "no_effect", detail: proven.note }
        : result === 0
        ? { status: "works", detail: "The device reported success (job result 0)." }
        : result !== undefined && result !== 2
          ? { status: "failed", detail: `The device answered with result ${result}${view.webhook?.meaning ? `: ${view.webhook.meaning}` : ""}.` }
          : view.state === "rejected"
            ? { status: "failed", detail: `igloohome refused it (${view.httpStatus ?? "no status"}): ${view.errorMessage ?? "no message"}.` }
            : view.state === "expired" || windowOver
              ? { status: "no_result", detail: "No result came back from the device. It probably does not support this job, or the Bridge could not reach it." }
              : { status: "pending", detail: "Sent; waiting for the device through the Bridge." };
    (out[ref] ??= []).push({ ...finding, kind: row.kind as JobKind, label: KIND_LABEL[row.kind as JobKind] ?? row.kind, at: view.createdAt, jobId: row.id });
  }
  return out;
}
