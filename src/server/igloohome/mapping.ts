import "server-only";

import type {
  ActivityEntry,
  ConnectionStatus,
  DeviceKind,
  DeviceSnapshot,
  PropertySummary,
  ProviderJobStatus,
  TopologyEdge,
} from "../domain/models";
import { JOB_STATUS_POLLED, lookupModel } from "./codes";
import { redactDeviceId, redactFreeText } from "./redaction";
import type { VendorActivity, VendorDevice, VendorJobStatus, VendorProperty, VendorServerHealth } from "./schemas";

// Anti-corruption layer: vendor shapes in, our read models out. Nothing outside src/server/igloohome sees vendor names.

const SUPPORTED_DEVICES_SOURCE = "docs.igloohome.co/home/supported-devices (last updated 2025-07-16)";
const TYPE_TO_KIND: Record<string, DeviceKind> = { lock: "lock", keypad: "keypad", bridge: "bridge", fob: "fob" };

function lockState(value: string | undefined): DeviceSnapshot["lockState"] {
  if (!value) return undefined;
  const normalised = value.toLowerCase(); // D27: "LOCKED" (Stoplight) vs "locked" (iglooworks example)
  if (normalised === "locked" || normalised === "unlocked") return normalised;
  return "unknown";
}

export function toDeviceSnapshot(device: VendorDevice, fetchedAt: string): DeviceSnapshot {
  const { prefix, model } = lookupModel(device.deviceId);
  return {
    providerDeviceId: device.deviceId,
    displayId: redactDeviceId(device.deviceId),
    modelPrefix: prefix,
    modelName: model?.name,
    kind: model?.kind ?? TYPE_TO_KIND[device.type.toLowerCase()] ?? "unknown",
    providerType: device.type,
    name: device.deviceName,
    batteryPercent: device.batteryLevel,
    lastSyncAt: device.lastSync ?? undefined,
    lockState: lockState(device.lockStatus),
    propertyIds: device.homeId ?? [],
    linkedDeviceIds: device.linkedDevices.flatMap((linked) => (linked.deviceId ? [linked.deviceId] : [])),
    capabilities: {
      algoPin: model ? model.algoPin : "unknown",
      source: SUPPORTED_DEVICES_SOURCE,
      evidence: "DOC",
    },
    fetchedAt,
  };
}

/** Edges as reported by the API (`linkedDevices`), de-duplicated regardless of direction. */
export function toTopologyEdges(devices: VendorDevice[]): TopologyEdge[] {
  const seen = new Set<string>();
  const edges: TopologyEdge[] = [];
  for (const device of devices) {
    for (const linked of device.linkedDevices) {
      if (!linked.deviceId) continue;
      const key = [device.deviceId, linked.deviceId].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ fromDevice: device.deviceId, toDevice: linked.deviceId, relation: "linked", source: "api" });
    }
  }
  return edges;
}

export function toConnectionStatus(
  health: VendorServerHealth,
  requestedScopes: string[],
  checkedAt: string,
): ConnectionStatus {
  const granted = health.scopes ?? [];
  return {
    ok: health.status === undefined || health.status === "active",
    flow: health.flow,
    grantedScopes: granted,
    requestedScopes,
    missingScopes: requestedScopes.filter((scope) => !granted.includes(scope)),
    tier: health.tier,
    status: health.status,
    subscriptionEndsAt: health.endsAt,
    checkedAt,
  };
}

export function toPropertySummary(property: VendorProperty): PropertySummary {
  return { id: property.id, name: property.name, timezone: property.timezone };
}

export function toActivityEntry(activity: VendorActivity): ActivityEntry {
  return {
    occurredAt: activity.activityTimeAt,
    kind: activity.activityType,
    description: activity.description ? redactFreeText(activity.description) : undefined,
  };
}

export function toJobStatus(job: VendorJobStatus): ProviderJobStatus {
  const raw = job.jobResponse?.jobStatus;
  const opResult = job.jobResponse?.opResult;
  return {
    providerJobId: job.jobId,
    completed: job.completed,
    expiresAt: job.expiryDate,
    rawJobStatus: raw,
    rawOpResult: opResult,
    // D23 resolved (EXP-20260926-01): the polled value is the job STATE; the result comes from the webhook / opResult.
    interpretations: raw === undefined ? [] : [{ label: "Job state (GET /jobs)", meaning: JOB_STATUS_POLLED[raw] }],
    statusConfidence: JOB_STATUS_POLLED[raw ?? -1]?.evidence === "API" ? "verified" : "unverified",
  };
}
