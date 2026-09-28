import "server-only";

import { redactFreeText } from "./redaction";

// Typed errors for every documented failure (integration-architecture.md §5).
// Messages are redacted before they are stored, because vendor error text can quote PINs.

export type ProviderErrorCode =
  | "unavailable"
  | "auth"
  | "validation"
  | "subscription"
  | "scope"
  | "not_found"
  | "bridge_offline"
  | "lock_not_linked"
  | "not_acceptable"
  | "data_integrity"
  | "unsupported"
  | "rate_limited"
  | "contract"
  | "forbidden_operation";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;
  readonly retryAfterSeconds?: number;

  constructor(code: ProviderErrorCode, message: string, options: { status?: number; retryAfterSeconds?: number } = {}) {
    super(redactFreeText(message));
    this.name = "ProviderError";
    this.code = code;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

function vendorMessage(body: unknown): string {
  if (typeof body === "string") return body;
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const key of ["error", "message", "msg"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
  }
  return "";
}

export function toProviderError(status: number, body: unknown, retryAfterHeader?: string | null): ProviderError {
  const text = vendorMessage(body);
  const lower = text.toLowerCase();
  const withText = (fallback: string) => text || fallback;

  switch (status) {
    case 400:
    case 422:
      return new ProviderError("validation", withText("Request rejected by igloohome"), { status });
    case 401:
      return new ProviderError("auth", "igloohome rejected the credentials or token", { status });
    case 402:
      return new ProviderError("subscription", withText("igloohome subscription or trial issue"), { status });
    case 403:
      return new ProviderError("scope", withText("Token lacks the required scope or access was revoked"), { status });
    case 404:
      return new ProviderError("not_found", withText("Not found"), { status });
    case 406:
      // Documented strings: "Unable to contact bridge as it appears to be offline", "Lock is not linked to bridge".
      if (lower.includes("offline")) return new ProviderError("bridge_offline", text, { status });
      if (lower.includes("not linked")) return new ProviderError("lock_not_linked", text, { status });
      return new ProviderError("not_acceptable", withText("Not acceptable"), { status });
    case 409:
      if (lower.includes("timezone")) return new ProviderError("data_integrity", text, { status });
      return new ProviderError("validation", withText("Conflict"), { status });
    case 418:
      return new ProviderError("unsupported", withText("Not supported by this device model"), { status });
    case 429: {
      const seconds = Number(retryAfterHeader);
      return new ProviderError("rate_limited", withText("Too many requests"), {
        status,
        retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : undefined,
      });
    }
    default:
      return new ProviderError("unavailable", withText(`igloohome returned HTTP ${status}`), { status });
  }
}
