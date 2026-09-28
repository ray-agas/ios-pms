import "server-only";

import { z } from "zod";

import { CATALOG_BY_ID } from "../igloohome/catalog";
import type { IgloohomeClient } from "../igloohome/client";
import { ProviderError } from "../igloohome/errors";
import { redact, redactDeviceIdsInJson } from "../igloohome/redaction";

// "Try it" console (integration-architecture.md §8a). Only R0 catalog operations have a parameter schema here, so
// no free-form URL, method or job type can reach igloohome. Jobs (R1) wait for M4's guards.

const limit = z.coerce.number().int().min(1).max(300).optional();
// The browser only knows display IDs; the server resolves them to real IDs from the live device list.
const deviceRef = z.string().regex(/^[A-Z0-9]{4}••••••[A-Za-z0-9]{2}$/, "Pick a device from the list");
const propertyId = z.string().trim().min(1).max(100);

export const TRY_IT_PARAMS = {
  serverHealth: z.object({}),
  listProperties: z.object({ limit }),
  getProperty: z.object({ propertyId }),
  listPropertyDevices: z.object({ propertyId, limit }),
  listDevices: z.object({ limit }),
  listPinCapableDevices: z.object({ limit }),
  getDevice: z.object({ deviceId: deviceRef }),
  listActivity: z.object({ deviceId: deviceRef, limit }),
  getJob: z.object({ jobId: z.string().trim().regex(/^[0-9a-f]{24}$/i, "24 hex characters (MongoDB ObjectId)") }),
} as const;

export type TryItOperation = keyof typeof TRY_IT_PARAMS;

// Form fields for the console; kept next to the schemas (a test checks both list the same operations).
export type TryItField = "limit" | "deviceId" | "propertyId" | "jobId" | "jobType" | "pin" | "reason" | "password";
export const TRY_IT_FIELDS: Record<TryItOperation, TryItField[]> = {
  serverHealth: [],
  listProperties: ["limit"],
  getProperty: ["propertyId"],
  listPropertyDevices: ["propertyId", "limit"],
  listDevices: ["limit"],
  listPinCapableDevices: ["limit"],
  getDevice: ["deviceId"],
  listActivity: ["deviceId", "limit"],
  getJob: ["jobId"],
};

export function isTryItOperation(operation: string): operation is TryItOperation {
  return Object.hasOwn(TRY_IT_PARAMS, operation) && CATALOG_BY_ID.get(operation)?.tryIt === "R0";
}

export type ResolveDevice = (displayId: string) => Promise<string | undefined>;

/** Validates and runs one catalog operation. Returns the parsed body, redacted and with device IDs masked. */
export async function runTryIt(api: IgloohomeClient, resolveDevice: ResolveDevice, operation: string, raw: Record<string, unknown>) {
  if (!isTryItOperation(operation)) throw new ProviderError("forbidden_operation", `"${operation}" is not a Try-it operation`);
  const parsed = TRY_IT_PARAMS[operation].safeParse(raw);
  if (!parsed.success) {
    throw new ProviderError("validation", parsed.error.issues.map((i) => `${i.path.join(".") || "params"}: ${i.message}`).join("; "));
  }
  const p = parsed.data as Record<string, string | number | undefined>;
  const device = async () => {
    const id = await resolveDevice(String(p.deviceId));
    if (!id) throw new ProviderError("validation", "deviceId: not one of the discovered devices");
    return id;
  };
  const page = { limit: p.limit as number | undefined };

  const result = await (async () => {
    switch (operation) {
      case "serverHealth":
        return api.serverHealth();
      case "listProperties":
        return api.listProperties(page);
      case "getProperty":
        return api.getProperty(String(p.propertyId));
      case "listPropertyDevices":
        return api.listPropertyDevices(String(p.propertyId), page);
      case "listDevices":
        return api.listDevices(page);
      case "listPinCapableDevices":
        return api.listPinCapableDevices(page);
      case "getDevice":
        return api.getDevice(await device());
      case "listActivity":
        return api.listActivity(await device(), page);
      case "getJob":
        return api.getJob(String(p.jobId));
    }
  })();
  return redactDeviceIdsInJson(JSON.stringify(redact(result), null, 2));
}
