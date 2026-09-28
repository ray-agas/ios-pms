import { describe, expect, test } from "bun:test";

import { IgloohomeClient, type ApiCallRecord } from "@/server/igloohome/client";
import { ProviderError } from "@/server/igloohome/errors";
import { toActivityEntry, toDeviceSnapshot, toJobStatus, toTopologyEdges } from "@/server/igloohome/mapping";
import { TokenProvider } from "@/server/igloohome/token";

import * as doc from "../fixtures/igloohome/doc-examples";

// Contract tests against a stubbed fetch, using documented examples. No network.

const BASE = "https://api.igloodeveloper.co/igloohome";
const TOKEN_URL = "https://auth.igloohome.co/oauth2/token";
const SCOPES = ["igloohomeapi/get-devices", "igloohomeapi/get-job-status"];

type Handler = (request: Request) => Response | Promise<Response>;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function harness(apiHandler: Handler) {
  const calls: Request[] = [];
  let tokenCalls = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push(request);
    if (request.url === TOKEN_URL) {
      tokenCalls++;
      return json({ ...doc.tokenResponse, access_token: `token-${tokenCalls}` });
    }
    return apiHandler(request);
  }) as typeof fetch;
  const records: ApiCallRecord[] = [];
  const tokens = new TokenProvider(
    { tokenUrl: TOKEN_URL, clientId: "cid", clientSecret: "csecret", scopes: SCOPES, timeoutMs: 1000 },
    fetchImpl,
  );
  const client = new IgloohomeClient({
    baseUrl: BASE,
    tokens,
    timeoutMs: 1000,
    fetchImpl,
    onCall: (record) => records.push(record),
    sleep: async () => {},
  });
  return { client, calls, records, apiCalls: () => calls.filter((c) => c.url !== TOKEN_URL), tokenCalls: () => tokenCalls };
}

describe("token", () => {
  test("client credentials with Basic auth and explicit scopes, cached", async () => {
    const h = harness(() => json(doc.serverHealth));
    await h.client.serverHealth();
    await h.client.serverHealth();
    const tokenRequest = h.calls.find((c) => c.url === TOKEN_URL)!;
    expect(tokenRequest.headers.get("authorization")).toBe(`Basic ${Buffer.from("cid:csecret").toString("base64")}`);
    const form = new URLSearchParams(await tokenRequest.text());
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("scope")).toBe(SCOPES.join(" "));
    expect(h.tokenCalls()).toBe(1);
  });

  test("refuses to exist without scopes", () => {
    expect(
      () => new TokenProvider({ tokenUrl: TOKEN_URL, clientId: "a", clientSecret: "b", scopes: [], timeoutMs: 1000 }),
    ).toThrow(ProviderError);
  });

  test("invalid_client becomes an auth error", async () => {
    const tokens = new TokenProvider(
      { tokenUrl: TOKEN_URL, clientId: "a", clientSecret: "b", scopes: SCOPES, timeoutMs: 1000 },
      (async () => json({ error: "invalid_client" }, 400)) as unknown as typeof fetch,
    );
    await expect(tokens.getToken()).rejects.toMatchObject({ code: "auth" });
  });

  test("refreshes before expiry (margin)", async () => {
    let now = 0;
    let issued = 0;
    const tokens = new TokenProvider(
      { tokenUrl: TOKEN_URL, clientId: "a", clientSecret: "b", scopes: SCOPES, timeoutMs: 1000 },
      (async () => json({ access_token: `t${++issued}`, expires_in: 86400, token_type: "Bearer" })) as unknown as typeof fetch,
      () => now,
    );
    expect(await tokens.getToken()).toBe("t1");
    now = (86400 - 3600 - 1) * 1000; // just before the 1 h margin
    expect(await tokens.getToken()).toBe("t1");
    now = (86400 - 3600 + 1) * 1000;
    expect(await tokens.getToken()).toBe("t2");
  });
});

describe("reads", () => {
  test("GET /devices with bearer token, JSON headers, documented shape", async () => {
    const h = harness(() => json(doc.deviceList));
    const page = await h.client.listDevices({ limit: 50 });
    const request = h.apiCalls()[0];
    expect(request.url).toBe(`${BASE}/devices?limit=50`);
    expect(request.headers.get("authorization")).toBe("Bearer token-1");
    expect(request.headers.get("accept")).toBe("application/json");
    expect(page.payload[0].deviceId).toBe("EK1X013f300d");
  });

  test("device detail without linkedDevices still parses (Stoplight example)", async () => {
    const h = harness(() => json(doc.deviceDetailStoplight));
    const device = await h.client.getDevice("DLB10001a");
    expect(device.linkedDevices).toEqual([]);
    expect(h.apiCalls()[0].url).toBe(`${BASE}/devices/DLB10001a`);
  });

  test("listAllDevices follows nextCursor until empty", async () => {
    const h = harness((request) => {
      const cursor = new URL(request.url).searchParams.get("cursor");
      return cursor
        ? json({ nextCursor: "", payload: [{ ...doc.deviceList.payload[0], deviceId: "EB1X01aaaaaa", type: "Bridge" }] })
        : json(doc.deviceList);
    });
    const devices = await h.client.listAllDevices();
    expect(devices.map((d) => d.deviceId)).toEqual(["EK1X013f300d", "EB1X01aaaaaa"]);
  });

  test("shape mismatch is a contract error, not silent data", async () => {
    const h = harness(() => json({ payload: [{ deviceName: "no id" }] }));
    await expect(h.client.listDevices()).rejects.toMatchObject({ code: "contract" });
  });
});

describe("retries and safety", () => {
  test("401 → one token refresh, then success", async () => {
    let first = true;
    const h = harness(() => {
      if (first) {
        first = false;
        return json({}, 401);
      }
      return json(doc.serverHealth);
    });
    await h.client.serverHealth();
    expect(h.tokenCalls()).toBe(2);
    expect(h.apiCalls()[1].headers.get("authorization")).toBe("Bearer token-2");
  });

  test("GET retries transient 503 up to 2 times", async () => {
    let attempts = 0;
    const h = harness(() => (++attempts < 3 ? json({}, 503) : json(doc.serverHealth)));
    await h.client.serverHealth();
    expect(attempts).toBe(3);
  });

  test("GET gives up after 2 retries", async () => {
    const h = harness(() => json({}, 503));
    await expect(h.client.serverHealth()).rejects.toMatchObject({ code: "unavailable" });
    expect(h.apiCalls()).toHaveLength(3);
  });

  test("job POST is never retried on 5xx", async () => {
    const h = harness(() => json({}, 503));
    await expect(h.client.createProxiedJob("IGM4aaaaaaaa", "EB1Xbbbbbbbb", 9)).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(h.apiCalls()).toHaveLength(1);
  });

  test("algoPIN POST: documented path and body, PIN redacted in the call log, never retried (M5)", async () => {
    const body = { accessName: "Test", variance: 1, startDate: "2026-09-27T10:00:00+07:00", endDate: "2026-09-27T12:00:00+07:00" };
    const ok = harness(() => json({ pin: "7541869", pinId: "EE4421C77G9F512D" }));
    const created = await ok.client.createAlgoPin("IGB4aaaaaaaa", "hourly", body);
    expect(created.pin).toBe("7541869"); // returned to the use case once
    const [call] = ok.apiCalls();
    expect(new URL(call.url).pathname).toBe("/igloohome/devices/IGB4aaaaaaaa/algopin/hourly");
    expect(JSON.parse(await call.text())).toEqual(body);
    expect(JSON.stringify(ok.records)).not.toContain("7541869");

    const down = harness(() => json({}, 503));
    await expect(down.client.createAlgoPin("IGB4aaaaaaaa", "onetime", body)).rejects.toMatchObject({ code: "unavailable" });
    expect(down.apiCalls()).toHaveLength(1);
  });

  test("PIN jobs: only 4 and 5, PIN redacted in the call log, never retried (M5)", async () => {
    const ok = harness(() => json({ jobId: "6345191a82bcfc12a921bdb6" }));
    await ok.client.createPinJob("IGB4aaaaaaaa", "EB1Xbbbbbbbb", { jobType: 5, jobData: { pin: "482913" } });
    const [call] = ok.apiCalls();
    expect(new URL(call.url).pathname).toBe("/igloohome/devices/IGB4aaaaaaaa/jobs/bridges/EB1Xbbbbbbbb");
    expect(JSON.parse(await call.text())).toEqual({ jobType: 5, jobData: { pin: "482913" } });
    expect(JSON.stringify(ok.records)).not.toContain("482913");

    const guard = harness(() => json({ jobId: "x" }));
    // @ts-expect-error unlock must not be expressible, and is rejected at runtime too
    await expect(guard.client.createPinJob("IGB4aaaaaaaa", "EB1Xbbbbbbbb", { jobType: 2, jobData: {} })).rejects.toMatchObject({ code: "forbidden_operation" });
    expect(guard.apiCalls()).toHaveLength(0);

    const down = harness(() => json({}, 503));
    await expect(down.client.createPinJob("IGB4aaaaaaaa", "EB1Xbbbbbbbb", { jobType: 5, jobData: { pin: "482913" } })).rejects.toMatchObject({ code: "unavailable" });
    expect(down.apiCalls()).toHaveLength(1);
  });

  test("job POST is never retried on 429", async () => {
    const h = harness(() => json(doc.errors.tooManyRequests, 429, { "retry-after": "5" }));
    await expect(h.client.createBridgeDiagnosticsJob("EB1Xbbbbbbbb")).rejects.toMatchObject({ code: "rate_limited" });
    expect(h.apiCalls()).toHaveLength(1);
  });

  test("GET waits Retry-After once on 429", async () => {
    let attempts = 0;
    const h = harness(() => (++attempts === 1 ? json(doc.errors.tooManyRequests, 429, { "retry-after": "5" }) : json(doc.jobStatus)));
    await h.client.getJob("6345191a82bcfc12a921bdb6");
    expect(attempts).toBe(2);
  });

  test("lock/unlock/PIN and unsupported job types are rejected before any request", async () => {
    const h = harness(() => json({ jobId: "x" }));
    // 1/2 only via createLockJob, 4/5 only via createPinJob; 3/14/16 are documented "Not supported". 15 is allowed (G1).
    for (const forbidden of [1, 2, 3, 4, 5, 14, 16, 18]) {
      expect(() => h.client.createProxiedJob("IGM4aaaaaaaa", "EB1Xbbbbbbbb", forbidden as 9)).toThrow(
        "not allowed",
      );
    }
    expect(h.calls).toHaveLength(0);
  });

  test("health-check job sends only the job type to the documented path", async () => {
    const h = harness(() => json({ jobId: "6345191a82bcfc12a921bdb6" }));
    await h.client.createProxiedJob("IGM4aaaaaaaa", "EB1Xbbbbbbbb", 10);
    const request = h.apiCalls()[0];
    expect(request.method).toBe("POST");
    expect(request.url).toBe(`${BASE}/devices/IGM4aaaaaaaa/jobs/bridges/EB1Xbbbbbbbb`);
    expect(await request.json()).toEqual({ jobType: 10 });
  });

  test("406 texts map to Bridge offline / lock not linked", async () => {
    const offline = harness(() => json(doc.errors.bridgeOffline, 406));
    await expect(offline.client.createProxiedJob("IGM4aaaaaaaa", "EB1Xbbbbbbbb", 9)).rejects.toMatchObject({
      code: "bridge_offline",
    });
    const notLinked = harness(() => json(doc.errors.lockNotLinked, 406));
    await expect(notLinked.client.createProxiedJob("IGM4aaaaaaaa", "EB1Xbbbbbbbb", 9)).rejects.toMatchObject({
      code: "lock_not_linked",
    });
  });

  test("call records carry no secrets and redacted device refs", async () => {
    const h = harness(() => json({ ...doc.deviceDetailStoplight, pin: "49667198" }));
    await h.client.getDevice("IGM403fe3b9d");
    const serialized = JSON.stringify(h.records);
    expect(serialized).not.toContain("token-1");
    expect(serialized).not.toContain("csecret");
    expect(serialized).not.toContain("49667198");
    expect(serialized).not.toContain("IGM403fe3b9d");
    expect(h.records[0]).toMatchObject({ operation: "getDevice", deviceRef: "IGM4••••••9d", status: 200, outcome: "ok" });
  });
});

describe("mapping (anti-corruption layer)", () => {
  const at = "2026-09-25T00:00:00.000Z";

  test("keypad from the documented device list", () => {
    const snapshot = toDeviceSnapshot(
      { ...doc.deviceList.payload[0], linkedDevices: doc.deviceList.payload[0].linkedDevices },
      at,
    );
    expect(snapshot).toMatchObject({
      kind: "keypad",
      modelPrefix: "EK1X",
      modelName: "Keypad",
      displayId: "EK1X••••••0d",
      batteryPercent: 100,
      linkedDeviceIds: ["IGP102c1854a"],
      capabilities: { algoPin: true, evidence: "DOC" },
    });
  });

  test("lockStatus casing normalised; absent battery stays absent", () => {
    const withoutBattery: Record<string, unknown> = { ...doc.deviceDetailStoplight };
    delete withoutBattery.batteryLevel;
    const snapshot = toDeviceSnapshot({ ...(withoutBattery as typeof doc.deviceDetailStoplight), linkedDevices: [] }, at);
    expect(snapshot.lockState).toBe("locked");
    expect(snapshot.batteryPercent).toBeUndefined();
    expect(snapshot.kind).toBe("lock"); // unknown prefix falls back to the API type
    expect(snapshot.capabilities.algoPin).toBe("unknown");
  });

  test("switch prefix maps to kind switch even though the API type is unverified", () => {
    const snapshot = toDeviceSnapshot({ deviceId: "SW1X01abcdef", type: "Lock", linkedDevices: [] }, at);
    expect(snapshot.kind).toBe("switch");
    expect(snapshot.capabilities.algoPin).toBe(false);
  });

  test("topology edges are de-duplicated across directions", () => {
    const edges = toTopologyEdges([
      { deviceId: "IGM4aaaaaaaa", type: "Lock", linkedDevices: [{ deviceId: "EB1Xbbbbbbbb", type: "Bridge" }] },
      { deviceId: "EB1Xbbbbbbbb", type: "Bridge", linkedDevices: [{ deviceId: "IGM4aaaaaaaa", type: "Lock" }] },
    ]);
    expect(edges).toHaveLength(1);
  });

  test("polled jobStatus is the job state, verified for 0 and 1 (D23, EXP-20260926-01)", () => {
    const status = toJobStatus(doc.jobStatus);
    expect(status.statusConfidence).toBe("verified");
    expect(status.interpretations.map((i) => i.meaning?.meaning)).toEqual(["Completed"]);
    expect(toJobStatus({ jobId: "x", completed: false, jobResponse: { jobStatus: 1 } }).interpretations[0].meaning?.meaning).toBe("Pending");
    expect(toJobStatus({ jobId: "x", jobResponse: { jobStatus: 2 } }).statusConfidence).toBe("unverified"); // "expired": not seen yet
  });

  test("activity descriptions are PIN-redacted", () => {
    expect(toActivityEntry({ description: "Unlocked with PIN 4642226" }).description).toBe("Unlocked with PIN ••••");
  });
});
