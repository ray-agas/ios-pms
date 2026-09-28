import { describe, expect, test } from "bun:test";

import {
  adoptBundle,
  adoptDevice,
  bundleOf,
  backfillFromAccount,
  createSpace,
  deleteSpace,
  importAllowlist,
  listManaged,
  listSpaces,
  managedAllowlist,
  removeManaged,
  updateManaged,
} from "@/server/application/device-registry";
import { checkAlgoPinIssue, checkHealthCheck } from "@/server/application/safety";
import type { VendorDevice } from "@/server/igloohome/schemas";
import { listAudit } from "@/server/users";

import { openTestDb } from "../helpers/db";

// Device registry (plan F7) on PGlite: the registry is the allowlist, changes are audited, the env list is imported once.

const LOCK = "IGB401lock01";
const BRIDGE = "EB1X01bridge";
const NOW = new Date("2026-09-27T10:00:00Z");

const guard = (allowlist: string[]) =>
  checkHealthCheck({ role: "super_admin", enabled: true, allowlist, kind: "lock_battery", device: { id: LOCK, kind: "lock" }, bridgeId: BRIDGE, recentJobs: [], now: NOW });

describe("device registry", () => {
  test("the env allowlist is imported once, then never again (even after removing everything)", async () => {
    const db = await openTestDb();
    expect(await importAllowlist([LOCK, BRIDGE, LOCK], db)).toBe(2);
    expect((await managedAllowlist(db)).sort()).toEqual([BRIDGE, LOCK]);
    for (const row of await listManaged(db)) await removeManaged(row.id, "root", db);
    expect(await importAllowlist([LOCK, BRIDGE], db)).toBe("done_before");
    expect(await managedAllowlist(db)).toEqual([]);
  });

  test("guards refuse unmanaged and disabled devices; enabled ones pass", async () => {
    const db = await openTestDb();
    expect(guard(await managedAllowlist(db))).toMatchObject({ allowed: false, reason: expect.stringContaining("not managed by iot-pms") });

    await adoptDevice({ deviceId: LOCK, kind: "lock" }, "root", db);
    expect(guard(await managedAllowlist(db))).toMatchObject({ allowed: false, reason: expect.stringContaining("Bridge is not managed") });
    await adoptDevice({ deviceId: BRIDGE, kind: "bridge" }, "root", db);
    expect(guard(await managedAllowlist(db))).toMatchObject({ allowed: true });

    const lock = (await listManaged(db)).find((m) => m.deviceId === LOCK)!;
    await updateManaged(lock.id, { status: "disabled" }, "root", db);
    expect(guard(await managedAllowlist(db))).toMatchObject({ allowed: false });
    expect(
      checkAlgoPinIssue({ role: "super_admin", enabled: true, allowlist: await managedAllowlist(db), deviceId: LOCK, algoPinCapable: true, grantedScopes: [] }),
    ).toMatchObject({ allowed: false });
  });

  test("adding, moving, disabling and removing are audited with display IDs only", async () => {
    const db = await openTestDb();
    expect(await createSpace({ name: "Cabin A-01", kind: "cabin" }, "root", db)).toEqual({ ok: true });
    const [cabin] = await listSpaces(db);
    expect(await adoptDevice({ deviceId: LOCK, kind: "lock", spaceId: cabin.id }, "root", db)).toEqual({ ok: true });
    expect(await adoptDevice({ deviceId: LOCK, kind: "lock" }, "root", db)).toEqual({ ok: false, reason: "This device is already managed" });
    const [row] = await listManaged(db);
    expect(row).toMatchObject({ role: "door_lock", status: "enabled", spaceId: cabin.id, addedBy: "root" });

    await updateManaged(row.id, { spaceId: null, role: "bed_lock" }, "root", db);
    await updateManaged(row.id, { status: "disabled" }, "root", db);
    await removeManaged(row.id, "root", db);

    const events = await listAudit(20, db);
    expect(events.map((e) => e.action)).toEqual(["device.remove", "device.update", "device.update", "device.add", "space.create"]);
    expect(events.find((e) => e.action === "device.add")?.detail).toBe("cabin Cabin A-01");
    expect(JSON.stringify(events)).not.toContain(LOCK); // full device IDs never reach the audit panel
  });

  test("spaces: cabin or room only, names unique ignoring case, only empty ones can be deleted", async () => {
    const db = await openTestDb();
    expect(await createSpace({ name: "Room 101", kind: "room" }, "root", db)).toEqual({ ok: true });
    expect(await createSpace({ name: "room 101", kind: "cabin" }, "root", db)).toMatchObject({ ok: false });
    expect(await createSpace({ name: "Loft", kind: "suite" as never }, "root", db)).toMatchObject({ ok: false, reason: "Kind must be cabin or room" });
    expect(await createSpace({ name: "Pod", kind: "cabin", timeZone: "Mars/Olympus" }, "root", db)).toMatchObject({ ok: false, reason: "Unknown time zone" });

    const [room] = await listSpaces(db);
    await adoptDevice({ deviceId: LOCK, kind: "lock", spaceId: room.id }, "root", db);
    expect(await deleteSpace(room.id, "root", db)).toMatchObject({ ok: false, reason: "Move or remove its 1 device first" });
    await removeManaged((await listManaged(db))[0].id, "root", db);
    expect(await deleteSpace(room.id, "root", db)).toEqual({ ok: true });
  });

  test("imported rows get name, kind, model and role from the live device list", async () => {
    const db = await openTestDb();
    await importAllowlist([BRIDGE], db);
    await backfillFromAccount([{ deviceId: BRIDGE, deviceName: "bridge-lab", type: "Bridge", linkedDevices: [] } as unknown as VendorDevice], db);
    expect((await listManaged(db))[0]).toMatchObject({ name: "bridge-lab", kind: "bridge", role: "bridge", addedBy: "import" });
  });

  test("a Bridge brings its linked devices and what a linked keypad reports, one level deep", () => {
    const d = (deviceId: string, type: string, links: string[] = []) =>
      ({ deviceId, type, linkedDevices: links.map((id) => ({ deviceId: id })) }) as unknown as VendorDevice;
    const devices = [
      d(BRIDGE, "Bridge", [LOCK, "EK2X01keypad"]),
      d("EK2X01keypad", "Keypad", ["IGB401lock02", BRIDGE]),
      d(LOCK, "Lock"),
      d("IGB401lock02", "Lock"),
      d("IGB401other", "Lock"),
    ];
    expect(bundleOf(BRIDGE, devices).map((x) => x.deviceId).sort()).toEqual(["EK2X01keypad", LOCK, "IGB401lock02"].sort());
    expect(bundleOf("missing", devices)).toEqual([]);
  });

  test("adopting a Bridge bundle adds new devices, moves managed ones, and warns on a second Bridge", async () => {
    const db = await openTestDb();
    await createSpace({ name: "Cabin A", kind: "cabin" }, "root", db);
    await createSpace({ name: "Cabin B", kind: "cabin" }, "root", db);
    const [a, b] = await listSpaces(db);
    await adoptDevice({ deviceId: LOCK, kind: "lock", spaceId: b.id }, "root", db); // already managed elsewhere

    const bridge = { deviceId: BRIDGE, kind: "bridge" as const, role: "bridge" as const, name: "bridge-a" };
    const linked = [
      { deviceId: LOCK, kind: "lock" as const, role: "door_lock" as const },
      { deviceId: "EK2X01keypad", kind: "keypad" as const, role: "keypad" as const },
    ];
    expect(await adoptBundle(bridge, linked, a.id, "root", db)).toEqual({ ok: true, added: 2, moved: 1, warning: undefined });
    const rows = await listManaged(db);
    expect(rows.every((r) => r.spaceId === a.id)).toBe(true);
    expect(rows).toHaveLength(3);
    expect(await adoptBundle(bridge, linked, a.id, "root", db)).toMatchObject({ ok: true, added: 0, moved: 0 }); // idempotent

    const second = await adoptBundle({ ...bridge, deviceId: "EB1X02bridge" }, [], a.id, "root", db);
    expect(second).toMatchObject({ ok: true, added: 1, warning: "Cabin A now has 2 Bridges" });
    expect(await adoptDevice({ deviceId: "EB1X03bridge", kind: "bridge", spaceId: a.id }, "root", db)).toMatchObject({ ok: true, warning: expect.stringContaining("3 Bridges") });
    expect(await adoptBundle({ ...linked[0] }, [], a.id, "root", db)).toEqual({ ok: false, reason: "Start from a Bridge" });

    const actions = (await listAudit(50, db)).map((e) => e.action);
    expect(actions.filter((x) => x === "space.adopt_bridge")).toHaveLength(3);
  });
});
