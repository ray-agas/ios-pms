import "server-only";

import { targetName } from "@/lib/device-kinds";

import { eq } from "drizzle-orm";

import { checkCustomPin, checkDeletePin, type CustomPinDraft, type CustomPinJobData } from "@/lib/pin-job-rules";

import { getIgloohomeConfig, getWebhookConfig } from "../config";
import { ProviderError } from "../igloohome/errors";
import { redactDeviceId } from "../igloohome/redaction";
import { pinFingerprint } from "../igloohome/webhooks";
import { getDb } from "../storage/db";
import { providerJobs } from "../storage/schema";
import { getSite, igloohomeAs, placesOf } from "./dashboard";
import { managedAllowlist } from "./device-registry";
import { loadTargets, recentJobs } from "./health-check";
import { markRevoking, storePin } from "./pin-vault";
import { checkHealthCheck } from "./safety";
import { checkConfirmation, type Confirmation } from "./step-up";
import { audit } from "../users";
import type { Caller } from "./scopes";

// M5 E12/E14: Bridge job 4 (create custom PIN) and job 5 (delete PIN). Same pipeline as health checks: the
// provider_jobs row is written before the POST, the POST is never retried, the job page follows it to the end.
// The PIN is never stored: only its fingerprint, so the job and later lock logs can be matched.

export const PIN_SCOPES = {
  pin_create: "igloohomeapi/create-pin-bridge-proxied-job",
  pin_delete: "igloohomeapi/delete-pin-bridge-proxied-job",
} as const;
type PinKind = keyof typeof PIN_SCOPES;

export interface PinJobTarget {
  deviceRef: string;
  name: string;
  bridgeName?: string;
  timeZone: string;
  create: { allowed: boolean; reason?: string };
  remove: { allowed: boolean; reason?: string };
  /** G1: undocumented for this device kind; the form asks for a reason and the password. */
  experimental?: boolean;
  kind: string;
  place?: string; // cabin or room
}

async function decide(kind: PinKind, caller: Caller) {
  const config = getIgloohomeConfig();
  if (!config) return undefined;
  const now = new Date();
  const [targets, jobs, site, allowlist] = await Promise.all([loadTargets(), getDb().then((db) => recentJobs(db, now)), getSite(), managedAllowlist()]);
  const roomTz = new Map((site.data?.rooms ?? []).map((r) => [r.id, r.timezone]));
  const views = new Map((site.data?.devices ?? []).map((d) => [d.id, d]));
  const places = placesOf(site.data);
  return targets
    // Locks and the keypad (proven, G1). The switch is listed so its refusal says why: its PINs live on the keypad.
    .filter((t) => t.kind === "lock" || t.kind === "keypad" || t.kind === "switch")
    .map((t) => {
      const ref = redactDeviceId(t.device.deviceId);
      const view = views.get(ref);
      const decision = checkHealthCheck({
        role: caller.role,
        enabled: config.enablePinJobs,
        allowlist,
        kind,
        device: { id: t.device.deviceId, kind: t.kind },
        bridgeId: t.bridge?.deviceId,
        scope: PIN_SCOPES[kind],
        grantedScopes: caller.scopes,
        ceiling: caller.ceiling,
        experiments: caller.experiments,
        recentJobs: jobs,
        now,
      });
      return {
        target: t,
        ref,
        name: targetName(view, ref, (r) => views.get(r)?.name),
        bridgeName: t.bridge ? views.get(redactDeviceId(t.bridge.deviceId))?.name ?? t.bridge.deviceName : undefined,
        timeZone: view?.propertyIds.map((id) => roomTz.get(id)).find(Boolean) ?? "Asia/Jakarta",
        place: places.get(ref),
        decision,
      };
    });
}

export async function pinJobTargets(caller: Caller): Promise<PinJobTarget[]> {
  const [create, remove] = await Promise.all([decide("pin_create", caller), decide("pin_delete", caller)]);
  if (!create || !remove) return [];
  return create.map((c) => {
    const r = remove.find((x) => x.ref === c.ref)!;
    const view = (d: typeof c.decision) => (d.allowed ? { allowed: true } : { allowed: false, reason: d.reason });
    return {
      deviceRef: c.ref,
      name: c.name,
      bridgeName: c.bridgeName,
      timeZone: c.timeZone,
      create: view(c.decision),
      remove: view(r.decision),
      experimental: (c.decision.allowed && c.decision.experimental) || (r.decision.allowed && r.decision.experimental) || undefined,
      kind: c.target.kind,
      place: c.place,
    };
  });
}

export type PinJobResult = { ok: true; id: number } | { ok: false; reason: string; id?: number; fieldErrors?: Record<string, string> };

async function send(
  kind: PinKind,
  input: { deviceRef: string; caller: Caller; actor: string; confirm?: Confirmation; uid?: number },
  jobData: CustomPinJobData | { pin: string },
): Promise<PinJobResult> {
  const api = igloohomeAs(input.caller.scopes); // token carries only this user's scopes (plan F3)
  const rows = await decide(kind, input.caller);
  if (!api || !rows) return { ok: false, reason: "igloohome credentials are not set" };
  const row = rows.find((r) => r.ref === input.deviceRef);
  if (!row) return { ok: false, reason: "Not a lock in the live device list" };
  if (!row.decision.allowed) return { ok: false, reason: row.decision.reason };
  const { target, decision } = row;
  const experimental = Boolean(decision.experimental);
  if (experimental) {
    const refused = await checkConfirmation(input.confirm, { uid: input.uid, actor: input.actor }, { action: "device.experiment", deviceRef: input.deviceRef });
    if (refused) return { ok: false, reason: refused };
  }

  const db = await getDb();
  const [{ id }] = await db
    .insert(providerJobs)
    .values({
      createdAt: new Date(),
      actor: input.actor,
      kind,
      jobType: decision.jobType,
      deviceId: target.device.deviceId,
      bridgeId: decision.bridgeId,
      state: "requested",
      pinFingerprint: pinFingerprint(jobData.pin, getWebhookConfig().fingerprintKey),
      experimental,
    })
    .returning({ id: providerJobs.id });
  if (experimental) await audit(input.actor, "device.experiment", input.deviceRef, `${kind === "pin_create" ? "Create custom PIN (job 4)" : "Delete PIN (job 5)"} on ${target.kind} · job #${id} · ${input.confirm!.reason.trim()}`);
  try {
    const created = await api.createPinJob(
      target.device.deviceId,
      decision.bridgeId,
      kind === "pin_create" ? { jobType: 4, jobData } : { jobType: 5, jobData: { pin: jobData.pin } },
    );
    await db.update(providerJobs).set({ state: "queued", providerJobId: created.jobId, httpStatus: 200 }).where(eq(providerJobs.id, id));
    // Plan F4: keep the PIN (encrypted) once igloohome accepted the job; a delete marks matching vault entries.
    if (kind === "pin_create") {
      const data = jobData as CustomPinJobData;
      await storePin({ deviceId: target.device.deviceId, kind: "custom", pinType: String(data.pinType), pin: data.pin, accessName: data.accessName, startAt: data.startDate, endAt: data.endDate, createJobId: id, actor: input.actor });
    } else {
      await markRevoking(target.device.deviceId, jobData.pin, id, input.actor);
    }
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

export async function createCustomPin(input: {
  deviceRef: string;
  draft: CustomPinDraft;
  caller: Caller;
  actor: string;
  confirm?: Confirmation;
  uid?: number;
}): Promise<PinJobResult> {
  const rows = await decide("pin_create", input.caller);
  const tz = rows?.find((r) => r.ref === input.deviceRef)?.timeZone ?? "Asia/Jakarta";
  const check = checkCustomPin(input.draft, { now: Date.now(), timeZone: tz });
  if (!check.jobData) return { ok: false, reason: "The request breaks a custom PIN rule", fieldErrors: check.errors };
  const data = Object.fromEntries(Object.entries(check.jobData).filter(([, v]) => v !== undefined)) as typeof check.jobData;
  return send("pin_create", input, data);
}

export async function deletePin(input: { deviceRef: string; pin: string; caller: Caller; actor: string; confirm?: Confirmation; uid?: number }): Promise<PinJobResult> {
  const check = checkDeletePin(input.pin);
  if (check.error) return { ok: false, reason: check.error, fieldErrors: { pin: check.error } };
  return send("pin_delete", input, { pin: input.pin });
}
