// Phase A read-only experiments E1–E4b (docs/research/igloohome/10-experiments-plan.md §2).
// Usage: bun run experiment
//
// Safety:
// - Uses READ-ONLY scopes below, whatever IGLOOHOME_SCOPES says. No job is created, no device is contacted.
// - E4b deliberately calls GET /devices/{id}/masterpin WITHOUT the master-PIN scope and expects 403.
//   Any body returned is redacted before it is kept.
// - Everything printed or written under docs/ or tests/ is sanitized: tokens/secrets/PINs redacted,
//   device and property IDs replaced. Full device IDs go only to var/experiments/device-ids.local.txt (git-ignored).

import { mkdirSync, writeFileSync } from "node:fs";

import { IgloohomeClient, type ApiCallRecord } from "@/server/igloohome/client";
import { ProviderError } from "@/server/igloohome/errors";
import { toDeviceSnapshot, toTopologyEdges } from "@/server/igloohome/mapping";
import { redact, redactDeviceId } from "@/server/igloohome/redaction";
import { TokenProvider } from "@/server/igloohome/token";
import { parseIgloohomeConfig } from "@/server/config";
import type { VendorDevice } from "@/server/igloohome/schemas";

const READ_ONLY_SCOPES = [
  "igloohomeapi/get-devices",
  "igloohomeapi/get-properties",
  "igloohomeapi/get-device-activity",
  "igloohomeapi/get-job-status",
];
const ALTERNATIVE_BASE = "https://api.igloohome.co/home"; // D1 candidate from the reference examples

const config = parseIgloohomeConfig(process.env);
if (!config) throw new Error("IGLOOHOME_CLIENT_ID / IGLOOHOME_CLIENT_SECRET are not set");

interface RawExchange {
  step: string;
  method: string;
  host: string;
  path: string;
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

let currentStep = "setup";
const exchanges: RawExchange[] = [];
const INTERESTING_HEADERS = /^(content-type|retry-after|x-ratelimit.*|ratelimit.*|x-amzn-requestid|x-amz-apigw-id|date)$/i;

const recordingFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  const response = await fetch(request);
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (INTERESTING_HEADERS.test(key)) headers[key] = value;
  });
  const text = await response.clone().text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* plain text */
  }
  const isToken = url.href === config.tokenUrl;
  exchanges.push({
    step: currentStep,
    method: request.method,
    host: url.host,
    path: url.pathname + (url.search ? url.search : ""),
    status: response.status,
    headers,
    // Token responses: keep only field names and non-secret values.
    body: isToken && body && typeof body === "object" ? { ...redact(body) as object } : body,
  });
  return response;
}) as typeof fetch;

const calls: ApiCallRecord[] = [];
const tokens = new TokenProvider({ ...config, scopes: READ_ONLY_SCOPES }, recordingFetch);
const client = new IgloohomeClient({
  baseUrl: config.apiBaseUrl,
  tokens,
  timeoutMs: config.timeoutMs,
  fetchImpl: recordingFetch,
  onCall: (record) => calls.push(record),
});

const results: Record<string, unknown> = {};
async function step<T>(name: string, run: () => Promise<T>): Promise<T | undefined> {
  currentStep = name;
  try {
    const value = await run();
    results[name] = { ok: true };
    return value;
  } catch (error) {
    const e = error instanceof ProviderError ? { code: error.code, status: error.status, message: error.message } : { message: String(error) };
    results[name] = { ok: false, error: e };
    return undefined;
  }
}

// --- E1: token -------------------------------------------------------------
const token = await step("E1 token", () => tokens.getToken());
if (token) {
  const [, payload] = token.split(".");
  let claims: Record<string, unknown> = {};
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    /* not a JWT */
  }
  results["E1 token"] = {
    ok: true,
    isJwt: Object.keys(claims).length > 0,
    claimNames: Object.keys(claims).sort(),
    scopeClaim: claims.scope,
    tokenUse: claims.token_use,
    lifetimeSeconds: typeof claims.exp === "number" && typeof claims.iat === "number" ? claims.exp - claims.iat : undefined,
  };
}

// --- E2: server-health on both candidate bases (D1) -------------------------
await step("E2 server-health primary", () => client.serverHealth());
const alt = new IgloohomeClient({ baseUrl: ALTERNATIVE_BASE, tokens, timeoutMs: config.timeoutMs, fetchImpl: recordingFetch, onCall: (r) => calls.push(r) });
await step("E2 server-health alternative", () => alt.serverHealth());

// --- E3: devices -------------------------------------------------------------
const devices = (await step("E3 list devices", () => client.listAllDevices())) ?? [];
await step("E3 support-pins", () => client.listPinCapableDevices({ limit: 300 }));
const details: VendorDevice[] = [];
for (const device of devices) {
  const detail = await step(`E3 device detail ${redactDeviceId(device.deviceId)}`, () => client.getDevice(device.deviceId));
  if (detail) details.push(detail);
}

// --- E4: properties + activity ----------------------------------------------
const properties = (await step("E4 list properties", () => client.listProperties({ limit: 300 })))?.payload ?? [];
for (const [index, property] of properties.entries()) {
  await step(`E4 property detail #${index + 1}`, () => client.getProperty(property.id));
  await step(`E4 property devices #${index + 1}`, () => client.listPropertyDevices(property.id, { limit: 300 }));
}
for (const device of devices) {
  await step(`E4 activity ${redactDeviceId(device.deviceId)}`, () => client.listActivity(device.deviceId, { limit: 20 }));
}

// --- E4b: scope enforcement (expect 403) -------------------------------------
const lock = devices.find((d) => d.type.toLowerCase() === "lock") ?? devices[0];
if (lock) {
  currentStep = "E4b masterpin without scope";
  const response = await recordingFetch(`${config.apiBaseUrl}/devices/${encodeURIComponent(lock.deviceId)}/masterpin`, {
    headers: { Authorization: `Bearer ${await tokens.getToken()}`, Accept: "application/json", "Content-Type": "application/json" },
  });
  results[currentStep] = { ok: response.status === 403, status: response.status, expected: 403 };
}

// --- Sanitize and write ------------------------------------------------------
const idMap = new Map<string, string>();
for (const d of [...devices, ...details]) {
  idMap.set(d.deviceId, redactDeviceId(d.deviceId));
  if (d.id) idMap.set(d.id, `devint-${redactDeviceId(d.deviceId)}`);
  for (const home of d.homeId ?? []) if (!idMap.has(home)) idMap.set(home, `PROP-${[...idMap.values()].filter((v) => v.startsWith("PROP-")).length + 1}`);
  for (const l of d.linkedDevices) if (l.deviceId) idMap.set(l.deviceId, redactDeviceId(l.deviceId));
}
properties.forEach((p) => {
  if (!idMap.has(p.id)) idMap.set(p.id, `PROP-${[...idMap.values()].filter((v) => v.startsWith("PROP-")).length + 1}`);
});
const SENSITIVE_KEYS = /^(clientId|userRef|client_id|sub|username|jti|origin_jti|event_id)$/i;

// Longest IDs first: internal ids can contain other ids (e.g. property id + suffix), so order matters.
const replacements = [...idMap].sort(([a], [b]) => b.length - a.length);

function sanitize(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEYS.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    let out = value;
    for (const [full, masked] of replacements) out = out.split(full).join(masked);
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, k)]));
  }
  return value;
}

const now = new Date();
const stamp = now.toISOString().replace(/[:.]/g, "-");
const fetchedAt = now.toISOString();
const report = sanitize(
  redact({
    runAt: fetchedAt,
    scopesRequested: READ_ONLY_SCOPES,
    results,
    deviceSummary: details.map((d) => toDeviceSnapshot(d, fetchedAt)).map((s) => ({
      displayId: s.displayId,
      modelPrefix: s.modelPrefix,
      modelName: s.modelName,
      providerType: s.providerType,
      kind: s.kind,
      name: s.name,
      battery: s.batteryPercent,
      lastSync: s.lastSyncAt,
      lockState: s.lockState,
      properties: s.propertyIds,
      linked: s.linkedDeviceIds,
      algoPinDocumented: s.capabilities.algoPin,
    })),
    topology: toTopologyEdges(details),
    // Structural facts about identifiers, computed on full values so nothing needs to be printed.
    idFacts: {
      internalIdsUnique: new Set(details.map((d) => d.id)).size === details.length,
      internalIdStartsWithPropertyId: details.map((d) => ({
        device: redactDeviceId(d.deviceId),
        value: Boolean(d.id && (d.homeId ?? []).some((home) => d.id!.startsWith(home))),
      })),
      internalIdLengths: details.map((d) => d.id?.length),
      bridgeLastSyncEqualsPairedAt: details
        .filter((d) => d.type === "Bridge")
        .map((d) => ({
          device: redactDeviceId(d.deviceId),
          value: Boolean(d.lastSync && d.pairedAt && Date.parse(d.lastSync) - Date.parse(d.pairedAt) < 1000),
        })),
    },
    calls,
    exchanges,
  }),
);

mkdirSync("var/experiments", { recursive: true });
writeFileSync(`var/experiments/phase-a-${stamp}.json`, JSON.stringify(report, null, 2));
writeFileSync(
  "var/experiments/device-ids.local.txt",
  "# LOCAL ONLY — full device IDs for IGLOOHOME_ALLOWED_DEVICE_IDS. Never commit or paste.\n" +
    devices.map((d) => `${d.deviceId}\t${d.type}\t${d.deviceName ?? ""}`).join("\n") +
    "\n",
);
console.log(JSON.stringify(report, null, 2));
console.error(`\nWrote var/experiments/phase-a-${stamp}.json (sanitized) and var/experiments/device-ids.local.txt (full IDs, local only).`);
