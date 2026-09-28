import type { DeviceKind } from "@/server/domain/models";

// Device registry vocabulary (plan F7), shared by the server and the Manage page.

export type SpaceKind = "cabin" | "room";
export type DeviceRole = "door_lock" | "bed_lock" | "keypad" | "switch" | "bridge";

export const SPACE_KINDS: SpaceKind[] = ["cabin", "room"];
export const DEVICE_ROLES: Record<DeviceRole, string> = {
  door_lock: "Door lock",
  bed_lock: "Bed lock",
  keypad: "Keypad",
  switch: "Switch",
  bridge: "Bridge",
};

export function defaultRole(kind: DeviceKind): DeviceRole {
  if (kind === "bridge" || kind === "keypad" || kind === "switch") return kind;
  return "door_lock";
}
