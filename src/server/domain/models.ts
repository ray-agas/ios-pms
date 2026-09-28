// Our own read models (integration-architecture.md §4.3). No igloohome field names here, and no imports:
// the domain depends on nothing. Safe to pass to client components (no secrets; UI shows IDs redacted).

export type Evidence = "DOC" | "DOC-PARTIAL" | "API" | "HW" | "UNVERIFIED";

export interface CodeMeaning {
  meaning: string;
  source: string;
  evidence: Evidence;
}

export type DeviceKind = "lock" | "keypad" | "bridge" | "fob" | "switch" | "unknown";

// "admin" is shown as a label on operator until Bobobox AU's DDD work settles the name (foundation plan §8, option C).
export type Role = "viewer" | "operator" | "super_admin";

const ROLE_RANK: Record<Role, number> = { viewer: 0, operator: 1, super_admin: 2 };

/** Rank check: a super-admin can do everything an operator can. Unknown or missing roles rank lowest. */
export function atLeast(role: Role | undefined, required: Role): boolean {
  return (role ? ROLE_RANK[role] ?? -1 : -1) >= ROLE_RANK[required];
}

export const ROLE_LABEL: Record<Role, string> = { viewer: "Viewer", operator: "Operator (admin)", super_admin: "Super-admin" };

export interface ConnectionStatus {
  ok: boolean;
  flow?: string;
  grantedScopes: string[];
  requestedScopes: string[];
  missingScopes: string[];
  tier?: string;
  status?: string;
  subscriptionEndsAt?: string;
  checkedAt: string;
}

export interface DocumentedCapabilities {
  algoPin: boolean | "unknown";
  source: string;
  evidence: Evidence;
}

export interface DeviceSnapshot {
  providerDeviceId: string;
  displayId: string;
  modelPrefix: string;
  modelName?: string;
  kind: DeviceKind;
  providerType: string;
  name?: string;
  batteryPercent?: number;
  lastSyncAt?: string;
  lockState?: "locked" | "unlocked" | "unknown";
  propertyIds: string[];
  linkedDeviceIds: string[];
  capabilities: DocumentedCapabilities;
  fetchedAt: string;
}

export interface TopologyEdge {
  fromDevice: string;
  toDevice: string;
  relation: "linked";
  source: "api" | "app";
}

export interface ActivityEntry {
  occurredAt?: string;
  kind?: string;
  description?: string;
}

export interface PropertySummary {
  id: string;
  name?: string;
  timezone?: string;
}

export type JobKind = "lock_battery" | "lock_status" | "bridge_diagnostics" | "pin_create" | "pin_delete" | "remote_lock" | "remote_unlock" | "pull_logs";

export interface JobInterpretation {
  label: string;
  meaning?: CodeMeaning;
}

export interface ProviderJobStatus {
  providerJobId: string;
  completed?: boolean;
  expiresAt?: string;
  rawJobStatus?: number;
  rawOpResult?: unknown;
  // D23: the docs disagree, so both readings are shown and the confidence stays "unverified" until E7.
  interpretations: JobInterpretation[];
  statusConfidence: "unverified" | "verified";
}
