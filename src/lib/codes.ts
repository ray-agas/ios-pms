// Code dictionaries copied from the igloohome docs snapshot (docs/research/igloohome/sources/2026-09-25).
// Every entry carries its source so the UI can show how much we trust it. Plain module: used by server and browser
// (code hints on every screen). No secrets here.

import type { CodeMeaning, DeviceKind } from "@/server/domain/models";

export interface ModelInfo {
  name: string;
  kind: DeviceKind;
  algoPin: boolean;
}

// docs.igloohome.co/home/supported-devices ("Last updated: July 16, 2025"). Longest prefix wins (IGB4A before IGB4).
export const MODELS: Record<string, ModelInfo> = {
  DBX1: { name: "Deadbolt Go (Satin Nickel)", kind: "lock", algoPin: true },
  DBX2: { name: "Deadbolt Go (Matte Black)", kind: "lock", algoPin: true },
  IGB4: { name: "Deadbolt 2S Metal Grey", kind: "lock", algoPin: true },
  IGB4A: { name: "Deadbolt 2E", kind: "lock", algoPin: true },
  IGK3: { name: "Keybox 3", kind: "lock", algoPin: true },
  IGM3: { name: "Mortise 2", kind: "lock", algoPin: true },
  IGM4: { name: "Mortise 2+", kind: "lock", algoPin: true },
  IGP1: { name: "Padlock", kind: "lock", algoPin: true },
  IGR1: { name: "Rim Lock for Metal Gates", kind: "lock", algoPin: true },
  ML5X: { name: "Smart Lever Mortise", kind: "lock", algoPin: true },
  MP1F: { name: "Push-Pull Mortise", kind: "lock", algoPin: true },
  MT1X: { name: "Mortise Touch", kind: "lock", algoPin: true },
  OE1X: { name: "Retrofit Lock", kind: "lock", algoPin: false },
  RG1X: { name: "Glass Door Lock", kind: "lock", algoPin: true },
  RM2F: { name: "Gate Lock (with Fingerprint)", kind: "lock", algoPin: true },
  RM2X: { name: "Gate Lock", kind: "lock", algoPin: true },
  RW1X: { name: "Rim Lock for Wooden Doors", kind: "lock", algoPin: true },
  SK3E: { name: "Keybox 3E", kind: "lock", algoPin: true },
  SK4X: { name: "Keybox 4", kind: "lock", algoPin: true },
  SP1E: { name: "Padlock E", kind: "lock", algoPin: true },
  SP2E: { name: "Padlock 2E", kind: "lock", algoPin: true },
  SP2X: { name: "Padlock 2", kind: "lock", algoPin: true },
  SP3X: { name: "Padlock 3", kind: "lock", algoPin: false },
  // Listed under "Locks" in the docs, but it drives the bedlock; the API `type` for it is unverified (device-topology.md).
  SW1X: { name: "Switch", kind: "switch", algoPin: false },
  EB1X: { name: "Bridge", kind: "bridge", algoPin: false },
  EK1X: { name: "Keypad", kind: "keypad", algoPin: true },
  // Not in the supported-devices table. Seen on our test site (EXP-20260925-01); GET /devices/support-pins lists it.
  EK2X: { name: "Keypad (EK2X, not in docs table)", kind: "keypad", algoPin: true },
  IEF1: { name: "Key Fob", kind: "fob", algoPin: false },
};

export function lookupModel(deviceId: string): { prefix: string; model?: ModelInfo } {
  for (const len of [5, 4]) {
    const prefix = deviceId.slice(0, len);
    if (MODELS[prefix]) return { prefix, model: MODELS[prefix] };
  }
  return { prefix: deviceId.slice(0, 4) };
}

const WEBHOOK_JOB_DOC = "docs.igloohome.co/home/webhook-job-specific-data";
const STOPLIGHT_JOB_DOC = "igloocompany.stoplight.io … get-job-status";

// D23 resolved by EXP-20260926-01 (E6–E8): both tables are right, for different sources.
// Webhook `data.jobStatus` = job RESULT (webhook table). Polled `GET /jobs` `jobResponse.jobStatus` = job STATE
// (Stoplight table): observed 1 while completed:false, then 0 when completed:true.
export const JOB_STATUS_WEBHOOK: Record<number, CodeMeaning> = {
  0: { meaning: "Success", source: `${WEBHOOK_JOB_DOC} · EXP-20260926-01`, evidence: "API" },
  1: { meaning: "Generic failure", source: WEBHOOK_JOB_DOC, evidence: "DOC" },
  2: { meaning: "Another operation is in progress", source: WEBHOOK_JOB_DOC, evidence: "DOC" },
  3: { meaning: "PIN not found (delete PIN)", source: WEBHOOK_JOB_DOC, evidence: "DOC" },
  5: { meaning: "Invalid custom PIN length (create PIN)", source: WEBHOOK_JOB_DOC, evidence: "DOC" },
  9: { meaning: "Duplicate PIN (create PIN)", source: WEBHOOK_JOB_DOC, evidence: "DOC" },
  12: { meaning: "Insufficient PIN storage (create PIN)", source: WEBHOOK_JOB_DOC, evidence: "DOC" },
};

export const JOB_STATUS_POLLED: Record<number, CodeMeaning> = {
  0: { meaning: "Completed", source: `${STOPLIGHT_JOB_DOC} · EXP-20260926-01`, evidence: "API" },
  1: { meaning: "Pending", source: `${STOPLIGHT_JOB_DOC} · EXP-20260926-01`, evidence: "API" },
  2: { meaning: "Expired", source: STOPLIGHT_JOB_DOC, evidence: "DOC" },
};

export const WIFI_STATUS: Record<number, CodeMeaning> = {
  0: { meaning: "Connected", source: "docs.igloohome.co/home/webhooks-bridge-event", evidence: "DOC" },
  2: {
    meaning: "Disconnected / SSID not found / invalid password",
    source: "docs.igloohome.co/home/webhooks-bridge-event",
    evidence: "DOC",
  },
  5: { meaning: "No internet connectivity", source: "docs.igloohome.co/home/webhooks-bridge-event", evidence: "DOC" },
};

// Activity log types (docs.igloohome.co/home/webhooks-bridge-event, "Activity Log Received").
// `tone` drives colour in the UI; `method` groups how access happened. Unknown types fall back to "Lock event".
export type LogTone = "access" | "denied" | "alert" | "config" | "system";
export interface LogTypeInfo {
  label: string;
  tone: LogTone;
  method?: "pin" | "bluetooth" | "manual" | "card" | "fingerprint" | "auto" | "master";
}

export const LOG_TYPES: Record<number, LogTypeInfo> = {
  11: { label: "Unlocked via Bluetooth", tone: "access", method: "bluetooth" },
  13: { label: "Clock synced", tone: "system" },
  14: { label: "Volume changed (keypad)", tone: "config" },
  15: { label: "Volume changed (Bluetooth)", tone: "config" },
  16: { label: "Wrong PIN entered", tone: "denied", method: "pin" },
  17: { label: "PIN too long", tone: "denied", method: "pin" },
  18: { label: "Unlocked with master PIN", tone: "alert", method: "master" },
  19: { label: "Unlocked with PIN", tone: "access", method: "pin" },
  20: { label: "One-time PIN used", tone: "access", method: "pin" },
  21: { label: "Permanent PIN used (first time)", tone: "access", method: "pin" },
  22: { label: "Duration PIN used (first time)", tone: "access", method: "pin" },
  23: { label: "Weekly PIN used (first time)", tone: "access", method: "pin" },
  24: { label: "Monthly PIN used (first time)", tone: "access", method: "pin" },
  25: { label: "Weekday PIN used (first time)", tone: "access", method: "pin" },
  26: { label: "Weekend PIN used (first time)", tone: "access", method: "pin" },
  27: { label: "PIN created via Bluetooth", tone: "config", method: "pin" },
  28: { label: "PIN changed on keypad", tone: "config", method: "pin" },
  29: { label: "PIN changed via Bluetooth", tone: "config", method: "pin" },
  30: { label: "PIN deleted on keypad", tone: "config", method: "pin" },
  31: { label: "PIN deleted via Bluetooth", tone: "config", method: "pin" },
  32: { label: "Master PIN changed", tone: "alert", method: "master" },
  33: { label: "Auto-relock changed (keypad)", tone: "config" },
  34: { label: "Auto-relock changed (Bluetooth)", tone: "config" },
  35: { label: "Wrong-PIN lockout changed (keypad)", tone: "config" },
  36: { label: "Wrong-PIN lockout changed (Bluetooth)", tone: "config" },
  37: { label: "Locked via Bluetooth", tone: "access", method: "bluetooth" },
  38: { label: "Auto-unlock setting changed", tone: "config" },
  39: { label: "Bluetooth guest key blocked", tone: "config", method: "bluetooth" },
  40: { label: "Bluetooth guest key unblocked", tone: "config", method: "bluetooth" },
  41: { label: "Daylight saving changed", tone: "system" },
  42: { label: "Key card added", tone: "config", method: "card" },
  43: { label: "Unlocked with key card", tone: "access", method: "card" },
  44: { label: "Key card deleted", tone: "config", method: "card" },
  45: { label: "LED brightness changed", tone: "config" },
  46: { label: "Relock alarm changed", tone: "config" },
  47: { label: "Auto-relocked (after opening)", tone: "access", method: "auto" },
  48: { label: "Auto-relocked", tone: "access", method: "auto" },
  49: { label: "Locked with keypad / button", tone: "access", method: "manual" },
  50: { label: "Unlocked with button", tone: "access", method: "manual" },
  51: { label: "Locked with key / thumbturn", tone: "access", method: "manual" },
  52: { label: "Unlocked with key / thumbturn", tone: "access", method: "manual" },
  53: { label: "Attempted break-in", tone: "alert" },
  54: { label: "Fingerprint added", tone: "config", method: "fingerprint" },
  55: { label: "Fingerprint deleted", tone: "config", method: "fingerprint" },
  56: { label: "Fingerprint unlock attempt", tone: "access", method: "fingerprint" },
  57: { label: "Invalid key card", tone: "denied", method: "card" },
};

// Slice 1 only allows read-type health-check jobs. Everything else is rejected by the client.
export const HEALTH_CHECK_JOB_TYPES = { lockBattery: 9, lockStatus: 10 } as const;
/** Plan G1: job 15 (get activity logs). Destructive read: the lock deletes the logs it hands over. Super-admin only. */
export const PULL_LOGS_JOB_TYPE = 15;
export const BRIDGE_DIAGNOSTICS_JOB_TYPE = 10;

// Proxied job types (docs.igloohome.co/home/bridge-jobs-proxied). Slice 1 can only send 9 and 10 (client guard).
export interface JobTypeInfo {
  name: string;
  supported: boolean;
  risk: "R1" | "R2" | "R3" | "—";
  sideEffect?: string;
}
export const PROXIED_JOB_TYPES: Record<number, JobTypeInfo> = {
  1: { name: "Lock", supported: true, risk: "R3", sideEffect: "Physically locks; sets lock clock if lockTime sent" },
  2: { name: "Unlock", supported: true, risk: "R3", sideEffect: "Physically unlocks; sets clock" },
  3: { name: "Edit custom PIN", supported: false, risk: "—" },
  4: { name: "Create custom PIN", supported: true, risk: "R2", sideEffect: "Writes PIN to lock storage (199-slot limit)" },
  5: { name: "Delete PIN", supported: true, risk: "R2", sideEffect: "Removes PIN" },
  9: { name: "Get battery level", supported: true, risk: "R1", sideEffect: "Wakes lock" },
  10: { name: "Get device status", supported: true, risk: "R1", sideEffect: "Wakes lock; returns lockOpen, doorOpen" },
  14: { name: "Set max incorrect PIN attempts", supported: false, risk: "—" },
  15: { name: "Get activity logs", supported: true, risk: "R2", sideEffect: "Logs are deleted from the lock after retrieval; sets clock" },
  16: { name: "Set master PIN", supported: false, risk: "—" },
  18: { name: "Revoke Bluetooth guest key", supported: false, risk: "—" },
  19: { name: "Re-enable revoked guest key", supported: false, risk: "—" },
  24: { name: "Delete RFID card by UID", supported: false, risk: "—" },
  29: { name: "Delete fingerprint by UID", supported: false, risk: "—" },
};

// Webhook event types. 3 and 5 received from our hardware on 2026-09-26 (plan §21, M2.5); 10 not seen yet.
export const WEBHOOK_EVENT_TYPES: Record<number, CodeMeaning> = {
  3: { meaning: "Job complete", source: "docs.igloohome.co/home/webhook-job-specific-data", evidence: "API" },
  5: { meaning: "Activity log received", source: "docs.igloohome.co/home/webhooks-bridge-event", evidence: "API" },
  10: { meaning: "Bridge connection (isOnline)", source: "docs.igloohome.co/home/webhooks-bridge-event", evidence: "DOC" },
};
