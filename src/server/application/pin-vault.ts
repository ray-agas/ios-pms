import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { ALGOPIN_TYPES, type AlgoPinType } from "@/lib/algopin-rules";

import { getPinKey, getWebhookConfig } from "../config";
import { decryptPin, encryptPin, KEY_VERSION } from "../crypto/pin-cipher";
import { redactDeviceId } from "../igloohome/redaction";
import { pinFingerprint } from "../igloohome/webhooks";
import { getDb, iso, type Db } from "../storage/db";
import { pins } from "../storage/schema";
import { audit } from "../users";
import { firstUse, listAccessCodes } from "./access-codes";
import { getJob } from "./health-check";

// PIN vault (plan F4). Every PIN iot-pms creates is stored encrypted. Operators see it once, at creation; a
// super-admin can reveal any stored PIN and revoke it with one click (job 5). Reveals and revokes are audited.
// With no IOT_PMS_PIN_KEY the vault is off: nothing is stored (startup refuses that while PIN creation is on).

export const vaultEnabled = () => Boolean(getPinKey());

export interface StoreInput {
  deviceId: string;
  kind: "algopin" | "custom";
  pinType: string;
  pin: string;
  accessName?: string;
  startAt?: string;
  endAt?: string;
  accessCodeId?: number;
  createJobId?: number;
  actor: string;
}

/** Called right after igloohome accepted a PIN. A vault failure never undoes the PIN: it is logged instead. */
export async function storePin(input: StoreInput, db?: Db): Promise<number | undefined> {
  const key = getPinKey();
  if (!key) return undefined;
  try {
    const [row] = await (db ?? (await getDb()))
      .insert(pins)
      .values({
        createdBy: input.actor,
        deviceId: input.deviceId,
        kind: input.kind,
        pinType: input.pinType,
        accessName: input.accessName ?? null,
        startAt: input.startAt ?? null,
        endAt: input.endAt ?? null,
        ciphertext: encryptPin(input.pin, input.deviceId, key),
        keyVersion: KEY_VERSION,
        fingerprint: pinFingerprint(input.pin, getWebhookConfig().fingerprintKey),
        accessCodeId: input.accessCodeId ?? null,
        createJobId: input.createJobId ?? null,
      })
      .returning({ id: pins.id });
    return row.id;
  } catch (error) {
    console.error("[iot-pms] PIN vault insert failed (the PIN itself was created):", (error as Error).message);
    return undefined;
  }
}

/** A delete job (typed or from the vault) was accepted: link it to every stored, not yet revoked PIN it matches. */
export async function markRevoking(deviceId: string, pin: string, revokeJobId: number, actor: string, db?: Db) {
  if (!vaultEnabled()) return;
  const fingerprint = pinFingerprint(pin, getWebhookConfig().fingerprintKey);
  await (db ?? (await getDb()))
    .update(pins)
    .set({ revokeJobId, revokedBy: actor, revokedAt: new Date() })
    .where(and(eq(pins.deviceId, deviceId), eq(pins.fingerprint, fingerprint), isNull(pins.revokeJobId)));
}

/** Decrypts one stored PIN. The caller must be a super-admin (checked in the action). Audited. */
export async function revealPin(id: number, actor: string, db?: Db): Promise<{ ok: true; pin: string } | { ok: false; reason: string }> {
  const key = getPinKey();
  if (!key) return { ok: false, reason: "The PIN vault is off (IOT_PMS_PIN_KEY is not set)" };
  const d = db ?? (await getDb());
  const [row] = await d.select().from(pins).where(eq(pins.id, id));
  if (!row) return { ok: false, reason: "No such PIN" };
  try {
    const pin = decryptPin(row.ciphertext, row.deviceId, key);
    await audit(actor, "pin.reveal", redactDeviceId(row.deviceId), `vault #${row.id} ${row.accessName ?? ""}`.trim(), d);
    return { ok: true, pin };
  } catch {
    return { ok: false, reason: "This PIN cannot be decrypted with the current key" };
  }
}

/** Server-side only: the PIN and device for a revoke (job 5). */
export async function pinForRevoke(id: number, db?: Db) {
  const key = getPinKey();
  if (!key) return undefined;
  const [row] = await (db ?? (await getDb())).select().from(pins).where(eq(pins.id, id));
  if (!row) return undefined;
  return { row, pin: decryptPin(row.ciphertext, row.deviceId, key) };
}

export type VaultStatus = "pending" | "active" | "upcoming" | "needs_activation" | "used" | "expired" | "previously_deleted" | "failed" | "revoking" | "revoked" | "revoke_failed" | "unknown";

export interface VaultEntry {
  id: number;
  createdAt: string;
  createdBy: string;
  deviceRef: string;
  kind: "algopin" | "custom";
  typeLabel: string;
  accessName?: string;
  startAt?: string;
  endAt?: string;
  status: VaultStatus;
  /** Why the status is what it is, in plain words (shown on hover). */
  statusNote?: string;
  revokedBy?: string;
  revokedAt?: string;
  revokeJobId?: number;
}

const CUSTOM_TYPE: Record<string, string> = { "1": "One-time custom", "2": "Permanent custom", "4": "Duration custom" };

/** The vault list (no PINs in it). ponytail: one job lookup per row; batch it if the vault grows past a few hundred. */
export async function listVault(limit = 100, db?: Db): Promise<VaultEntry[]> {
  const d = db ?? (await getDb());
  const rows = await d.select().from(pins).orderBy(desc(pins.id)).limit(limit);
  const codes = rows.some((r) => r.accessCodeId) ? new Map((await listAccessCodes(200)).map((c) => [c.id, c])) : new Map();
  const now = Date.now();

  return Promise.all(
    rows.map(async (r): Promise<VaultEntry> => {
      let status: VaultStatus = "unknown";
      let statusNote: string | undefined;
      // One-time custom PINs are used up by their first successful entry (EXP-20260926-04 R1).
      const used = r.kind === "custom" && r.pinType === "1" ? await firstUse(r.fingerprint, { deviceId: r.deviceId, since: r.createdAt }) : undefined;
      if (r.revokeJobId) {
        const job = await getJob(r.revokeJobId);
        const result = job?.webhook?.jobStatus;
        // Delete result 3 (PIN not on the lock) still releases the PIN at igloohome (EXP-20260926-04 R3).
        status = result === 0 || result === 3 ? "revoked" : job?.state === "rejected" || (result !== undefined && result !== 2) ? "revoke_failed" : "revoking";
        if (result === 3) statusNote = used ? "It had already been used once on the lock; igloohome released it (delete result 3)." : "The lock no longer had this PIN; igloohome released it anyway (delete result 3).";
        else if (result === 0) statusNote = "The lock confirmed the delete (result 0).";
        else if (status === "revoke_failed") statusNote = job?.errorMessage ?? job?.webhook?.meaning ?? "The delete did not complete.";
        else statusNote = "Delete sent; waiting for the lock through the Bridge.";
      } else if (used) {
        status = "used";
        statusNote = `One-time PIN, used on the lock at ${new Date(used.at).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" })}.`;
      } else if (r.kind === "algopin") {
        const code = r.accessCodeId ? codes.get(r.accessCodeId) : undefined;
        // A delete from the device is a revoke, not an expiry; "same PIN deleted before" keeps its own status.
        status = code
          ? code.status === "deleted"
            ? "revoked"
            : code.status === "activation_missed"
              ? "expired"
              : code.status === "rejected"
                ? "failed"
                : (code.status as VaultStatus)
          : "unknown";
        statusNote = code?.statusNote;
      } else {
        const job = r.createJobId ? await getJob(r.createJobId) : undefined;
        const result = job?.webhook?.jobStatus;
        const ended = r.endAt ? Date.parse(r.endAt) < now : false;
        // No result by the end of the job window: the PIN never reached the device (e.g. a switch, G1).
        const noResult = result === undefined && job !== undefined && (job.state === "expired" || now > Date.parse(job.pollUntil));
        status =
          result === 0 ? (ended ? "expired" : "active") : job?.state === "rejected" || noResult || (result !== undefined && result !== 2) ? "failed" : "pending";
        if (noResult) statusNote = "Never reached the device: no result from the Bridge job. It is not on the device, so there is nothing to revoke.";
        else if (status === "failed") statusNote = job?.errorMessage ?? job?.webhook?.meaning ?? "The device did not accept the PIN.";
      }
      return {
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        createdBy: r.createdBy,
        deviceRef: redactDeviceId(r.deviceId),
        kind: r.kind,
        typeLabel: r.kind === "algopin" ? `algoPIN ${ALGOPIN_TYPES[r.pinType as AlgoPinType]?.label.toLowerCase() ?? r.pinType}` : (CUSTOM_TYPE[r.pinType] ?? `Custom ${r.pinType}`),
        accessName: r.accessName ?? undefined,
        startAt: r.startAt ?? undefined,
        endAt: r.endAt ?? undefined,
        status,
        statusNote,
        revokedBy: r.revokedBy ?? undefined,
        revokedAt: iso(r.revokedAt),
        revokeJobId: r.revokeJobId ?? undefined,
      };
    }),
  );
}
