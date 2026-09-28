import "server-only";

import { and, asc, count, eq, sql } from "drizzle-orm";

import { DEVICE_ROLES, SPACE_KINDS, defaultRole, type DeviceRole, type SpaceKind } from "@/lib/device-roles";

import type { DeviceKind } from "../domain/models";
import { toDeviceSnapshot } from "../igloohome/mapping";
import type { VendorDevice } from "../igloohome/schemas";
import { redactDeviceId } from "../igloohome/redaction";
import { getDb, isUniqueViolation, type Db } from "../storage/db";
import { auditEvents, managedDevices, spaces } from "../storage/schema";
import { audit } from "../users";

// Device registry (plan F7): cabins and rooms, and the devices iot-pms manages. Enabled devices are the allowlist
// every safety guard reads. Changes are super-admin only (Q9; checked in the server actions) and always audited.
// Audit targets carry display IDs only: the audit panel is shown in the browser.

export type ManagedRow = typeof managedDevices.$inferSelect;
export type { DeviceRole, SpaceKind };

export type RegistryResult = { ok: true; warning?: string } | { ok: false; reason: string };

/** Full IDs of enabled managed devices: the allowlist for health checks, PIN jobs and algoPINs. */
export async function managedAllowlist(db?: Db): Promise<string[]> {
  const rows = await (db ?? (await getDb()))
    .select({ deviceId: managedDevices.deviceId })
    .from(managedDevices)
    .where(eq(managedDevices.status, "enabled"));
  return rows.map((r) => r.deviceId);
}

export async function listManaged(db?: Db): Promise<ManagedRow[]> {
  return (db ?? (await getDb())).select().from(managedDevices).orderBy(asc(managedDevices.id));
}

export async function listSpaces(db?: Db) {
  const d = db ?? (await getDb());
  return d
    .select({
      id: spaces.id,
      name: spaces.name,
      kind: spaces.kind,
      propertyId: spaces.propertyId,
      timeZone: spaces.timeZone,
      notes: spaces.notes,
      devices: count(managedDevices.id),
    })
    .from(spaces)
    .leftJoin(managedDevices, eq(managedDevices.spaceId, spaces.id))
    .groupBy(spaces.id)
    .orderBy(sql`lower(${spaces.name})`);
}
export type SpaceRow = Awaited<ReturnType<typeof listSpaces>>[number];

export async function createSpace(
  input: { name: string; kind: SpaceKind; propertyId?: string; timeZone?: string; notes?: string },
  actor: string,
  db?: Db,
): Promise<RegistryResult> {
  const d = db ?? (await getDb());
  const name = input.name.trim();
  if (name.length < 1 || name.length > 60) return { ok: false, reason: "Name: 1–60 characters" };
  if (!SPACE_KINDS.includes(input.kind)) return { ok: false, reason: "Kind must be cabin or room" };
  if (input.timeZone && !validTimeZone(input.timeZone)) return { ok: false, reason: "Unknown time zone" };
  try {
    await d.insert(spaces).values({
      name,
      kind: input.kind,
      propertyId: input.propertyId || null,
      timeZone: input.timeZone || null,
      notes: input.notes?.trim() || null,
      createdBy: actor,
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: `A cabin or room named "${name}" already exists` };
    throw error;
  }
  await audit(actor, "space.create", name, input.kind, d);
  return { ok: true };
}

/** Only an empty space can be deleted, so no device silently loses its place. */
export async function deleteSpace(id: number, actor: string, db?: Db): Promise<RegistryResult> {
  const d = db ?? (await getDb());
  const [space] = await d.select().from(spaces).where(eq(spaces.id, id));
  if (!space) return { ok: false, reason: "No such cabin or room" };
  const [{ n }] = await d.select({ n: count() }).from(managedDevices).where(eq(managedDevices.spaceId, id));
  if (n > 0) return { ok: false, reason: `Move or remove its ${n} device${n === 1 ? "" : "s"} first` };
  await d.delete(spaces).where(eq(spaces.id, id));
  await audit(actor, "space.delete", space.name, space.kind, d);
  return { ok: true };
}

/** Adopts a device that is already paired in the igloohome app (the REST API has no pairing call). */
export async function adoptDevice(
  input: { deviceId: string; name?: string; kind?: DeviceKind; model?: string; spaceId?: number; role?: DeviceRole },
  actor: string,
  db?: Db,
): Promise<RegistryResult> {
  const d = db ?? (await getDb());
  if (input.role && !(input.role in DEVICE_ROLES)) return { ok: false, reason: "Unknown device role" };
  if (input.spaceId !== undefined && !(await spaceExists(d, input.spaceId))) return { ok: false, reason: "No such cabin or room" };
  try {
    await d.insert(managedDevices).values({
      deviceId: input.deviceId,
      name: input.name ?? null,
      kind: input.kind ?? null,
      model: input.model ?? null,
      spaceId: input.spaceId ?? null,
      role: input.role ?? (input.kind ? defaultRole(input.kind) : null),
      addedBy: actor,
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "This device is already managed" };
    throw error;
  }
  await audit(actor, "device.add", redactDeviceId(input.deviceId), await placeOf(d, input.spaceId), d);
  return { ok: true, warning: await bridgeWarning(d, input.kind, input.spaceId, input.deviceId) };
}

export type BundleItem = { deviceId: string; name?: string; kind: DeviceKind; model?: string; role: DeviceRole };
export type BundleResult = { ok: true; added: number; moved: number; warning?: string } | { ok: false; reason: string };

/**
 * Adds a Bridge and the devices linked to it to one cabin or room, in one transaction (plan F7b).
 * Devices already managed are moved here; nothing is duplicated. A space that already has another Bridge is
 * allowed, with a warning (a cabin may get several Bridges later).
 */
export async function adoptBundle(bridge: BundleItem, linked: BundleItem[], spaceId: number, actor: string, db?: Db): Promise<BundleResult> {
  const d = db ?? (await getDb());
  if (bridge.kind !== "bridge") return { ok: false, reason: "Start from a Bridge" };
  if (![bridge, ...linked].every((i) => i.role in DEVICE_ROLES)) return { ok: false, reason: "Unknown device role" };
  const [space] = await d.select().from(spaces).where(eq(spaces.id, spaceId));
  if (!space) return { ok: false, reason: "No such cabin or room" };

  const others = await otherBridgesIn(d, spaceId, bridge.deviceId);
  let added = 0;
  let moved = 0;
  await d.transaction(async (tx) => {
    for (const item of [bridge, ...linked]) {
      const [existing] = await tx.select().from(managedDevices).where(eq(managedDevices.deviceId, item.deviceId));
      if (existing) {
        if (existing.spaceId === spaceId) continue;
        await tx.update(managedDevices).set({ spaceId, updatedAt: sql`now()` }).where(eq(managedDevices.id, existing.id));
        await audit(actor, "device.update", redactDeviceId(item.deviceId), `moved to ${space.kind} ${space.name} (with its Bridge)`, tx as unknown as Db);
        moved++;
      } else {
        await tx.insert(managedDevices).values({ deviceId: item.deviceId, name: item.name ?? null, kind: item.kind, model: item.model ?? null, spaceId, role: item.role, addedBy: actor });
        await audit(actor, "device.add", redactDeviceId(item.deviceId), `${space.kind} ${space.name} (with its Bridge)`, tx as unknown as Db);
        added++;
      }
    }
    await audit(actor, "space.adopt_bridge", redactDeviceId(bridge.deviceId), `${space.kind} ${space.name}: ${added} added, ${moved} moved`, tx as unknown as Db);
  });
  return { ok: true, added, moved, warning: others ? `${space.name} now has ${others + 1} Bridges` : undefined };
}

async function bridgeWarning(d: Db, kind: string | null | undefined, spaceId: number | undefined, deviceId: string) {
  if (kind !== "bridge" || spaceId === undefined) return undefined;
  const others = await otherBridgesIn(d, spaceId, deviceId);
  return others ? `This cabin or room now has ${others + 1} Bridges` : undefined;
}

/**
 * What a Bridge brings along: its linked devices, plus devices linked to those (a keypad reports its lock), one
 * level deep. Links are reported on Bridge and keypad records, not on locks (EXP-20260925-01).
 */
export function bundleOf(bridgeId: string, devices: VendorDevice[]): VendorDevice[] {
  const byId = new Map(devices.map((d) => [d.deviceId, d]));
  const bridge = byId.get(bridgeId);
  if (!bridge) return [];
  const ids = new Set<string>();
  for (const link of bridge.linkedDevices) {
    if (!link.deviceId) continue;
    ids.add(link.deviceId);
    for (const next of byId.get(link.deviceId)?.linkedDevices ?? []) if (next.deviceId) ids.add(next.deviceId);
  }
  ids.delete(bridgeId);
  return [...ids].flatMap((id) => byId.get(id) ?? []);
}

/** Enabled or disabled Bridges already placed in the space, other than `exceptDeviceId`. */
async function otherBridgesIn(d: Db, spaceId: number, exceptDeviceId?: string) {
  const [{ n }] = await d
    .select({ n: count() })
    .from(managedDevices)
    .where(and(eq(managedDevices.spaceId, spaceId), eq(managedDevices.kind, "bridge"), exceptDeviceId ? sql`${managedDevices.deviceId} <> ${exceptDeviceId}` : undefined));
  return n;
}

/** Move to another space (null = none), change the role, enable or disable. */
export async function updateManaged(
  id: number,
  change: { spaceId?: number | null; role?: DeviceRole; status?: "enabled" | "disabled" },
  actor: string,
  db?: Db,
): Promise<RegistryResult> {
  const d = db ?? (await getDb());
  const [row] = await d.select().from(managedDevices).where(eq(managedDevices.id, id));
  if (!row) return { ok: false, reason: "No such managed device" };
  if (change.role && !(change.role in DEVICE_ROLES)) return { ok: false, reason: "Unknown device role" };
  if (change.status && change.status !== "enabled" && change.status !== "disabled") return { ok: false, reason: "Unknown status" };
  if (typeof change.spaceId === "number" && !(await spaceExists(d, change.spaceId))) return { ok: false, reason: "No such cabin or room" };
  await d
    .update(managedDevices)
    .set({ spaceId: change.spaceId, role: change.role, status: change.status, updatedAt: sql`now()` }) // undefined = unchanged
    .where(eq(managedDevices.id, id));
  const what = [
    change.spaceId !== undefined && `moved to ${await placeOf(d, change.spaceId ?? undefined)}`,
    change.role && `role ${change.role}`,
    change.status && `status ${change.status}`,
  ]
    .filter(Boolean)
    .join(", ");
  await audit(actor, "device.update", redactDeviceId(row.deviceId), what, d);
  return { ok: true, warning: typeof change.spaceId === "number" ? await bridgeWarning(d, row.kind, change.spaceId, row.deviceId) : undefined };
}

/** Stops managing a device. Nothing changes on igloohome; guards refuse it from now on. */
export async function removeManaged(id: number, actor: string, db?: Db): Promise<RegistryResult> {
  const d = db ?? (await getDb());
  const [row] = await d.delete(managedDevices).where(eq(managedDevices.id, id)).returning();
  if (!row) return { ok: false, reason: "No such managed device" };
  await audit(actor, "device.remove", redactDeviceId(row.deviceId), undefined, d);
  return { ok: true };
}

/**
 * One-time hand-over from IGLOOHOME_ALLOWED_DEVICE_IDS (plan F7). Runs only while the registry has never been
 * imported, so removing every device later does not bring the env list back.
 */
export async function importAllowlist(ids: string[], db?: Db): Promise<number | "done_before"> {
  const d = db ?? (await getDb());
  const [{ n }] = await d.select({ n: count() }).from(auditEvents).where(eq(auditEvents.action, "registry.import"));
  if (n > 0) return "done_before";
  const unique = [...new Set(ids)];
  if (unique.length) {
    await d
      .insert(managedDevices)
      .values(unique.map((deviceId) => ({ deviceId, addedBy: "import" })))
      .onConflictDoNothing();
  }
  await audit("bootstrap", "registry.import", undefined, `${unique.length} device(s) from IGLOOHOME_ALLOWED_DEVICE_IDS`, d);
  return unique.length;
}

/** Fills name, kind, model and role for rows imported without them, from the live device list. */
export async function backfillFromAccount(devices: VendorDevice[], db?: Db) {
  const d = db ?? (await getDb());
  const missing = await d.select().from(managedDevices).where(sql`${managedDevices.kind} IS NULL`);
  for (const row of missing) {
    const device = devices.find((x) => x.deviceId === row.deviceId);
    if (!device) continue;
    const s = toDeviceSnapshot(device, new Date().toISOString());
    await d
      .update(managedDevices)
      .set({ name: s.name ?? null, kind: s.kind, model: s.modelName ?? s.modelPrefix, role: row.role ?? defaultRole(s.kind) })
      .where(and(eq(managedDevices.id, row.id), sql`${managedDevices.kind} IS NULL`));
  }
}

async function spaceExists(d: Db, id: number) {
  const [row] = await d.select({ id: spaces.id }).from(spaces).where(eq(spaces.id, id));
  return Boolean(row);
}

async function placeOf(d: Db, spaceId?: number) {
  if (spaceId === undefined) return "no cabin or room";
  const [row] = await d.select({ name: spaces.name, kind: spaces.kind }).from(spaces).where(eq(spaces.id, spaceId));
  return row ? `${row.kind} ${row.name}` : "no cabin or room";
}

function validTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
