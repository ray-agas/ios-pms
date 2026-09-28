import { atLeast, type Role } from "@/server/domain/models";

// igloohome API scopes (plan F3). The 18 documented in docs/research/igloohome/03-auth-and-accounts.md §3 (DOC), plus
// two that server-health reports as granted (E21);
// the 28 on the iglooworks pages belong to a different API. Shared by the server and the People screen.

export type ScopeGroup = "read" | "bridge_jobs" | "credentials" | "physical" | "other";

export interface ScopeInfo {
  scope: string;
  label: string;
  group: ScopeGroup;
  /** What iot-pms uses it for; undefined = iot-pms has no feature for it (assigning it grants nothing here). */
  usedFor?: string;
}

const s = (name: string) => `igloohomeapi/${name}`;

export const SCOPES: ScopeInfo[] = [
  { scope: s("get-devices"), label: "Read devices", group: "read", usedFor: "Device lists and details" },
  { scope: s("get-properties"), label: "Read properties", group: "read", usedFor: "Properties and time zones" },
  { scope: s("get-job-status"), label: "Read job status", group: "read", usedFor: "Polling Bridge jobs" },
  { scope: s("get-device-activity"), label: "Read activity history", group: "read", usedFor: "Try it: activity history" },
  { scope: s("get-battery-level-bridge-proxied-job"), label: "Battery check (job 9)", group: "bridge_jobs", usedFor: "Health check: lock battery" },
  { scope: s("get-device-status-bridge-proxied-job"), label: "Status check (job 10)", group: "bridge_jobs", usedFor: "Health check: lock status, Bridge diagnostics" },
  { scope: s("get-activity-logs-bridge-proxied-job"), label: "Pull activity logs (job 15)", group: "bridge_jobs", usedFor: "Try it: pull activity logs (super-admin; deletes them from the lock)" },
  { scope: s("algopin-onetime"), label: "algoPIN one-time", group: "credentials", usedFor: "Access: one-time algoPIN" },
  { scope: s("algopin-hourly"), label: "algoPIN hourly", group: "credentials", usedFor: "Access: hourly algoPIN" },
  { scope: s("algopin-daily"), label: "algoPIN daily", group: "credentials", usedFor: "Access: daily algoPIN" },
  { scope: s("algopin-permanent"), label: "algoPIN permanent", group: "credentials", usedFor: "Access: permanent algoPIN" },
  { scope: s("create-pin-bridge-proxied-job"), label: "Write custom PIN (job 4)", group: "credentials", usedFor: "Access: custom PIN" },
  { scope: s("delete-pin-bridge-proxied-job"), label: "Delete PIN (job 5)", group: "credentials", usedFor: "Access: delete PIN" },
  { scope: s("get-master-pin"), label: "Read master PIN", group: "credentials" },
  { scope: s("create-ekey-access"), label: "Bluetooth guest key", group: "credentials" },
  { scope: s("lock-bridge-proxied-job"), label: "Lock remotely (job 1)", group: "physical", usedFor: "Emergency lock (super-admin only)" },
  { scope: s("unlock-bridge-proxied-job"), label: "Unlock remotely (job 2)", group: "physical", usedFor: "Emergency unlock (super-admin only)" },
  { scope: s("update-device"), label: "Edit device settings", group: "other" },
  // Not in the igloohome scope list, but granted to our client (E21, EXP-20260927-01): API.
  { scope: s("store-device-activity"), label: "Upload activity logs", group: "other" },
  { scope: s("edit-pin-bridge-proxied-job"), label: "Edit PIN (job 3, documented as not supported)", group: "credentials" },
];

export const SCOPE_BY_NAME = new Map(SCOPES.map((x) => [x.scope, x]));

/** Q5: every signed-in user gets these, so every screen works for everyone. */
export const READ_SCOPES = SCOPES.filter((x) => x.group === "read").map((x) => x.scope);

export const GROUP_LABEL: Record<ScopeGroup, string> = {
  read: "Read (everyone)",
  bridge_jobs: "Bridge health checks",
  credentials: "PINs and credentials",
  physical: "Physical lock and unlock",
  other: "Other",
};

export const shortScope = (scope: string) => scope.replace(/^igloohomeapi\//, "");

/**
 * What a token may carry (plans F3, F4b): only scopes an iot-pms feature uses, and physical ones (lock/unlock) only
 * when `physical` is asked for, which only the emergency flow does.
 */
export function tokenScopes(scopes: string[], physical = false): string[] {
  return [...new Set(scopes)].filter((x) => SCOPE_BY_NAME.get(x)?.usedFor && (physical || SCOPE_BY_NAME.get(x)?.group !== "physical")).sort();
}

/** Pure: the scopes a user may use. */
export function effectiveScopes(role: Role | undefined, assigned: string[], ceiling: string[]): string[] {
  if (atLeast(role, "super_admin")) return [...ceiling].sort();
  if (!role) return [];
  return [...new Set([...READ_SCOPES, ...assigned])].filter((x) => ceiling.includes(x)).sort();
}

/** Reason to refuse an operation that needs `scope`, or undefined when the caller has it. */
export function scopeDenial(scope: string | undefined, caller: { scopes: string[]; ceiling: string[] }): string | undefined {
  if (!scope || caller.scopes.includes(scope)) return undefined;
  if (!caller.ceiling.includes(scope)) return `igloohome does not grant our client ${shortScope(scope)} (People → Sync scopes)`;
  return `You do not have the ${shortScope(scope)} scope; a super-admin can grant it on People`;
}
