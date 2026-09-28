import { describe, expect, test } from "bun:test";

import { filterSpaces, parseWatch, summarize } from "@/lib/space-summary";
import type { RoomView } from "@/server/application/dashboard";

// Compact Devices rows (plan F7b): summary, filters and the watch list.

const bridge = (id: string, online?: boolean) =>
  ({ id, name: `bridge-${id}`, kind: "bridge", linked: [], status: online === undefined ? undefined : { online, since: "2026-09-27T01:00:00Z" } }) as unknown as RoomView["bridges"][number];
const lock = (id: string, battery?: number) => ({ id, name: `lock-${id}`, kind: "lock", batteryPercent: battery, managed: { status: "enabled" } }) as unknown as RoomView["devices"][number];
const room = (id: number, name: string, kind: "cabin" | "room", bridges: RoomView["bridges"], devices: RoomView["devices"]): RoomView => ({
  id: `space-${id}`,
  spaceId: id,
  name,
  kind,
  bridges,
  devices,
});

describe("space summary", () => {
  const rows = [
    summarize(room(1, "Cabin A-01", "cabin", [bridge("b1", true)], [lock("l1", 80)]), { l1: { label: "Unlocked with PIN", tone: "access", occurredAt: "2026-09-27T02:00:00Z" } }),
    summarize(room(2, "Cabin A-02", "cabin", [bridge("b2", false)], [lock("l2", 12)]), {}),
    summarize(room(3, "Room 101", "room", [], []), {}),
  ];

  test("rows carry the latest event and what needs attention", () => {
    expect(rows[0]).toMatchObject({ devices: 1, lastEvent: { label: "Unlocked with PIN", device: "lock-l1" }, attention: [] });
    expect(rows[1].attention).toEqual(["1 Bridge offline", "1 low battery"]);
    expect(rows[2].attention).toEqual(["No Bridge"]);
  });

  test("filters by text, kind, Bridge status and attention", () => {
    const names = (f: Parameters<typeof filterSpaces>[1]) => filterSpaces(rows, f).map((r) => r.name);
    expect(names({ q: "a-0" })).toEqual(["Cabin A-01", "Cabin A-02"]);
    expect(names({ q: "lock-l2" })).toEqual(["Cabin A-02"]); // device names are searchable
    expect(names({ kind: "room" })).toEqual(["Room 101"]);
    expect(names({ bridge: "online" })).toEqual(["Cabin A-01"]);
    expect(names({ bridge: "offline" })).toEqual(["Cabin A-02"]);
    expect(names({ bridge: "none" })).toEqual(["Room 101"]);
    expect(names({ attention: true })).toEqual(["Cabin A-02", "Room 101"]);
  });

  test("the watch list keeps known ids only, without duplicates, capped and sorted", () => {
    expect(parseWatch("5,2,x,2,9,3", [2, 3, 5, 7], 3)).toEqual([2, 3, 5]);
    expect(parseWatch("7,5,3,2", [2, 3, 5, 7], 2)).toEqual([5, 7]);
    expect(parseWatch(undefined, [1], 3)).toEqual([]);
  });
});
