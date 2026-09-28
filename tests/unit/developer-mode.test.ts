import { describe, expect, test } from "bun:test";

import { isTryItOperation, runTryIt, TRY_IT_FIELDS, TRY_IT_PARAMS } from "@/server/application/try-it";
import { CATALOG, decodeStatus } from "@/server/igloohome/catalog";
import { IgloohomeClient } from "@/server/igloohome/client";
import { ProviderError } from "@/server/igloohome/errors";
import { redactDeviceIdsInJson } from "@/server/igloohome/redaction";
import { listApiCalls, recordApiCall } from "@/server/storage/api-calls";
import { openTestDb } from "../helpers/db";

// Developer mode guards (plan §20): "Try it" cannot call anything outside the catalog, and nothing it shows
// carries a full device ID.

const LOCK = "IGB401lock01";
const LOCK_DISPLAY = "IGB4••••••01";

function fakeClient() {
  const calls: string[] = [];
  const device = { deviceId: LOCK, deviceName: "Doorlock", type: "Lock", linkedDevices: [{ deviceId: "EB1X01bridge", type: "Bridge" }] };
  const handler = {
    get(_target: object, method: string) {
      return async (...args: unknown[]) => {
        calls.push(`${method}(${args.map((a) => JSON.stringify(a)).join(",")})`);
        return method === "getDevice" ? device : { payload: [] };
      };
    },
  };
  return { api: new Proxy({}, handler) as IgloohomeClient, calls };
}

const resolve = async (display: string) => (display === LOCK_DISPLAY ? LOCK : undefined);

describe("Try it", () => {
  test("only R0 catalog operations are runnable; jobs and unknown names are rejected before any call", async () => {
    for (const op of ["createProxiedJob", "createBridgeDiagnosticsJob", "listAllDevices", "request", "__proto__", "constructor"]) {
      expect(isTryItOperation(op)).toBe(false);
      const { api, calls } = fakeClient();
      await expect(runTryIt(api, resolve, op, {})).rejects.toMatchObject({ code: "forbidden_operation" });
      expect(calls).toEqual([]);
    }
    for (const entry of CATALOG) expect(isTryItOperation(entry.id)).toBe(entry.tryIt === "R0");
  });

  test("form fields and schemas cover the same operations", () => {
    expect(Object.keys(TRY_IT_FIELDS).sort()).toEqual(Object.keys(TRY_IT_PARAMS).sort());
  });

  test("validates parameters before calling igloohome", async () => {
    const { api, calls } = fakeClient();
    await expect(runTryIt(api, resolve, "listDevices", { limit: "0" })).rejects.toBeInstanceOf(ProviderError);
    await expect(runTryIt(api, resolve, "getJob", { jobId: "not-an-object-id" })).rejects.toMatchObject({ code: "validation" });
    await expect(runTryIt(api, resolve, "getDevice", { deviceId: LOCK })).rejects.toMatchObject({ code: "validation" }); // full ID not accepted
    await expect(runTryIt(api, resolve, "getDevice", { deviceId: "DBX2••••••99" })).rejects.toMatchObject({ code: "validation" });
    expect(calls).toEqual([]);
  });

  test("resolves display IDs on the server and masks IDs in the response", async () => {
    const { api, calls } = fakeClient();
    const body = await runTryIt(api, resolve, "getDevice", { deviceId: LOCK_DISPLAY });
    expect(calls).toEqual([`getDevice("${LOCK}")`]);
    expect(body).not.toContain(LOCK);
    expect(body).not.toContain("EB1X01bridge");
    expect(body).toContain(LOCK_DISPLAY);
  });

  test("extra parameters are ignored, not forwarded", async () => {
    const { api, calls } = fakeClient();
    await runTryIt(api, resolve, "listDevices", { limit: "5", admin_key: "x", url: "https://evil" });
    expect(calls).toEqual([`listDevices({"limit":5})`]);
  });
});

describe("catalog", () => {
  test("every entry maps to a real client method and an official doc page", () => {
    for (const entry of CATALOG) {
      expect(typeof (IgloohomeClient.prototype as unknown as Record<string, unknown>)[entry.id]).toBe("function");
      expect(entry.docUrl).toMatch(/^https:\/\/docs\.igloohome\.co\/home\/[a-z_-]+$/); // D20
      expect(entry.inventoryRef).toMatch(/^H\d+(–H\d+)?$/);
    }
  });

  test("decodes documented statuses per operation", () => {
    expect(decodeStatus("createBridgeDiagnosticsJob", 429)).toContain("Too many requests");
    expect(decodeStatus("getDevice", 409)).toBe("timezone is not found on property");
    expect(decodeStatus("getDevice", 200)).toBe("Success");
    expect(decodeStatus("getDevice", 418)).toBeUndefined();
  });
});

describe("api call log", () => {
  test("masks device IDs in stored excerpts, even truncated ones", async () => {
    const db = await openTestDb();
    const truncated = `{"payload":[{"deviceId":"${LOCK}","linkedDevices":[{"deviceId":"EB1X01bridge"}]},{"deviceId":"SW1X01switch`;
    await recordApiCall(db, { operation: "listDevices", method: "GET", pathTemplate: "/devices", status: 200, latencyMs: 12, outcome: "ok", responseExcerpt: truncated }, "app");
    const [row] = await listApiCalls(db);
    expect(row.responseExcerpt).not.toContain(LOCK);
    expect(row.responseExcerpt).not.toContain("EB1X01bridge");
    expect(row.responseExcerpt).toContain(LOCK_DISPLAY);
    expect(redactDeviceIdsInJson(`{"bridgeId" : "EB1X01bridge"}`)).toBe(`{"bridgeId" : "EB1X••••••ge"}`);
    // Bridge diagnostics: the Bluetooth name is the device ID (EXP-20260926-01).
    expect(redactDeviceIdsInJson(`{"lockRssiList":[{"bluetoothName":"${LOCK}","rssi":-80}]}`)).not.toContain(LOCK);
  });
});
