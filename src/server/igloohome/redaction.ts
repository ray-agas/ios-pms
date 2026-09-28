import "server-only";

// One place that decides what may leave the server: logs, the API-call log, the inspector, experiment exports.
// If in doubt, redact. Tests in tests/unit/redaction.test.ts must fail if a known secret leaks.

export const REDACTED = "[REDACTED]";

const SECRET_KEY =
  /^(authorization|client_?id|client_?secret|access_?token|refresh_?token|id_?token|password|secret|pin|new_?pin|custom_?pin|master_?pin|bluetooth_?guest_?key|admin_?key|user_?ref)$/i;

// Free-text fields that may quote a PIN (activity descriptions, vendor error messages).
const FREE_TEXT_KEY = /^(description|message|error|msg)$/i;

const AUTH_HEADER_VALUE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;
// PIN-like digit runs (4–12 digits). Only applied to free text: it would also hit years in timestamps.
const DIGIT_RUN = /\b\d{4,12}\b/g;

export function redactText(text: string): string {
  return text.replace(AUTH_HEADER_VALUE, "$1 " + REDACTED);
}

export function redactFreeText(text: string): string {
  return redactText(text).replace(DIGIT_RUN, "••••");
}

export function redact(value: unknown, keyHint?: string): unknown {
  if (keyHint && SECRET_KEY.test(keyHint)) return value === undefined || value === null ? value : REDACTED;
  if (typeof value === "string") return keyHint && FREE_TEXT_KEY.test(keyHint) ? redactFreeText(value) : redactText(value);
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = redact(inner, key);
    return out;
  }
  return value;
}

/** `IGB403fe3b9d` → `IGB4••••••9d`. Keeps the model prefix, hides the unique part. */
export function redactDeviceId(deviceId: string): string {
  if (deviceId.length <= 6) return "••••••";
  return `${deviceId.slice(0, 4)}••••••${deviceId.slice(-2)}`;
}

// Keys whose string value is a device ID. Works on truncated JSON excerpts too (regex, not a parse).
// `bluetoothName` is the device ID too (Bridge diagnostics lockRssiList, EXP-20260926-01).
const DEVICE_ID_FIELD = /"(deviceId|bridgeId|lockId|lock_id|accessoryId|proxyId|productId|bluetoothName)"(\s*):(\s*)"([^"]+)"/g;

/** Masks device IDs in JSON text that leaves the server (inspector, Try it). The local webhook store keeps full IDs. */
export function redactDeviceIdsInJson(text: string): string {
  return text.replace(DEVICE_ID_FIELD, (_match, key, a, b, id) => `"${key}"${a}:${b}"${redactDeviceId(id)}"`);
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = /^(authorization|cookie|set-cookie)$/i.test(key) ? REDACTED : value;
  }
  return out;
}
