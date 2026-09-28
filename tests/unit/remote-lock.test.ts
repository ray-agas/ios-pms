import { describe, expect, test } from "bun:test";

import { confirmPassword, unlockLimit } from "@/server/application/remote-lock";
import { checkHealthCheck, type HealthCheckInput } from "@/server/application/safety";
import { IgloohomeClient } from "@/server/igloohome/client";
import { READ_SCOPES, tokenScopes } from "@/lib/scopes";
import { changeOwnPassword, createUser } from "@/server/users";

import { openTestDb } from "../helpers/db";

// Emergency lock/unlock (plan F4b): who may, on what, how often, with which token.

const LOCK = "IGB401lock01";
const BRIDGE = "EB1X01bridge";
const UNLOCK = "igloohomeapi/unlock-bridge-proxied-job";
const LOCKS = "igloohomeapi/lock-bridge-proxied-job";
const NOW = new Date("2026-09-27T10:00:00Z");

const input = (o: Partial<HealthCheckInput> = {}): HealthCheckInput => ({
  role: "super_admin",
  enabled: true,
  allowlist: [LOCK, BRIDGE],
  kind: "remote_unlock",
  device: { id: LOCK, kind: "lock" },
  bridgeId: BRIDGE,
  grantedScopes: [UNLOCK, LOCKS],
  ceiling: [UNLOCK, LOCKS],
  recentJobs: [],
  now: NOW,
  ...o,
});
const why = (o: Partial<HealthCheckInput>) => {
  const d = checkHealthCheck(input(o));
  return d.allowed ? "allowed" : d.reason;
};

describe("emergency guards", () => {
  test("a super-admin may unlock a managed lock with a Bridge: job type 2 (lock: 1)", () => {
    expect(checkHealthCheck(input())).toEqual({ allowed: true, jobType: 2, bridgeId: BRIDGE });
    expect(checkHealthCheck(input({ kind: "remote_lock" }))).toMatchObject({ allowed: true, jobType: 1 });
  });

  test("refused for operators (even with the scope), when off, on non-locks, unmanaged locks, or without the scope", () => {
    expect(why({ role: "operator" })).toBe("Super-admin role required");
    expect(why({ enabled: false })).toContain("IGLOOHOME_ENABLE_REMOTE_LOCK");
    expect(why({ device: { id: LOCK, kind: "switch" } })).toBe("allowed"); // proven on the switch (EXP-20260928-01)
    expect(why({ device: { id: LOCK, kind: "keypad" } })).toContain("no motor");
    expect(why({ allowlist: [BRIDGE] })).toContain("not managed");
    expect(why({ grantedScopes: [LOCKS] })).toContain("unlock-bridge-proxied-job");
    expect(why({ recentJobs: [{ deviceId: LOCK, bridgeId: BRIDGE, kind: "remote_lock", state: "queued", createdAt: NOW.toISOString() }] })).toContain("still waiting for the lock");
  });

  test("at most 3 unlocks per lock in 10 minutes; rejected and older ones do not count", () => {
    const at = (minAgo: number, state = "completed") => ({ deviceId: LOCK, kind: "remote_unlock", state, createdAt: new Date(NOW.getTime() - minAgo * 60_000).toISOString() });
    expect(unlockLimit([at(1), at(2)], LOCK, NOW)).toBeUndefined();
    expect(unlockLimit([at(1), at(2), at(3)], LOCK, NOW)).toContain("3 unlocks");
    expect(unlockLimit([at(1), at(2), at(3, "rejected"), at(11)], LOCK, NOW)).toBeUndefined();
    expect(unlockLimit([at(1), at(2), at(3)], "IGB401other", NOW)).toBeUndefined();
  });
});

describe("tokens and client", () => {
  test("physical scopes reach a token only when asked for; unused scopes never", () => {
    const everything = [...READ_SCOPES, UNLOCK, LOCKS, "igloohomeapi/get-master-pin", "igloohomeapi/create-ekey-access"];
    expect(tokenScopes(everything)).toEqual([...READ_SCOPES].sort());
    expect(tokenScopes([UNLOCK, "igloohomeapi/get-job-status"], true)).toEqual(["igloohomeapi/get-job-status", UNLOCK]);
    expect(tokenScopes(["igloohomeapi/get-master-pin"], true)).toEqual([]);
  });

  test("job types 1/2 only through createLockJob; the health-check path still refuses them", async () => {
    const calls: string[] = [];
    const api = new IgloohomeClient({
      baseUrl: "https://api.example",
      tokens: { getToken: async () => "t", invalidate: () => {} } as never,
      timeoutMs: 1000,
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push(`${init.method} ${url} ${init.body}`);
        return new Response(JSON.stringify({ jobId: "abc" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }) as never,
    });
    expect(() => api.createProxiedJob(LOCK, BRIDGE, 2 as never)).toThrow("not allowed");
    expect(() => api.createLockJob(LOCK, BRIDGE, 9 as never)).toThrow("Only lock (1) and unlock (2)");
    expect(calls).toEqual([]);
    await api.createLockJob(LOCK, BRIDGE, 2);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`/devices/${LOCK}/jobs/bridges/${BRIDGE}`);
    expect(JSON.parse(calls[0].split(" ").slice(2).join(" "))).toEqual({ jobType: 2 }); // no lockTime: it would reset the lock clock
  });
});

describe("password re-entry", () => {
  test("only the signed-in person's current password passes", async () => {
    const db = await openTestDb();
    const made = await createUser({ username: "boss", displayName: "", role: "super_admin" }, "root", db);
    if (!made.ok) throw new Error(made.reason);
    await changeOwnPassword(made.user.id, made.temporaryPassword!, "correct horse battery", db);
    expect(await confirmPassword(made.user.id, "correct horse battery", db)).toBe(true);
    expect(await confirmPassword(made.user.id, "wrong horse battery", db)).toBe(false);
    expect(await confirmPassword(made.user.id, "", db)).toBe(false);
  });
});

describe("step-up confirmation (G1)", () => {
  test("a missing or short reason is refused before the password is even checked", async () => {
    const { checkConfirmation } = await import("@/server/application/step-up");
    const db = await openTestDb();
    const made = await createUser({ username: "boss2", displayName: "", role: "super_admin" }, "root", db);
    if (!made.ok) throw new Error(made.reason);
    await changeOwnPassword(made.user.id, made.temporaryPassword!, "correct horse battery", db);
    const who = { uid: made.user.id, actor: "boss2" };
    const what = { action: "device.experiment", deviceRef: "SW1X••••••30" };
    expect(await checkConfirmation(undefined, who, what)).toContain("Give a reason");
    expect(await checkConfirmation({ reason: "short", password: "correct horse battery" }, who, what)).toContain("Give a reason");
  });

  test("wrong passwords are limited: after 5 failures even the right one is refused for a while", async () => {
    const { checkConfirmation, stepUpLimiter } = await import("@/server/application/step-up");
    const { listAudit } = await import("@/server/users");
    const db = await openTestDb();
    const made = await createUser({ username: "boss3", displayName: "", role: "super_admin" }, "root", db);
    if (!made.ok) throw new Error(made.reason);
    await changeOwnPassword(made.user.id, made.temporaryPassword!, "correct horse battery", db);
    const who = { uid: made.user.id, actor: "boss3" };
    const what = { action: "device.unlock", deviceRef: "IGB4••••••d0" };
    const reason = "E22 test of the limiter";
    expect(await checkConfirmation({ reason, password: "correct horse battery" }, who, what, db)).toBeUndefined();
    for (let i = 0; i < 5; i++) expect(await checkConfirmation({ reason, password: "wrong" }, who, what, db)).toBe("Password is not correct");
    expect(await checkConfirmation({ reason, password: "correct horse battery" }, who, what, db)).toContain("Too many wrong passwords");
    expect((await listAudit(1, db))[0]).toMatchObject({ action: "device.unlock_refused", detail: "too many wrong passwords" });
    stepUpLimiter.reset(`step-up|${made.user.id}`);
  });
});
