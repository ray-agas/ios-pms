"use server";

import { actorOf, auth } from "@/auth";
import type { AlgoPinDraft, AlgoPinType } from "@/lib/algopin-rules";
import type { CustomPinDraft, CustomPinType } from "@/lib/pin-job-rules";
import { issueAlgoPin, type IssueResult } from "@/server/application/access-codes";
import { createCustomPin, deletePin, type PinJobResult } from "@/server/application/pin-jobs";
import { listVault, pinForRevoke, revealPin, type VaultEntry } from "@/server/application/pin-vault";
import { callerOf } from "@/server/application/scopes";
import { checkConfirmation } from "@/server/application/step-up";
import { atLeast } from "@/server/domain/models";
import { redactDeviceId } from "@/server/igloohome/redaction";
import { audit } from "@/server/users";

const TYPES: AlgoPinType[] = ["onetime", "hourly", "daily", "permanent"];
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : NaN);
const str = (v: unknown) => (typeof v === "string" ? v : "");
/** G1: reason + password for experiments; rebuilt from primitives. */
const confirmOf = (c: unknown) => (c && typeof c === "object" ? { reason: str((c as { reason?: unknown }).reason), password: str((c as { password?: unknown }).password) } : undefined);

/** Operator only; flag, allowlist, algoPIN capability, scope and every algoPIN rule are re-checked in issueAlgoPin. */
export async function createAlgoPinAction(deviceRef: string, raw: AlgoPinDraft): Promise<IssueResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, reason: "Not signed in" };
  const type = TYPES.find((t) => t === raw?.type);
  if (!type) return { ok: false, reason: "Unknown algoPIN type" };
  // Rebuild from primitives: nothing else from the browser reaches the use case.
  const draft: AlgoPinDraft = {
    type,
    accessName: str(raw.accessName),
    variance: int(raw.variance),
    startDate: str(raw.startDate),
    startHour: int(raw.startHour),
    endDate: type === "hourly" || type === "daily" ? str(raw.endDate) : undefined,
    endHour: type === "hourly" ? int(raw.endHour) : undefined,
  };
  return issueAlgoPin({ deviceRef: str(deviceRef), draft, caller: await callerOf(session.user.role, session.user.uid), actor: session.user.email ?? session.user.name ?? "unknown" });
}


const PIN_TYPES: CustomPinType[] = [1, 2, 4];

/** Bridge job 4. Operator only; flag, allowlist, Bridge link, scope and rules are re-checked in createCustomPin. */
export async function createCustomPinAction(deviceRef: string, raw: CustomPinDraft, confirm?: { reason: string; password: string }): Promise<PinJobResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, reason: "Not signed in" };
  const pinType = PIN_TYPES.find((t) => t === raw?.pinType);
  if (!pinType) return { ok: false, reason: "Unknown PIN type" };
  const draft: CustomPinDraft = {
    accessName: str(raw.accessName),
    pin: str(raw.pin),
    pinType,
    startNow: raw.startNow === true,
    startDate: str(raw.startDate),
    startHour: int(raw.startHour),
    endDate: pinType === 4 ? str(raw.endDate) : undefined,
    endHour: pinType === 4 ? int(raw.endHour) : undefined,
  };
  return createCustomPin({
    deviceRef: str(deviceRef),
    draft,
    caller: await callerOf(session.user.role, session.user.uid),
    actor: session.user.email ?? session.user.name ?? "unknown",
    confirm: confirmOf(confirm),
    uid: session.user.uid,
  });
}

/** Bridge job 5. The PIN is typed by the operator (iot-pms never stores PINs). */
export async function deletePinAction(deviceRef: string, pin: string, confirm?: { reason: string; password: string }): Promise<PinJobResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, reason: "Not signed in" };
  return deletePin({
    deviceRef: str(deviceRef),
    pin: str(pin),
    caller: await callerOf(session.user.role, session.user.uid),
    actor: session.user.email ?? session.user.name ?? "unknown",
    confirm: confirmOf(confirm),
    uid: session.user.uid,
  });
}

// --- PIN vault (plan F4): super-admin only; every reveal and revoke is audited ------------------------

async function superAdmin() {
  const session = await auth();
  return session?.user && atLeast(session.user.role, "super_admin") ? session : undefined;
}

export async function revealPinAction(id: number): Promise<{ ok: true; pin: string } | { ok: false; reason: string }> {
  const session = await superAdmin();
  if (!session) return { ok: false, reason: "Super-admin role required" };
  return revealPin(Number(id), actorOf(session));
}

/** Decrypts the stored PIN and sends Delete PIN (job 5) through the normal guarded job flow. Irreversible, so it
 * always takes a reason and the person's password (G1: the same step-up as other risky jobs). */
export async function revokePinAction(id: number, rawConfirm?: { reason: string; password: string }): Promise<PinJobResult> {
  const session = await superAdmin();
  if (!session) return { ok: false, reason: "Super-admin role required" };
  const confirm = confirmOf(rawConfirm);
  const refused = await checkConfirmation(confirm, { uid: session.user.uid, actor: actorOf(session) }, { action: "pin.revoke", deviceRef: `vault #${Number(id)}` });
  if (refused) return { ok: false, reason: refused };
  const stored = await pinForRevoke(Number(id)).catch(() => undefined);
  if (!stored) return { ok: false, reason: "This PIN is not in the vault or cannot be decrypted" };
  if (stored.row.revokeJobId) return { ok: false, reason: "A delete was already sent for this PIN" };
  const result = await deletePin({
    deviceRef: redactDeviceId(stored.row.deviceId),
    pin: stored.pin,
    caller: await callerOf(session.user.role, session.user.uid),
    actor: actorOf(session),
    confirm,
    uid: session.user.uid,
  });
  await audit(
    actorOf(session),
    "pin.revoke",
    redactDeviceId(stored.row.deviceId),
    `vault #${stored.row.id}${result.ok ? ` · job #${result.id}` : ` · refused: ${result.reason}`} · ${confirm!.reason.trim()}`,
  );
  return result;
}


/** Vault list without PINs, for live status while a revoke or a new PIN waits for the lock. Any signed-in user. */
export async function vaultStatusesAction(): Promise<VaultEntry[]> {
  const session = await auth();
  if (!session?.user) return [];
  return listVault();
}
