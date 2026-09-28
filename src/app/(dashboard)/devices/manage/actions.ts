"use server";

import { revalidatePath } from "next/cache";

import { actorOf, auth } from "@/auth";
import { DEVICE_ROLES, SPACE_KINDS, defaultRole, type DeviceRole, type SpaceKind } from "@/lib/device-roles";
import { igloohome, listAllDevicesOnce } from "@/server/application/dashboard";
import {
  adoptBundle,
  adoptDevice,
  bundleOf,
  createSpace,
  deleteSpace,
  listManaged,
  listSpaces,
  removeManaged,
  updateManaged,
  type BundleItem,
  type BundleResult,
  type RegistryResult,
} from "@/server/application/device-registry";
import { atLeast } from "@/server/domain/models";
import { toDeviceSnapshot } from "@/server/igloohome/mapping";
import type { VendorDevice } from "@/server/igloohome/schemas";
import { redactDeviceId } from "@/server/igloohome/redaction";
import { audit } from "@/server/users";

// Super-admin only (plan F7, Q9). Every action re-checks the session; the browser only ever sends display IDs.

async function superAdmin() {
  const session = await auth();
  return session?.user && atLeast(session.user.role, "super_admin") ? session : undefined;
}

const DENIED = { ok: false, reason: "Super-admin role required" } as const;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const role = (v: unknown) => (typeof v === "string" && v in DEVICE_ROLES ? (v as DeviceRole) : undefined);
const spaceId = (v: unknown) => (Number.isInteger(v) ? (v as number) : undefined);

function done(result: RegistryResult) {
  if (result.ok) revalidatePath("/devices");
  return result;
}

export async function createSpaceAction(input: { name: string; kind: SpaceKind; timeZone?: string; propertyId?: string }): Promise<RegistryResult> {
  const session = await superAdmin();
  if (!session) return DENIED;
  const kind = SPACE_KINDS.includes(input?.kind) ? input.kind : ("" as SpaceKind);
  return done(await createSpace({ name: str(input?.name), kind, timeZone: str(input?.timeZone) || undefined, propertyId: str(input?.propertyId) || undefined }, actorOf(session)));
}

export async function deleteSpaceAction(id: number): Promise<RegistryResult> {
  const session = await superAdmin();
  if (!session) return DENIED;
  return done(await deleteSpace(Number(id), actorOf(session)));
}

/** Adopts a device from the live igloohome list by its display ID; the full ID is resolved here, on the server. */
export async function adoptDeviceAction(input: { ref: string; spaceId?: number; role?: DeviceRole }): Promise<RegistryResult> {
  const session = await superAdmin();
  if (!session) return DENIED;
  const api = igloohome();
  if (!api) return { ok: false, reason: "igloohome credentials are not set" };
  const device = (await api.listAllDevices()).find((d) => redactDeviceId(d.deviceId) === str(input?.ref));
  if (!device) return { ok: false, reason: "Not on the igloohome account (pair it in the igloohome app first)" };
  const s = toDeviceSnapshot(device, new Date().toISOString());
  return done(
    await adoptDevice(
      { deviceId: device.deviceId, name: s.name, kind: s.kind, model: s.modelName ?? s.modelPrefix, spaceId: spaceId(input?.spaceId), role: role(input?.role) },
      actorOf(session),
    ),
  );
}

export async function updateManagedAction(id: number, change: { spaceId?: number | null; role?: DeviceRole; status?: "enabled" | "disabled" }): Promise<RegistryResult> {
  const session = await superAdmin();
  if (!session) return DENIED;
  const safe = {
    spaceId: change?.spaceId === null ? null : spaceId(change?.spaceId),
    role: role(change?.role),
    status: change?.status === "enabled" || change?.status === "disabled" ? change.status : undefined,
  };
  return done(await updateManaged(Number(id), safe, actorOf(session)));
}

export async function removeManagedAction(id: number): Promise<RegistryResult> {
  const session = await superAdmin();
  if (!session) return DENIED;
  return done(await removeManaged(Number(id), actorOf(session)));
}

// --- Add by Bridge (plan F7b) ----------------------------------------------------------------

export interface BundlePreviewItem {
  ref: string;
  name?: string;
  kind: string;
  model?: string;
  role: DeviceRole;
  /** Name of the cabin or room it is already in; adding moves it. */
  managedIn?: string;
  managed: boolean;
}
export type BundlePreview = { ok: true; bridge: BundlePreviewItem; items: BundlePreviewItem[] } | { ok: false; reason: string };

function itemOf(device: VendorDevice): BundleItem {
  const s = toDeviceSnapshot(device, new Date().toISOString());
  return { deviceId: device.deviceId, name: s.name, kind: s.kind, model: s.modelName ?? s.modelPrefix, role: defaultRole(s.kind) };
}

async function loadBundle(ref: string) {
  const api = igloohome();
  if (!api) return undefined;
  const devices = await api.listAllDevices();
  const bridge = devices.find((d) => redactDeviceId(d.deviceId) === ref);
  if (!bridge) return undefined;
  return { bridge: itemOf(bridge), linked: bundleOf(bridge.deviceId, devices).map(itemOf) };
}

/** What adding this Bridge brings along, and where those devices are today. Read-only. */
export async function previewBridgeAction(ref: string): Promise<BundlePreview> {
  const session = await superAdmin();
  if (!session) return DENIED;
  const bundle = await loadBundle(str(ref));
  if (!bundle) return { ok: false, reason: "Bridge not on the igloohome account" };
  if (bundle.bridge.kind !== "bridge") return { ok: false, reason: "Start from a Bridge" };
  const [managed, spaces] = await Promise.all([listManaged(), listSpaces()]);
  const where = new Map(managed.map((m) => [m.deviceId, spaces.find((s) => s.id === m.spaceId)?.name ?? ""]));
  const view = (i: BundleItem): BundlePreviewItem => ({
    ref: redactDeviceId(i.deviceId),
    name: i.name,
    kind: i.kind,
    model: i.model,
    role: i.role,
    managed: where.has(i.deviceId),
    managedIn: where.get(i.deviceId) || undefined,
  });
  return { ok: true, bridge: view(bundle.bridge), items: bundle.linked.map(view) };
}

/** Adds the Bridge and the ticked linked devices (display IDs) to one cabin or room. */
export async function adoptBridgeAction(input: { ref: string; spaceId: number; include: string[]; roles?: Record<string, DeviceRole> }): Promise<BundleResult> {
  const session = await superAdmin();
  if (!session) return DENIED;
  const target = spaceId(input?.spaceId);
  if (target === undefined) return { ok: false, reason: "Choose a cabin or room" };
  const bundle = await loadBundle(str(input?.ref));
  if (!bundle) return { ok: false, reason: "Bridge not on the igloohome account" };
  const include = new Set(Array.isArray(input?.include) ? input.include.map(str) : []);
  const linked = bundle.linked
    .filter((i) => include.has(redactDeviceId(i.deviceId)))
    .map((i) => ({ ...i, role: role(input?.roles?.[redactDeviceId(i.deviceId)]) ?? i.role }));
  const result = await adoptBundle(bundle.bridge, linked, target, actorOf(session));
  if (result.ok) revalidatePath("/devices");
  return result;
}


/** Plan G1: the full igloohome device ID, for a super-admin, on request. Audited; never stored in the audit row. */
export async function revealDeviceIdAction(ref: string): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const session = await superAdmin();
  if (!session) return DENIED;
  const device = (await listAllDevicesOnce()).find((d) => redactDeviceId(d.deviceId) === str(ref));
  if (!device) return { ok: false, reason: "Not on the igloohome account" };
  await audit(actorOf(session), "device.reveal_id", redactDeviceId(device.deviceId));
  return { ok: true, id: device.deviceId };
}
