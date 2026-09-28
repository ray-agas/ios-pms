import { describe, expect, test } from "bun:test";

import { checkAlgoPinIssue, checkHealthCheck, type HealthCheckInput } from "@/server/application/safety";

// Health-check guards (plan §13, §20): allowlist, flag, role, device kind, Bridge link, in-flight, rate limits.

const LOCK = "IGB401lock01";
const BRIDGE = "EB1X01bridge";
const SWITCH = "SW1X01switch";
const NOW = new Date("2026-09-26T10:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function input(overrides: Partial<HealthCheckInput> = {}): HealthCheckInput {
  return {
    role: "operator",
    enabled: true,
    allowlist: [LOCK, BRIDGE, SWITCH],
    kind: "lock_battery",
    device: { id: LOCK, kind: "lock" },
    bridgeId: BRIDGE,
    recentJobs: [],
    now: NOW,
    ...overrides,
  };
}

const reason = (i: HealthCheckInput) => {
  const d = checkHealthCheck(i);
  return d.allowed ? "allowed" : d.reason;
};

describe("health-check guards", () => {
  test("allowed on an allowlisted lock with a Bridge", () => {
    expect(checkHealthCheck(input())).toEqual({ allowed: true, jobType: 9, bridgeId: BRIDGE });
    expect(checkHealthCheck(input({ kind: "lock_status" }))).toMatchObject({ allowed: true, jobType: 10 });
    expect(checkHealthCheck(input({ kind: "bridge_diagnostics", device: { id: BRIDGE, kind: "bridge" }, bridgeId: undefined }))).toEqual({
      allowed: true,
      jobType: 10,
      bridgeId: BRIDGE,
    });
  });

  test("viewer, or feature flag off, is refused", () => {
    expect(reason(input({ role: "viewer" }))).toBe("Operator role required");
    expect(reason(input({ role: undefined }))).toBe("Operator role required");
    expect(reason(input({ enabled: false }))).toContain("IGLOOHOME_ENABLE_BRIDGE_JOBS");
  });

  test("non-allowlisted device or Bridge cannot receive a job", () => {
    expect(reason(input({ allowlist: [BRIDGE] }))).toContain("Device is not managed");
    expect(reason(input({ allowlist: [LOCK] }))).toContain("Bridge is not managed");
    expect(reason(input({ allowlist: [] }))).toContain("not managed");
  });

  test("job kind must match the device kind; switch and keypad follow the hardware-proven table (G1)", () => {
    const KEYPAD = { id: "EK2X01keypad", kind: "keypad" as const };
    const sw = { id: SWITCH, kind: "switch" as const };
    // Proven (EXP-20260928-01): regular features, not experiments.
    expect(checkHealthCheck(input({ device: sw }))).toEqual({ allowed: true, jobType: 9, bridgeId: BRIDGE });
    expect(checkHealthCheck(input({ kind: "lock_status", device: sw }))).toMatchObject({ allowed: true });
    const withKeypad = [LOCK, BRIDGE, SWITCH, KEYPAD.id];
    expect(checkHealthCheck(input({ device: KEYPAD, allowlist: withKeypad }))).toMatchObject({ allowed: true, jobType: 9 });
    expect(checkHealthCheck(input({ kind: "pin_create", device: KEYPAD }))).not.toHaveProperty("experimental");
    // Proven not to work: refused with the reason.
    expect(reason(input({ kind: "lock_status", device: KEYPAD }))).toContain("no lock state");
    expect(reason(input({ kind: "pin_create", device: sw }))).toContain("cannot hold PINs");
    expect(reason(input({ kind: "remote_unlock", role: "super_admin", device: KEYPAD }))).toContain("no motor");
    expect(reason(input({ kind: "bridge_diagnostics" }))).toBe("Bridge diagnostics run on a Bridge only");
    expect(reason(input({ kind: "lock_battery", device: { id: BRIDGE, kind: "bridge" } }))).toBe("This Bridge job cannot target a bridge");
  });

  test("G1: a super-admin with experiments on may re-test a combination that did not work; the decision says so", () => {
    const kp = { kind: "lock_status" as const, device: { id: "EK2X01keypad", kind: "keypad" as const } };
    expect(checkHealthCheck(input({ ...kp, role: "super_admin", experiments: true, allowlist: [LOCK, BRIDGE, "EK2X01keypad"] }))).toMatchObject({
      allowed: true,
      experimental: true,
    });
    expect(reason(input({ ...kp, role: "operator", experiments: true }))).toContain("no lock state");
    expect(reason(input({ ...kp, role: "super_admin", experiments: false }))).toContain("no lock state");
    expect(reason(input({ role: "super_admin", experiments: true, device: { id: "IEF01fob", kind: "fob" } }))).toContain("cannot target a fob");
    expect(checkHealthCheck(input({ role: "super_admin", experiments: true }))).not.toHaveProperty("experimental"); // a lock is documented
    expect(reason(input({ kind: "pull_logs" }))).toBe("Super-admin role required");
    expect(checkHealthCheck(input({ kind: "pull_logs", role: "super_admin" }))).toMatchObject({ allowed: true, jobType: 15 });
  });

  test("lock without a reported Bridge link is refused", () => {
    expect(reason(input({ bridgeId: undefined }))).toBe("No Bridge link reported by the API for this device");
  });

  test("one job at a time per device, including unknown outcomes", () => {
    for (const state of ["requested", "queued", "unknown"]) {
      const job = { deviceId: LOCK, bridgeId: BRIDGE, kind: "lock_battery" as const, state, createdAt: ago(30_000) };
      expect(reason(input({ recentJobs: [job] }))).toContain("still waiting for the lock");
    }
    const old = { deviceId: LOCK, bridgeId: BRIDGE, kind: "lock_battery" as const, state: "queued", createdAt: ago(3 * 60_000) };
    expect(reason(input({ recentJobs: [old] }))).toBe("allowed");
    const done = { deviceId: LOCK, bridgeId: BRIDGE, kind: "lock_battery" as const, state: "completed", createdAt: ago(10_000) };
    expect(reason(input({ recentJobs: [done] }))).toBe("allowed");
  });

  test("Bridge diagnostics: max 1 per Bridge per 5 minutes; rejected attempts do not count", () => {
    const bridgeInput = (createdAt: string, state = "completed") =>
      input({
        kind: "bridge_diagnostics",
        device: { id: BRIDGE, kind: "bridge" },
        recentJobs: [{ deviceId: BRIDGE, bridgeId: BRIDGE, kind: "bridge_diagnostics", state, createdAt }],
      });
    const denied = checkHealthCheck(bridgeInput(ago(4 * 60_000)));
    expect(denied).toMatchObject({ allowed: false, retryAt: "2026-09-26T10:01:00.000Z" });
    expect(reason(bridgeInput(ago(5 * 60_000 + 1)))).toBe("allowed");
    expect(reason(bridgeInput(ago(60_000), "rejected"))).toBe("allowed");
  });

  test("a proxied lock-status job (also job 10) starts the Bridge's 5-minute window (E6)", () => {
    const status = { deviceId: LOCK, bridgeId: BRIDGE, kind: "lock_status" as const, state: "completed", createdAt: ago(2 * 60_000) };
    expect(reason(input({ kind: "bridge_diagnostics", device: { id: BRIDGE, kind: "bridge" }, recentJobs: [status] }))).toContain("5 minutes");
    const battery = { ...status, kind: "lock_battery" as const };
    expect(reason(input({ kind: "bridge_diagnostics", device: { id: BRIDGE, kind: "bridge" }, recentJobs: [battery] }))).toBe("allowed");
  });

  test("igloohome's Retry-After blocks the Bridge until it passes", () => {
    const limited = { deviceId: LOCK, bridgeId: BRIDGE, kind: "lock_status" as const, state: "rejected", createdAt: ago(10_000), retryAfterS: 60 };
    expect(checkHealthCheck(input({ recentJobs: [limited] }))).toMatchObject({ allowed: false, retryAt: "2026-09-26T10:00:50.000Z" });
    expect(reason(input({ recentJobs: [{ ...limited, createdAt: ago(61_000) }] }))).toBe("allowed");
  });
});

describe("algoPIN issue guard (M5)", () => {
  const base = {
    role: "operator" as const,
    enabled: true,
    allowlist: [LOCK],
    deviceId: LOCK,
    algoPinCapable: true,
    grantedScopes: ["igloohomeapi/algopin-onetime"],
    scope: "igloohomeapi/algopin-onetime",
  };
  const why = (o: Partial<typeof base>) => {
    const d = checkAlgoPinIssue({ ...base, ...o });
    return d.allowed ? "allowed" : d.reason;
  };
  test("each rule refuses on its own", () => {
    expect(why({})).toBe("allowed");
    expect(why({ role: "viewer" as never })).toBe("Operator role required");
    expect(why({ enabled: false })).toContain("IGLOOHOME_ENABLE_ALGOPIN");
    expect(why({ allowlist: [] })).toContain("not managed by iot-pms");
    expect(why({ algoPinCapable: false })).toContain("algoPIN-capable");
    expect(why({ scope: "igloohomeapi/algopin-permanent" })).toContain("does not grant our client");
  });
});

describe("PIN job guard (M5 E12/E14)", () => {
  const pin = (o: Partial<HealthCheckInput> = {}) =>
    reason(input({ kind: "pin_create", scope: "igloohomeapi/create-pin-bridge-proxied-job", grantedScopes: ["igloohomeapi/create-pin-bridge-proxied-job"], ...o }));
  test("allowed on an allowlisted lock with a Bridge and the scope", () => {
    expect(checkHealthCheck(input({ kind: "pin_delete" }))).toMatchObject({ allowed: true, jobType: 5 });
    expect(pin()).toBe("allowed");
  });
  test("refused without flag, scope, lock kind or Bridge", () => {
    expect(pin({ enabled: false })).toContain("IGLOOHOME_ENABLE_PIN_JOBS");
    expect(pin({ grantedScopes: [] })).toContain("does not grant our client");
    expect(pin({ device: { id: SWITCH, kind: "switch" } })).toContain("cannot hold PINs");
    expect(pin({ bridgeId: undefined })).toContain("No Bridge link");
    expect(pin({ role: "viewer" })).toBe("Operator role required");
  });
});
