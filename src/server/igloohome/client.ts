import "server-only";

import type { z } from "zod";

import type { AlgoPinType } from "@/lib/algopin-rules";
import { BRIDGE_DIAGNOSTICS_JOB_TYPE, HEALTH_CHECK_JOB_TYPES, PULL_LOGS_JOB_TYPE } from "./codes";
import { ProviderError, toProviderError } from "./errors";
import { redact, redactDeviceId } from "./redaction";
import {
  activityPageSchema,
  deviceSchema,
  devicePageSchema,
  algoPinCreatedSchema,
  jobCreatedSchema,
  jobStatusSchema,
  propertyDetailSchema,
  propertyPageSchema,
  serverHealthSchema,
  type VendorDevice,
} from "./schemas";
import type { TokenProvider } from "./token";

// The only place that builds igloohome URLs. Only documented slice-1 operations exist here
// (integration-architecture.md §4.2). Job POSTs are never retried; GETs retry on transient failures.

export type HealthCheckJobType = (typeof HEALTH_CHECK_JOB_TYPES)[keyof typeof HEALTH_CHECK_JOB_TYPES] | typeof PULL_LOGS_JOB_TYPE;
const ALLOWED_PROXIED_JOB_TYPES: readonly number[] = [...Object.values(HEALTH_CHECK_JOB_TYPES), PULL_LOGS_JOB_TYPE];

export interface ApiCallRecord {
  operation: string;
  method: "GET" | "POST";
  pathTemplate: string;
  deviceRef?: string;
  status?: number;
  latencyMs: number;
  outcome: "ok" | ProviderError["code"];
  requestExcerpt?: string;
  responseExcerpt?: string;
}

export interface ClientOptions {
  baseUrl: string;
  tokens: TokenProvider;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  onCall?: (record: ApiCallRecord) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface PageQuery {
  limit?: number;
  cursor?: string;
  sort?: "asc" | "desc";
}

interface RequestSpec<S extends z.ZodType> {
  operation: string;
  method: "GET" | "POST";
  pathTemplate: string;
  pathParams?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  schema: S;
  deviceId?: string;
}

const GET_RETRIES = 2;
const MAX_RETRY_AFTER_SECONDS = 30;
const EXCERPT_LIMIT = 2000;
const MAX_PAGES = 50;

function excerpt(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const text = JSON.stringify(redact(value));
  return text.length > EXCERPT_LIMIT ? `${text.slice(0, EXCERPT_LIMIT)}…` : text;
}

export class IgloohomeClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: ClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  // --- Connection ---------------------------------------------------------
  serverHealth() {
    return this.request({ operation: "serverHealth", method: "GET", pathTemplate: "/server-health", schema: serverHealthSchema });
  }

  // --- Properties ---------------------------------------------------------
  listProperties(query: PageQuery = {}) {
    return this.request({ operation: "listProperties", method: "GET", pathTemplate: "/properties", query: { ...query }, schema: propertyPageSchema });
  }

  getProperty(propertyId: string) {
    return this.request({
      operation: "getProperty",
      method: "GET",
      pathTemplate: "/properties/{propertyId}",
      pathParams: { propertyId },
      schema: propertyDetailSchema,
    });
  }

  listPropertyDevices(propertyId: string, query: PageQuery = {}) {
    return this.request({
      operation: "listPropertyDevices",
      method: "GET",
      pathTemplate: "/properties/{propertyId}/devices",
      pathParams: { propertyId },
      query: { ...query },
      schema: devicePageSchema,
    });
  }

  // --- Devices ------------------------------------------------------------
  listDevices(query: PageQuery & { type?: string } = {}) {
    return this.request({ operation: "listDevices", method: "GET", pathTemplate: "/devices", query: { ...query }, schema: devicePageSchema });
  }

  /** Follows `nextCursor` until it is empty. Capped so an unexpected cursor cannot loop forever. */
  async listAllDevices(): Promise<VendorDevice[]> {
    const devices: VendorDevice[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await this.listDevices({ limit: 300, cursor });
      devices.push(...result.payload);
      if (!result.nextCursor) return devices;
      cursor = result.nextCursor;
    }
    throw new ProviderError("contract", `Pagination did not end after ${MAX_PAGES} pages`);
  }

  listPinCapableDevices(query: PageQuery = {}) {
    return this.request({
      operation: "listPinCapableDevices",
      method: "GET",
      pathTemplate: "/devices/support-pins",
      query: { ...query },
      schema: devicePageSchema,
    });
  }

  getDevice(deviceId: string) {
    return this.request({
      operation: "getDevice",
      method: "GET",
      pathTemplate: "/devices/{deviceId}",
      pathParams: { deviceId },
      deviceId,
      schema: deviceSchema,
    });
  }

  listActivity(deviceId: string, query: PageQuery & { startDate?: string; endDate?: string; locale?: string } = {}) {
    return this.request({
      operation: "listActivity",
      method: "GET",
      pathTemplate: "/devices/{deviceId}/activity",
      pathParams: { deviceId },
      deviceId,
      query: { ...query },
      schema: activityPageSchema,
    });
  }

  // --- Bridge jobs (read-type only) --------------------------------------
  createProxiedJob(deviceId: string, bridgeId: string, jobType: HealthCheckJobType) {
    // Runtime guard as well as the type: lock/unlock/PIN jobs must not be reachable in slice 1.
    if (!ALLOWED_PROXIED_JOB_TYPES.includes(jobType)) {
      throw new ProviderError("forbidden_operation", `Job type ${jobType} is not allowed in this version`);
    }
    return this.request({
      operation: "createProxiedJob",
      method: "POST",
      pathTemplate: "/devices/{deviceId}/jobs/bridges/{bridgeId}",
      pathParams: { deviceId, bridgeId },
      deviceId,
      body: { jobType },
      schema: jobCreatedSchema,
    });
  }

  /** M5 (R2): Bridge job 4 (create custom PIN) or 5 (delete PIN). Separate from createProxiedJob so lock/unlock stay unreachable. */
  async createPinJob(deviceId: string, bridgeId: string, job: { jobType: 4; jobData: object } | { jobType: 5; jobData: { pin: string } }) {
    if (job.jobType !== 4 && job.jobType !== 5) throw new ProviderError("forbidden_operation", "Only PIN jobs 4 and 5 are allowed here");
    return this.request({
      operation: "createPinJob",
      method: "POST",
      pathTemplate: "/devices/{deviceId}/jobs/bridges/{bridgeId}",
      pathParams: { deviceId, bridgeId },
      deviceId,
      body: { jobType: job.jobType, jobData: job.jobData },
      schema: jobCreatedSchema,
    });
  }

  /**
   * Plan F4b (R3, physical): Bridge job 1 (lock) or 2 (unlock). The only path to these job types; used only by the
   * guarded emergency flow. `lockTime` is never sent (it would reset the lock's clock).
   */
  createLockJob(deviceId: string, bridgeId: string, jobType: 1 | 2) {
    if (jobType !== 1 && jobType !== 2) throw new ProviderError("forbidden_operation", "Only lock (1) and unlock (2) are allowed here");
    return this.request({
      operation: "createLockJob",
      method: "POST",
      pathTemplate: "/devices/{deviceId}/jobs/bridges/{bridgeId}",
      pathParams: { deviceId, bridgeId },
      deviceId,
      body: { jobType },
      schema: jobCreatedSchema,
    });
  }

  createBridgeDiagnosticsJob(bridgeId: string) {
    return this.request({
      operation: "createBridgeDiagnosticsJob",
      method: "POST",
      pathTemplate: "/devices/{bridgeId}/jobs",
      pathParams: { bridgeId },
      deviceId: bridgeId,
      body: { jobType: BRIDGE_DIAGNOSTICS_JOB_TYPE },
      schema: jobCreatedSchema,
    });
  }

  // --- algoPIN (M5, R2) -----------------------------------------------------
  /** H17–H20. Body already checked by lib/algopin-rules. POST: never retried (a retry could mint another variance). */
  createAlgoPin(deviceId: string, type: AlgoPinType, body: { accessName: string; variance: number; startDate: string; endDate?: string }) {
    return this.request({
      operation: "createAlgoPin",
      method: "POST",
      pathTemplate: `/devices/{deviceId}/algopin/${type}`,
      pathParams: { deviceId },
      deviceId,
      body,
      schema: algoPinCreatedSchema,
    });
  }

  getJob(jobId: string) {
    return this.request({ operation: "getJob", method: "GET", pathTemplate: "/jobs/{jobId}", pathParams: { jobId }, schema: jobStatusSchema });
  }

  // --- Transport ----------------------------------------------------------
  private buildUrl(spec: RequestSpec<z.ZodType>): string {
    let path = spec.pathTemplate;
    for (const [key, value] of Object.entries(spec.pathParams ?? {})) {
      path = path.replace(`{${key}}`, encodeURIComponent(value));
    }
    const url = new URL(this.options.baseUrl.replace(/\/+$/, "") + path);
    for (const [key, value] of Object.entries(spec.query ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async request<S extends z.ZodType>(spec: RequestSpec<S>): Promise<z.infer<S>> {
    const url = this.buildUrl(spec);
    let tokenRefreshed = false;
    let retries = 0;
    let waitedForRateLimit = false;

    for (;;) {
      const started = Date.now();
      const record: ApiCallRecord = {
        operation: spec.operation,
        method: spec.method,
        pathTemplate: spec.pathTemplate,
        deviceRef: spec.deviceId ? redactDeviceId(spec.deviceId) : undefined,
        latencyMs: 0,
        outcome: "ok",
        requestExcerpt: excerpt(spec.body),
      };

      try {
        const token = await this.options.tokens.getToken();
        let response: Response;
        try {
          response = await this.fetchImpl(url, {
            method: spec.method,
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
            signal: AbortSignal.timeout(this.options.timeoutMs),
          });
        } catch (cause) {
          throw new ProviderError("unavailable", `igloohome unreachable: ${(cause as Error).name}`);
        }

        record.status = response.status;
        const text = await response.text();
        let body: unknown = text;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          // Some documented errors are plain text; keep the string.
        }
        record.responseExcerpt = excerpt(body);

        if (!response.ok) throw toProviderError(response.status, body, response.headers.get("retry-after"));

        const parsed = spec.schema.safeParse(body);
        if (!parsed.success) {
          const where = parsed.error.issues.map((issue) => issue.path.join(".") || "(root)").join(", ");
          throw new ProviderError("contract", `Response did not match the documented shape at: ${where}`, {
            status: response.status,
          });
        }
        record.latencyMs = Date.now() - started;
        this.options.onCall?.(record);
        return parsed.data;
      } catch (error) {
        const providerError =
          error instanceof ProviderError ? error : new ProviderError("unavailable", (error as Error).message);
        record.outcome = providerError.code;
        record.latencyMs = Date.now() - started;
        this.options.onCall?.(record);

        // 401: the request was rejected before processing, so one retry with a fresh token is safe for any method.
        if (providerError.code === "auth" && providerError.status === 401 && !tokenRefreshed) {
          tokenRefreshed = true;
          this.options.tokens.invalidate();
          continue;
        }
        // Everything below applies to GET only. Job POSTs are never retried: a duplicate job is worse than none.
        if (spec.method === "GET") {
          if (providerError.code === "unavailable" && retries < GET_RETRIES) {
            retries++;
            await this.sleep(250 * 2 ** retries + Math.floor(Math.random() * 100));
            continue;
          }
          const retryAfter = providerError.retryAfterSeconds;
          if (
            providerError.code === "rate_limited" &&
            !waitedForRateLimit &&
            retryAfter !== undefined &&
            retryAfter <= MAX_RETRY_AFTER_SECONDS
          ) {
            waitedForRateLimit = true;
            await this.sleep(retryAfter * 1000);
            continue;
          }
        }
        throw providerError;
      }
    }
  }
}
