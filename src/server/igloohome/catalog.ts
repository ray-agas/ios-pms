import "server-only";

import type { Evidence } from "../domain/models";

// Operation catalog for Developer mode (integration-architecture.md §8a). One entry per client method.
// Copied from docs/research/igloohome/02-endpoint-inventory.md and CONTRACT.md; nothing here is invented.
// Update `evidence` when an experiment confirms or contradicts an entry.

export type Risk = "R0" | "R1" | "R2" | "R3"; // R3: physical (lock/unlock)
export type TryIt = "R0" | "R1" | "none";

export interface CatalogParam {
  name: string;
  in: "path" | "query" | "body";
  required: boolean;
  rule?: string;
}

export interface CatalogError {
  status: number;
  meaning: string;
  evidence: Evidence;
}

export interface CatalogEntry {
  id: string;
  title: string;
  inventoryRef: string;
  method: "GET" | "POST";
  pathTemplate: string;
  scope: string;
  risk: Risk;
  evidence: Evidence | "BLOCKED";
  evidenceNote: string;
  docUrl: string;
  params: CatalogParam[];
  errors: CatalogError[];
  /** How "Try it" runs it: R0 directly (operator), R1 as a guarded health check. */
  tryIt: TryIt;
}

const DOCS = "https://docs.igloohome.co/home"; // D20: the sitemap host docs.igloodeveloper.co does not resolve; all slugs checked 200 on 2026-09-26
const PAGE = { limit: "1–300 (400 otherwise)", cursor: "non-empty (400 'cursor' cannot be empty string)" };

export const CATALOG: CatalogEntry[] = [
  {
    id: "serverHealth",
    title: "Server / OAuth client health",
    inventoryRef: "H6",
    method: "GET",
    pathTemplate: "/server-health",
    scope: "any valid token (none stated)",
    risk: "R0",
    evidence: "API",
    evidenceNote: "EXP-20260925-01 E2: `status` absent, `tier` = TRIAL",
    docUrl: `${DOCS}/api_server_health`,
    params: [],
    errors: [{ status: 403, meaning: "User has revoked access, or their account was removed", evidence: "DOC" }],
    tryIt: "R0",
  },
  {
    id: "listProperties",
    title: "List properties",
    inventoryRef: "H7",
    method: "GET",
    pathTemplate: "/properties",
    scope: "igloohomeapi/get-properties",
    risk: "R0",
    evidence: "API",
    evidenceNote: "EXP-20260925-01 E4",
    docUrl: `${DOCS}/api_properties`,
    params: [
      { name: "limit", in: "query", required: false, rule: PAGE.limit },
      { name: "cursor", in: "query", required: false },
      { name: "sort", in: "query", required: false },
    ],
    errors: [{ status: 400, meaning: "'limit' must be between 1 to 300 inclusive", evidence: "DOC" }],
    tryIt: "R0",
  },
  {
    id: "getProperty",
    title: "Get property",
    inventoryRef: "H8",
    method: "GET",
    pathTemplate: "/properties/{propertyId}",
    scope: "igloohomeapi/get-properties",
    risk: "R0",
    evidence: "API",
    evidenceNote: "EXP-20260925-01 E4",
    docUrl: `${DOCS}/api_properties`,
    params: [{ name: "propertyId", in: "path", required: true }],
    errors: [{ status: 404, meaning: "Property Not Found", evidence: "DOC" }],
    tryIt: "R0",
  },
  {
    id: "listPropertyDevices",
    title: "List devices in property",
    inventoryRef: "H9",
    method: "GET",
    pathTemplate: "/properties/{propertyId}/devices",
    scope: "igloohomeapi/get-devices",
    risk: "R0",
    evidence: "API",
    evidenceNote: "EXP-20260925-01 E4",
    docUrl: `${DOCS}/api_properties`,
    params: [
      { name: "propertyId", in: "path", required: true },
      { name: "limit", in: "query", required: false, rule: PAGE.limit },
      { name: "cursor", in: "query", required: false, rule: PAGE.cursor },
      { name: "sort", in: "query", required: false },
      { name: "type", in: "query", required: false },
      { name: "search", in: "query", required: false },
      { name: "expand", in: "query", required: false },
    ],
    errors: [{ status: 400, meaning: "Invalid query", evidence: "DOC" }],
    tryIt: "R0",
  },
  {
    id: "listDevices",
    title: "List devices",
    inventoryRef: "H10",
    method: "GET",
    pathTemplate: "/devices",
    scope: "igloohomeapi/get-devices",
    risk: "R0",
    evidence: "API",
    evidenceNote: "EXP-20260925-01 E3: 6 devices, nextCursor \"\"",
    docUrl: `${DOCS}/api_devices`,
    params: [
      { name: "limit", in: "query", required: false, rule: PAGE.limit },
      { name: "cursor", in: "query", required: false, rule: PAGE.cursor },
      { name: "sort", in: "query", required: false },
      { name: "type", in: "query", required: false },
      { name: "search", in: "query", required: false },
      { name: "expand", in: "query", required: false },
    ],
    errors: [{ status: 400, meaning: "'cursor' cannot be empty string", evidence: "DOC" }],
    tryIt: "R0",
  },
  {
    id: "listPinCapableDevices",
    title: "List devices supporting algoPIN",
    inventoryRef: "H11",
    method: "GET",
    pathTemplate: "/devices/support-pins",
    scope: "igloohomeapi/get-devices",
    risk: "R0",
    evidence: "API",
    evidenceNote: "EXP-20260925-01 E3: DBX2, IGB4, EK2X",
    docUrl: `${DOCS}/api_devices`,
    params: [
      { name: "limit", in: "query", required: false, rule: PAGE.limit },
      { name: "cursor", in: "query", required: false, rule: PAGE.cursor },
    ],
    errors: [{ status: 400, meaning: "'limit' must be between 1 to 300", evidence: "DOC" }],
    tryIt: "R0",
  },
  {
    id: "getDevice",
    title: "Get device details",
    inventoryRef: "H12",
    method: "GET",
    pathTemplate: "/devices/{deviceId}",
    scope: "igloohomeapi/get-devices",
    risk: "R0",
    evidence: "API",
    evidenceNote: "EXP-20260925-01 E3 ×6: lockStatus uppercase; internal id not unique",
    docUrl: `${DOCS}/api_devices`,
    params: [
      { name: "deviceId", in: "path", required: true },
      { name: "admin_key", in: "query", required: false, rule: "meaning undocumented; never sent by this app" },
      { name: "lock_id", in: "query", required: false, rule: "meaning undocumented" },
      { name: "expand", in: "query", required: false, rule: "meaning undocumented" },
    ],
    errors: [
      { status: 404, meaning: "not found device", evidence: "DOC" },
      { status: 409, meaning: "timezone is not found on property", evidence: "DOC" },
    ],
    tryIt: "R0",
  },
  {
    id: "listActivity",
    title: "Get device activity logs",
    inventoryRef: "H14",
    method: "GET",
    pathTemplate: "/devices/{deviceId}/activity",
    scope: "igloohomeapi/get-device-activity",
    risk: "R0",
    evidence: "BLOCKED",
    evidenceNote: "U18: 403 Forbidden for every device although the token has the scope (E4). Use webhooks instead",
    docUrl: `${DOCS}/api_devices`,
    params: [
      { name: "deviceId", in: "path", required: true },
      { name: "startDate", in: "query", required: false },
      { name: "endDate", in: "query", required: false },
      { name: "locale", in: "query", required: false },
      { name: "limit", in: "query", required: false, rule: PAGE.limit },
      { name: "cursor", in: "query", required: false, rule: PAGE.cursor },
      { name: "sort", in: "query", required: false },
    ],
    errors: [
      { status: 400, meaning: "Invalid query", evidence: "DOC" },
      { status: 403, meaning: "Forbidden (text/plain), cause unknown (U18)", evidence: "API" },
      { status: 404, meaning: "not found device / property", evidence: "DOC" },
      { status: 409, meaning: "Conflict", evidence: "DOC" },
    ],
    tryIt: "R0",
  },
  {
    id: "createProxiedJob",
    title: "Create Bridge proxied job (jobs 9, 10 only)",
    inventoryRef: "H28",
    method: "POST",
    pathTemplate: "/devices/{deviceId}/jobs/bridges/{bridgeId}",
    scope: "igloohomeapi/get-battery-level-bridge-proxied-job (9), igloohomeapi/get-device-status-bridge-proxied-job (10)",
    risk: "R1",
    evidence: "API",
    evidenceNote: "EXP-20260926-01 E7/E8: jobs 9 and 10 on Doorlock; result in webhook data and GET /jobs opResult. Wakes the lock",
    docUrl: `${DOCS}/bridge-jobs-proxied`,
    params: [
      { name: "deviceId", in: "path", required: true },
      { name: "bridgeId", in: "path", required: true },
      { name: "jobType", in: "body", required: true, rule: "this app allows 9 or 10 only" },
    ],
    errors: [
      { status: 400, meaning: "job type not supported", evidence: "DOC" },
      { status: 404, meaning: "Bridge or Device Not Found", evidence: "DOC" },
      { status: 406, meaning: "Unable to contact bridge as it appears to be offline", evidence: "DOC" },
      { status: 406, meaning: "Lock is not linked to bridge (Stoplight)", evidence: "DOC" },
    ],
    tryIt: "R1",
  },
  {
    id: "createLockJob",
    title: "Emergency lock / unlock (Bridge jobs 1, 2)",
    inventoryRef: "H28",
    method: "POST",
    pathTemplate: "/devices/{deviceId}/jobs/bridges/{bridgeId}",
    scope: "igloohomeapi/lock-bridge-proxied-job (1) · igloohomeapi/unlock-bridge-proxied-job (2)",
    risk: "R3",
    evidence: "DOC",
    evidenceNote: "Documented (bridge-jobs-proxied, re-read 2026-09-27); E22 pending. Super-admin only, reason + password; lockTime never sent",
    docUrl: `${DOCS}/bridge-jobs-proxied`,
    params: [
      { name: "deviceId", in: "path", required: true },
      { name: "bridgeId", in: "path", required: true },
      { name: "jobType", in: "body", required: true, rule: "1 lock or 2 unlock" },
    ],
    errors: [
      { status: 400, meaning: "job type not supported", evidence: "DOC" },
      { status: 404, meaning: "Bridge or Device Not Found", evidence: "DOC" },
      { status: 406, meaning: "Unable to contact bridge as it appears to be offline", evidence: "DOC" },
    ],
    tryIt: "none",
  },
  {
    id: "createBridgeDiagnosticsJob",
    title: "Create Bridge targeted job (job 10)",
    inventoryRef: "H29",
    method: "POST",
    pathTemplate: "/devices/{bridgeId}/jobs",
    scope: "igloohomeapi/get-device-status-bridge-proxied-job",
    risk: "R1",
    evidence: "API",
    evidenceNote: "EXP-20260926-01 E6: Wi-Fi, RSSI and link capacity returned; 429 window also counted a proxied job 10 (HYP)",
    docUrl: `${DOCS}/bridge-jobs-targeted`,
    params: [
      { name: "bridgeId", in: "path", required: true },
      { name: "jobType", in: "body", required: true, rule: "10" },
    ],
    errors: [
      { status: 406, meaning: "Bridge appears to be offline", evidence: "DOC" },
      { status: 429, meaning: "Too many requests. Please try again after N seconds (Retry-After)", evidence: "API" },
    ],
    tryIt: "R1",
  },
  {
    id: "createAlgoPin",
    title: "Create algoPIN (one-time, hourly, daily, permanent)",
    inventoryRef: "H17–H20",
    method: "POST",
    pathTemplate: "/devices/{deviceId}/algopin/{type}",
    scope: "igloohomeapi/algopin-onetime · -hourly · -daily · -permanent",
    risk: "R2",
    evidence: "DOC",
    evidenceNote: "M5 (E10/E11): creates a working PIN. Rules: lib/algopin-rules.ts. PIN never stored; fingerprint only",
    docUrl: `${DOCS}/api_algopin`,
    params: [
      { name: "deviceId", in: "path", required: true, rule: "algoPIN-capable (GET /devices/support-pins)" },
      { name: "type", in: "path", required: true, rule: "onetime | hourly | daily | permanent (passage not offered)" },
      { name: "accessName", in: "body", required: true, rule: "≤ 60 characters" },
      { name: "variance", in: "body", required: true, rule: "1–5 one-time/permanent, 1–3 hourly/daily" },
      { name: "startDate", in: "body", required: true, rule: "YYYY-MM-DDTHH:00:00+hh:mm; not before current hour (1 h back for hourly/daily)" },
      { name: "endDate", in: "body", required: false, rule: "hourly: +1…672 h; daily: +29…367 days, same hour" },
    ],
    errors: [
      { status: 400, meaning: "Rule violated (format, range, variance, name length)", evidence: "DOC" },
      { status: 402, meaning: "30 days igloohome API trial has ended", evidence: "DOC" },
      { status: 403, meaning: "Token scope must contain the algopin-* scope for this type", evidence: "DOC" },
      { status: 404, meaning: "not found device", evidence: "DOC" },
      { status: 409, meaning: "timezone is not found on property", evidence: "DOC" },
      { status: 418, meaning: "this device type does not support the feature", evidence: "DOC" },
    ],
    tryIt: "none",
  },
  {
    id: "createPinJob",
    title: "Bridge PIN job: create custom PIN (4) / delete PIN (5)",
    inventoryRef: "H28",
    method: "POST",
    pathTemplate: "/devices/{deviceId}/jobs/bridges/{bridgeId}",
    scope: "igloohomeapi/create-pin-bridge-proxied-job (4) · igloohomeapi/delete-pin-bridge-proxied-job (5)",
    risk: "R2",
    evidence: "API",
    evidenceNote: "EXP-20260926-03: job 4 → jobStatus 0 + lock log 27; job 5 → 0 + log 31, then 3 when missing; duplicate → 406. PIN never stored",
    docUrl: `${DOCS}/bridge-jobs-proxied`,
    params: [
      { name: "jobType", in: "body", required: true, rule: "4 or 5 only (lock/unlock unreachable)" },
      { name: "jobData.accessName", in: "body", required: true, rule: "job 4" },
      { name: "jobData.pin", in: "body", required: true, rule: "job 4: 4–6 digits; job 5: the PIN to delete" },
      { name: "jobData.pinType", in: "body", required: true, rule: "1 one-time (24 h), 2 permanent, 4 duration" },
      { name: "jobData.startDate", in: "body", required: true, rule: "YYYY-MM-DDTHH:mm:ss+hh:mm, now or later" },
      { name: "jobData.endDate", in: "body", required: false, rule: "duration: after startDate" },
    ],
    errors: [
      { status: 400, meaning: "field required / invalid / digits only / 4–6 digits / format / now or after", evidence: "DOC" },
      { status: 404, meaning: "The resource was not found", evidence: "DOC" },
      { status: 406, meaning: "Bridge is offline", evidence: "DOC" },
      // EXP-20260926-03 E12: a duplicate PIN is refused at POST time, not with webhook jobStatus 9 as the docs say.
      { status: 406, meaning: "PIN is already taken on this lock (job 4 duplicate)", evidence: "API" },
    ],
    tryIt: "none",
  },
  {
    id: "getJob",
    title: "Get job status",
    inventoryRef: "H30",
    method: "GET",
    pathTemplate: "/jobs/{jobId}",
    scope: "igloohomeapi/get-job-status",
    risk: "R0",
    evidence: "API",
    evidenceNote: "D23 resolved (EXP-20260926-01): jobStatus = job state, 1 pending → 0 completed; result is in opResult / webhook",
    docUrl: `${DOCS}/api_bridge_jobs`,
    params: [{ name: "jobId", in: "path", required: true, rule: "24-hex ObjectId (422 otherwise)" }],
    errors: [
      { status: 404, meaning: "Job not found", evidence: "DOC" },
      { status: 422, meaning: "'jobId' is not a valid MongoDB ObjectId", evidence: "DOC" },
    ],
    tryIt: "R0",
  },
];

export const CATALOG_BY_ID = new Map(CATALOG.map((entry) => [entry.id, entry]));

/** Plain-language meaning of an HTTP status for one operation, documented first, generic second. */
export function decodeStatus(operation: string, status?: number): string | undefined {
  if (status === undefined) return undefined;
  const documented = CATALOG_BY_ID.get(operation)?.errors.filter((e) => e.status === status);
  if (documented?.length) return documented.map((e) => e.meaning).join(" / ");
  if (status >= 200 && status < 300) return "Success";
  if (status === 401) return "Token rejected (refreshed and retried once)";
  if (status === 429) return "Rate limited";
  if (status >= 500) return "igloohome server error";
  return undefined;
}
