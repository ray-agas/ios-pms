// One decoder for every code the UI shows (log types, job statuses, HTTP, outcomes, models …).
// Meanings come from lib/codes.ts (docs + experiments); HTTP and outcome texts from the endpoint inventory
// and errors.ts. Used by <Code> so a code is never shown without a way to read what it means.

import { JOB_STATUS_POLLED, JOB_STATUS_WEBHOOK, LOG_TYPES, lookupModel, PROXIED_JOB_TYPES, WEBHOOK_EVENT_TYPES, WIFI_STATUS } from "./codes";
import { CUSTOM_PIN_TYPES } from "./pin-job-rules";

export type CodeKind = "log" | "jobStatus" | "jobState" | "jobType" | "wifi" | "event" | "http" | "outcome" | "model" | "pinType";

export interface Decoded {
  title: string;
  meaning: string;
  source?: string;
  evidence?: string;
  note?: string;
}

// Generic HTTP meanings for this API (02-endpoint-inventory.md); operation-specific ones are passed in as `meaning`.
const HTTP: Record<number, string> = {
  200: "OK",
  201: "Created",
  204: "Done, no body",
  400: "Bad request: a documented rule was broken (field, format, range)",
  401: "Token rejected (the client refreshes it and retries once)",
  402: "Subscription or trial has ended",
  403: "Forbidden: token lacks the scope, or the account cannot do this",
  404: "Device, property or job not found",
  406: "Not acceptable: Bridge offline, lock not linked to the Bridge, or PIN already taken",
  409: "Conflict: property has no timezone (data integrity)",
  415: "Unsupported media type",
  418: "This device type does not support the feature",
  422: "Unprocessable: e.g. jobId is not a valid ObjectId",
  429: "Too many requests: wait for Retry-After",
  500: "igloohome server error",
  502: "igloohome upstream error",
  503: "igloohome unavailable",
};

// errors.ts ProviderErrorCode → plain language.
const OUTCOME: Record<string, string> = {
  ok: "Success",
  unavailable: "igloohome did not answer (timeout, network or 5xx)",
  auth: "Credentials or token rejected",
  validation: "Request broke a rule (ours or igloohome's)",
  subscription: "Subscription or trial ended (402)",
  scope: "Forbidden: missing scope or not allowed (403)",
  not_found: "Not found (404)",
  bridge_offline: "Bridge offline (406)",
  lock_not_linked: "Lock is not linked to this Bridge (406)",
  not_acceptable: "Rejected by igloohome (406), see the message",
  data_integrity: "Property has no timezone (409)",
  unsupported: "Not supported by this model (418)",
  rate_limited: "Rate limited (429)",
  contract: "Response did not match the documented shape",
  forbidden_operation: "Blocked by iot-pms safety rules",
  rejected: "Rejected before or by igloohome",
  not_configured: "igloohome credentials are not set",
};

export function decode(kind: CodeKind, value: string | number, opts: { meaning?: string } = {}): Decoded {
  const n = Number(value);
  const named = (title: string, entry?: { meaning: string; source?: string; evidence?: string }, fallback = "Not in the documented table") => ({
    title,
    meaning: opts.meaning ?? entry?.meaning ?? fallback,
    source: entry?.source,
    evidence: entry?.evidence,
  });
  switch (kind) {
    case "log": {
      const log = LOG_TYPES[n];
      return {
        title: `Log type ${n}`,
        meaning: log?.label ?? "Not in the documented log table",
        source: "docs.igloohome.co/home/webhooks-bridge-event",
        evidence: "DOC",
        note: log ? `Group: ${log.tone}${log.method ? ` · method: ${log.method}` : ""}` : undefined,
      };
    }
    case "jobStatus":
      return { ...named(`jobStatus ${n} (webhook result)`, JOB_STATUS_WEBHOOK[n]), note: "Result of the job. Polled GET /jobs uses the same field for the job state (D23)." };
    case "jobState":
      return { ...named(`jobStatus ${n} (GET /jobs state)`, JOB_STATUS_POLLED[n]), note: "State of the job, not its result (D23, EXP-20260926-01)." };
    case "jobType": {
      const job = PROXIED_JOB_TYPES[n];
      return {
        title: `Job type ${n}`,
        meaning: job ? `${job.name}${job.supported ? "" : " (not supported)"}` : "Not in the documented job table",
        source: "docs.igloohome.co/home/bridge-jobs-proxied",
        evidence: "DOC",
        note: job?.sideEffect ? `${job.risk} · ${job.sideEffect}` : undefined,
      };
    }
    case "wifi":
      return named(`Wi-Fi status ${n}`, WIFI_STATUS[n]);
    case "event":
      return named(`Webhook event type ${n}`, WEBHOOK_EVENT_TYPES[n]);
    case "http":
      return { title: `HTTP ${n}`, meaning: opts.meaning ?? HTTP[n] ?? (n >= 500 ? "igloohome server error" : "Not documented"), source: "02-endpoint-inventory.md" };
    case "outcome":
      return { title: `Outcome ${value}`, meaning: opts.meaning ?? OUTCOME[String(value)] ?? "Unknown outcome", source: "iot-pms errors.ts" };
    case "model": {
      const { prefix, model } = lookupModel(String(value));
      return {
        title: `Model ${prefix}`,
        meaning: model ? model.name : "Not in the supported-devices table",
        source: "docs.igloohome.co/home/supported-devices",
        evidence: "DOC",
        note: model ? `${model.kind}${model.algoPin ? " · supports algoPIN" : ""}` : undefined,
      };
    }
    case "pinType": {
      const t = CUSTOM_PIN_TYPES[n as keyof typeof CUSTOM_PIN_TYPES];
      return { title: `pinType ${n}`, meaning: t ? `${t.label}: ${t.hint}` : "Not documented", source: "docs.igloohome.co/home/bridge-jobs-proxied", evidence: "DOC" };
    }
  }
}
