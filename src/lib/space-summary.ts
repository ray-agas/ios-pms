import type { RoomView } from "@/server/application/dashboard";

// Compact cabin/room rows for the Devices page (plan F7b). Pure: built from the site view and the local event store,
// so a row costs no igloohome call.

export const LOW_BATTERY = 20;
export const PAGE_SIZE = 25;

export type LastEvent = { label: string; tone: string; occurredAt: string };

export interface SpaceSummary {
  id: string;
  spaceId?: number;
  name: string;
  kind?: RoomView["kind"];
  subtitle?: string;
  timezone?: string;
  bridges: { id: string; name?: string; online?: boolean; since?: string }[];
  devices: number;
  disabled: number;
  lowBattery: number;
  lastEvent?: LastEvent & { device: string };
  attention: string[];
  search: string;
}

export function summarize(room: RoomView, events: Record<string, LastEvent>): SpaceSummary {
  const all = [...room.bridges, ...room.devices];
  const lastEvent = all
    .flatMap((d) => (events[d.id] ? [{ ...events[d.id], device: d.name ?? d.id }] : []))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  const lowBattery = all.filter((d) => d.batteryPercent !== undefined && d.batteryPercent <= LOW_BATTERY).length;
  const offline = room.bridges.filter((b) => b.status?.online === false).length;
  const attention = [
    offline && `${offline} Bridge${offline === 1 ? "" : "s"} offline`,
    lowBattery && `${lowBattery} low battery`,
    room.kind && room.bridges.length === 0 && "No Bridge",
    room.bridges.length > 1 && `${room.bridges.length} Bridges`,
  ].filter((x): x is string => Boolean(x));
  return {
    id: room.id,
    spaceId: room.spaceId,
    name: room.name,
    kind: room.kind,
    subtitle: room.subtitle,
    timezone: room.timezone,
    bridges: room.bridges.map((b) => ({ id: b.id, name: b.name, online: b.status?.online, since: b.status?.since })),
    devices: room.devices.length,
    disabled: all.filter((d) => d.managed?.status === "disabled").length,
    lowBattery,
    lastEvent,
    attention,
    search: [room.name, room.subtitle, ...all.map((d) => d.name), ...all.map((d) => d.id)].filter(Boolean).join(" ").toLowerCase(),
  };
}

export interface SpaceFilter {
  q?: string;
  kind?: string; // cabin | room
  bridge?: string; // online | offline | none (no connection event yet)
  attention?: boolean;
}

export function filterSpaces(rows: SpaceSummary[], f: SpaceFilter): SpaceSummary[] {
  const q = f.q?.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !r.search.includes(q)) return false;
    if (f.kind && r.kind !== f.kind) return false;
    if (f.bridge === "online" && !r.bridges.some((b) => b.online === true)) return false;
    if (f.bridge === "offline" && !r.bridges.some((b) => b.online === false)) return false;
    if (f.bridge === "none" && !(r.bridges.length === 0 || r.bridges.every((b) => b.online === undefined))) return false;
    if (f.attention && r.attention.length === 0) return false;
    return true;
  });
}

/** Watch list from the URL: known, numeric space ids, first `max` only, sorted (a stable cache key). */
export function parseWatch(value: string | undefined, known: number[], max: number): number[] {
  const ids = (value ?? "").split(",").map(Number).filter((id) => Number.isInteger(id) && known.includes(id));
  return [...new Set(ids)].slice(0, max).sort((a, b) => a - b);
}
