import "server-only";

import { targetName } from "@/lib/device-kinds";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { ALGOPIN_TYPES, checkAlgoPin, type AlgoPinDraft, type AlgoPinType } from "@/lib/algopin-rules";

import { getIgloohomeConfig, getWebhookConfig } from "../config";
import { ProviderError } from "../igloohome/errors";
import { redactDeviceId } from "../igloohome/redaction";
import { eventOf, pinFingerprint } from "../igloohome/webhooks";
import { getDb } from "../storage/db";
import { jobCompleteEvent } from "../storage/events";
import { accessCodes, providerJobs, webhookEvents } from "../storage/schema";
import { getSite, igloohome, igloohomeAs, placesOf } from "./dashboard";
import { managedAllowlist } from "./device-registry";
import { storePin } from "./pin-vault";
import { checkAlgoPinIssue } from "./safety";
import type { Caller } from "./scopes";

// M5: algoPIN issue (E10) and activation tracking (E11). A 200 means igloohome computed a PIN; the lock only learns
// about it when someone types it (algoPINs are offline). The PIN is returned to the operator once and never stored.

const FALLBACK_TZ = "Asia/Jakarta"; // both test properties (EXP-20260925-01); used only if a property has none

export interface AlgoPinTarget {
  deviceRef: string;
  name: string;
  kind: string;
  place?: string; // cabin or room
  modelName?: string;
  timeZone: string;
  allowed: boolean;
  reason?: string;
  types: Record<AlgoPinType, { allowed: boolean; reason?: string }>;
}

async function context(caller: Caller) {
  const api = igloohome();
  const config = getIgloohomeConfig();
  if (!api || !config) return undefined;
  const [capable, site, allowlist] = await Promise.all([api.listPinCapableDevices({ limit: 300 }), getSite(), managedAllowlist()]);
  const roomTz = new Map((site.data?.rooms ?? []).map((room) => [room.id, room.timezone]));
  const byRef = new Map([...(site.data?.devices ?? []), ...(site.data?.bridges ?? [])].map((d) => [d.id, d]));
  const targets = capable.payload.map((device) => {
    const ref = redactDeviceId(device.deviceId);
    const view = byRef.get(ref);
    const tz = view?.propertyIds.map((id) => roomTz.get(id)).find(Boolean) ?? FALLBACK_TZ;
    return { device, ref, view, tz };
  });
  // Creating uses a token with only this user's scopes (plan F3); reading the capable list uses the read token.
  return { api: igloohomeAs(caller.scopes), config, caller, targets, allowlist, nameOf: (r: string) => byRef.get(r)?.name, places: placesOf(site.data) };
}

export async function algoPinTargets(caller: Caller): Promise<AlgoPinTarget[]> {
  const ctx = await context(caller);
  if (!ctx) return [];
  return ctx.targets.map(({ device, ref, view, tz }) => {
    const base = {
      role: caller.role,
      enabled: ctx.config.enableAlgoPin,
      allowlist: ctx.allowlist,
      deviceId: device.deviceId,
      algoPinCapable: true,
      grantedScopes: caller.scopes,
      ceiling: caller.ceiling,
    };
    const device_ = checkAlgoPinIssue(base);
    const types = Object.fromEntries(
      (Object.keys(ALGOPIN_TYPES) as AlgoPinType[]).map((type) => {
        const d = checkAlgoPinIssue({ ...base, scope: ALGOPIN_TYPES[type].scope });
        return [type, d.allowed ? { allowed: true } : { allowed: false, reason: d.reason }];
      }),
    ) as AlgoPinTarget["types"];
    return {
      deviceRef: ref,
      name: targetName(view, ref, ctx.nameOf),
      kind: view?.kind ?? "unknown",
      place: ctx.places.get(ref),
      modelName: view?.modelName,
      timeZone: tz,
      allowed: device_.allowed,
      reason: device_.allowed ? undefined : device_.reason,
      types,
    };
  });
}

export type IssueResult =
  | { ok: true; id: number; pin: string; pinId?: string; startAt: string; endAt?: string; activateByMs?: number; warnings: string[] }
  | { ok: false; reason: string; id?: number; fieldErrors?: Record<string, string> };

export async function issueAlgoPin(input: { deviceRef: string; draft: AlgoPinDraft; caller: Caller; actor: string }): Promise<IssueResult> {
  const ctx = await context(input.caller);
  if (!ctx?.api) return { ok: false, reason: "igloohome credentials are not set" };
  const rules = ALGOPIN_TYPES[input.draft.type];
  if (!rules) return { ok: false, reason: "Unknown algoPIN type" };
  const target = ctx.targets.find((t) => t.ref === input.deviceRef);
  if (!target) return { ok: false, reason: "Device is not listed by GET /devices/support-pins" };

  const decision = checkAlgoPinIssue({
    role: input.caller.role,
    enabled: ctx.config.enableAlgoPin,
    allowlist: ctx.allowlist,
    deviceId: target.device.deviceId,
    algoPinCapable: true,
    grantedScopes: input.caller.scopes,
    ceiling: input.caller.ceiling,
    scope: rules.scope,
  });
  if (!decision.allowed) return { ok: false, reason: decision.reason };

  const now = Date.now();
  const check = checkAlgoPin(input.draft, { now, timeZone: target.tz });
  if (!check.body) return { ok: false, reason: "The request breaks an algoPIN rule", fieldErrors: check.errors };

  const db = await getDb();
  const [{ id }] = await db
    .insert(accessCodes)
    .values({
      createdAt: new Date(now),
      actor: input.actor,
      deviceId: target.device.deviceId,
      pinType: input.draft.type,
      accessName: check.body.accessName,
      variance: check.body.variance,
      startAt: check.body.startDate,
      endAt: check.body.endDate ?? null,
      startMs: check.startMs!,
      endMs: check.endMs ?? null,
      activateByMs: check.activateBy ?? null,
      state: "requested",
    })
    .returning({ id: accessCodes.id });

  try {
    const created = await ctx.api.createAlgoPin(target.device.deviceId, input.draft.type, check.body);
    await db
      .update(accessCodes)
      .set({ state: "issued", pinId: created.pinId ?? null, pinFingerprint: pinFingerprint(created.pin, getWebhookConfig().fingerprintKey), httpStatus: 200 })
      .where(eq(accessCodes.id, id));
    // Deterministic algoPINs: the same parameters can return a PIN this device already had deleted (G1 follow-up).
    const fp = pinFingerprint(created.pin, getWebhookConfig().fingerprintKey);
    const deletedAt = await deletedBeforeOf(fp, target.device.deviceId, new Date(now));
    if (deletedAt) {
      check.warnings.push(
        `This is the same PIN as one deleted from this device on ${when(deletedAt.toISOString())}, and the device refuses deleted algoPINs for good. Issue again with another start hour or variance for a working PIN.`,
      );
    }
    await storePin({
      deviceId: target.device.deviceId,
      kind: "algopin",
      pinType: input.draft.type,
      pin: created.pin,
      accessName: check.body.accessName,
      startAt: check.body.startDate,
      endAt: check.body.endDate,
      accessCodeId: id,
      actor: input.actor,
    });
    return {
      ok: true,
      id,
      pin: created.pin,
      pinId: created.pinId,
      startAt: check.body.startDate,
      endAt: check.body.endDate,
      activateByMs: check.activateBy,
      warnings: check.warnings,
    };
  } catch (error) {
    const e = error instanceof ProviderError ? error : new ProviderError("unavailable", (error as Error).message);
    await db
      .update(accessCodes)
      .set({ state: e.status === undefined ? "unknown" : "rejected", httpStatus: e.status ?? null, errorCode: e.code, errorMessage: e.message })
      .where(eq(accessCodes.id, id));
    return { ok: false, reason: `${e.status ?? "No response"}: ${e.message}`, id };
  }
}

export type CodeStatus = "upcoming" | "active" | "needs_activation" | "activation_missed" | "expired" | "deleted" | "previously_deleted" | "rejected" | "unknown";

export interface AccessCodeView {
  id: number;
  createdAt: string;
  actor: string;
  deviceRef: string;
  type: AlgoPinType;
  typeLabel: string;
  accessName: string;
  variance: number;
  startAt: string;
  endAt?: string;
  startMs: number;
  endMs?: number;
  activateByMs?: number;
  state: string;
  status: CodeStatus;
  pinId?: string;
  fingerprint?: string;
  error?: string;
  firstUse?: { at: string; logType: number; receivedAt: string };
  /** Latest Delete PIN job (Bridge job 5) for this PIN on this device, sent after it was issued; jobStatus 0 = deleted. */
  deletion?: { jobId: number; state: string; jobStatus?: number };
  /** The same PIN was deleted from this device before it was issued (algoPINs are deterministic). */
  deletedBefore?: string;
  /** Plain-words reason for the status, shown on hover. */
  statusNote?: string;
}

// LOG_TYPES 19–26: "Unlocked with PIN", "One-time PIN used", first use of permanent/duration/weekly/… PINs.
const PIN_SUCCESS = new Set([19, 20, 21, 22, 23, 24, 25, 26]);

/**
 * Delete jobs (5) for this PIN on this device. algoPINs are deterministic: the same lock, type, start hour and
 * variance give the same PIN again, so a delete only counts for a code if it came after that code was issued.
 */
async function deletesOf(fingerprint: string, deviceId: string) {
  const db = await getDb();
  const jobs = await db
    .select({ id: providerJobs.id, state: providerJobs.state, providerJobId: providerJobs.providerJobId, createdAt: providerJobs.createdAt })
    .from(providerJobs)
    .where(and(eq(providerJobs.kind, "pin_delete"), eq(providerJobs.pinFingerprint, fingerprint), eq(providerJobs.deviceId, deviceId)))
    .orderBy(desc(providerJobs.id));
  return Promise.all(
    jobs.map(async (job) => {
      const hook = job.providerJobId ? await jobCompleteEvent(db, job.providerJobId) : undefined;
      const status = hook ? eventOf(hook.body)?.data?.jobStatus : undefined;
      return { jobId: job.id, state: job.state, createdAt: job.createdAt, jobStatus: typeof status === "number" ? status : undefined };
    }),
  );
}

/** When the same PIN was last deleted from this device before `issuedAt` (result 0 or 3), if ever. */
async function deletedBeforeOf(fingerprint: string, deviceId: string, issuedAt: Date) {
  const hit = (await deletesOf(fingerprint, deviceId)).find((d) => d.createdAt < issuedAt && (d.jobStatus === 0 || d.jobStatus === 3));
  return hit?.createdAt;
}

/**
 * First successful activity log whose PIN fingerprint matches (webhook type 5 stores fingerprints, never PINs).
 * `deviceId` and `since` narrow it for the vault: the same PIN value can exist on other locks, or be re-created
 * later after a delete (EXP-20260926-04).
 */
export async function firstUse(fingerprint?: string, scope: { deviceId?: string; since?: Date } = {}): Promise<AccessCodeView["firstUse"]> {
  if (!fingerprint) return undefined;
  const db = await getDb();
  const rows = await db
    .select({ receivedAt: webhookEvents.receivedAt, body: webhookEvents.body })
    .from(webhookEvents)
    // Cheap pre-filter on the jsonb text (canonical form prints `"key": "value"`); the exact match happens below.
    .where(
      and(
        eq(webhookEvents.eventType, 5),
        sql`${webhookEvents.body}::text LIKE ${`%"pinFingerprint": "${fingerprint}"%`}`,
        scope.deviceId ? eq(webhookEvents.productId, scope.deviceId) : undefined,
      ),
    )
    .orderBy(asc(webhookEvents.id))
    .limit(20);
  for (const row of rows) {
    const receivedAt = row.receivedAt.toISOString();
    const logs: { pinFingerprint?: string; entryDate?: number; logType?: number }[] = eventOf(row.body)?.data?.activityLogs ?? [];
    // Only a successful PIN entry activates a code; 16/17 (wrong PIN / too long) with the same PIN is a refusal.
    const after = scope.since ? scope.since.getTime() / 1000 - 60 : -Infinity; // lock clock may lag a little
    const log = logs.find(
      (l) => l.pinFingerprint === fingerprint && PIN_SUCCESS.has(Number(l.logType)) && (typeof l.entryDate !== "number" || l.entryDate >= after),
    );
    if (log) {
      return {
        at: typeof log.entryDate === "number" ? new Date(log.entryDate * 1000).toISOString() : receivedAt,
        logType: Number(log.logType),
        receivedAt,
      };
    }
  }
  return undefined;
}

async function deletionView(fingerprint: string | undefined, deviceId: string, issuedAt: Date) {
  if (!fingerprint) return {};
  const deletes = await deletesOf(fingerprint, deviceId);
  const after = deletes.find((d) => d.createdAt >= issuedAt);
  const before = deletes.find((d) => d.createdAt < issuedAt && (d.jobStatus === 0 || d.jobStatus === 3));
  return {
    deletion: after ? { jobId: after.jobId, state: after.state, jobStatus: after.jobStatus } : undefined,
    deletedBefore: before?.createdAt.toISOString(),
  };
}

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: FALLBACK_TZ, dateStyle: "medium", timeStyle: "short" });

function noteOf(status: CodeStatus, v: Omit<AccessCodeView, "status">): string | undefined {
  if (status === "previously_deleted") {
    return `Same PIN as one deleted from this device on ${when(v.deletedBefore!)}. algoPINs are deterministic (same device, type, start hour and variance give the same PIN), and a deleted algoPIN stays refused by the device (EXP-20260928-01 K8). Issue again with another start hour or variance for a working PIN.`;
  }
  if (status === "deleted") return `Deleted from the device by job #${v.deletion!.jobId} (result 0).`;
  if (status === "needs_activation") return "Hourly, daily and permanent algoPINs must be typed on the device once within 24 hours of their start, or they stop working.";
  if (status === "activation_missed") return "Not typed on the device within 24 hours of its start, so the device no longer accepts it.";
  return undefined;
}

export function statusOf(v: Omit<AccessCodeView, "status">, now: number): CodeStatus {
  if (v.state === "rejected") return "rejected";
  if (v.state !== "issued") return "unknown";
  if (v.deletion?.jobStatus === 0) return "deleted";
  if (v.deletedBefore && !v.firstUse) return "previously_deleted";
  if (v.endMs !== undefined && now >= v.endMs) return "expired";
  if (v.type === "onetime" && v.firstUse) return "expired"; // used once
  if (now < v.startMs) return "upcoming";
  if (v.activateByMs !== undefined && !v.firstUse) return now > v.activateByMs ? "activation_missed" : "needs_activation";
  return "active";
}

export async function listAccessCodes(limit = 50): Promise<AccessCodeView[]> {
  const db = await getDb();
  const rows = await db.select().from(accessCodes).orderBy(desc(accessCodes.id)).limit(Math.min(limit, 200));
  const now = Date.now();
  return Promise.all(
    rows.map(async (r) => {
      const fingerprint = r.pinFingerprint ?? undefined;
      const type = r.pinType as AlgoPinType;
      const view: Omit<AccessCodeView, "status"> = {
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        actor: r.actor,
        deviceRef: redactDeviceId(r.deviceId),
        type,
        typeLabel: ALGOPIN_TYPES[type]?.label ?? r.pinType,
        accessName: r.accessName,
        variance: r.variance,
        startAt: r.startAt,
        endAt: r.endAt ?? undefined,
        startMs: r.startMs,
        endMs: r.endMs ?? undefined,
        activateByMs: r.activateByMs ?? undefined,
        state: r.state,
        pinId: r.pinId ?? undefined,
        fingerprint: fingerprint?.slice(0, 6),
        error: r.errorMessage ? `${r.httpStatus ?? ""} ${r.errorMessage}`.trim() : undefined,
        // Same device, after this code was issued: the same PIN value may have existed before (deterministic).
        firstUse: await firstUse(fingerprint, { deviceId: r.deviceId, since: r.createdAt }),
        ...(await deletionView(fingerprint, r.deviceId, r.createdAt)),
      };
      const status = statusOf(view, now);
      return { ...view, status, statusNote: noteOf(status, view) };
    }),
  );
}
