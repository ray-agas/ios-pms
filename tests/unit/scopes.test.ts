import { describe, expect, test } from "bun:test";

import bcrypt from "bcryptjs";

import { checkAlgoPinIssue, checkHealthCheck } from "@/server/application/safety";
import { assignedScopes, getCeiling, recordSync, setUserScopes } from "@/server/application/scopes";
import { TokenProvider } from "@/server/igloohome/token";
import { effectiveScopes, READ_SCOPES, scopeDenial } from "@/lib/scopes";
import { createUser, ensureBootstrap, listAudit } from "@/server/users";

import { openTestDb } from "../helpers/db";

// Per-user igloohome scopes (plan F3).

const s = (name: string) => `igloohomeapi/${name}`;
const CEILING = [...READ_SCOPES, s("algopin-onetime"), s("algopin-hourly"), s("get-battery-level-bridge-proxied-job")];

describe("effective scopes", () => {
  test("super-admin gets the whole ceiling; others get reads plus assigned, never beyond the ceiling", () => {
    expect(effectiveScopes("super_admin", [], CEILING)).toEqual([...CEILING].sort());
    expect(effectiveScopes("operator", [s("algopin-onetime"), s("unlock-bridge-proxied-job")], CEILING)).toEqual([...READ_SCOPES, s("algopin-onetime")].sort());
    expect(effectiveScopes(undefined, [s("algopin-onetime")], CEILING)).toEqual([]);
  });

  test("refusals say whether the user or our client lacks the scope", () => {
    expect(scopeDenial(s("algopin-hourly"), { scopes: READ_SCOPES, ceiling: CEILING })).toContain("a super-admin can grant it");
    expect(scopeDenial(s("algopin-daily"), { scopes: READ_SCOPES, ceiling: CEILING })).toContain("does not grant our client");
    expect(scopeDenial(undefined, { scopes: [], ceiling: [] })).toBeUndefined();
  });

  test("an operator without algopin-hourly is refused before any call; health checks need their job scope", () => {
    const caller = { scopes: effectiveScopes("operator", [s("algopin-onetime")], CEILING), ceiling: CEILING };
    const algo = (scope: string) =>
      checkAlgoPinIssue({ role: "operator", enabled: true, allowlist: ["IGB401lock01"], deviceId: "IGB401lock01", algoPinCapable: true, grantedScopes: caller.scopes, ceiling: caller.ceiling, scope });
    expect(algo(s("algopin-onetime"))).toEqual({ allowed: true });
    expect(algo(s("algopin-hourly"))).toMatchObject({ allowed: false, reason: expect.stringContaining("algopin-hourly") });

    const battery = checkHealthCheck({
      role: "operator",
      enabled: true,
      allowlist: ["IGB401lock01", "EB1X01bridge"],
      kind: "lock_battery",
      device: { id: "IGB401lock01", kind: "lock" },
      bridgeId: "EB1X01bridge",
      grantedScopes: caller.scopes,
      ceiling: caller.ceiling,
      recentJobs: [],
      now: new Date(),
    });
    expect(battery).toMatchObject({ allowed: false, reason: expect.stringContaining("get-battery-level-bridge-proxied-job") });
  });
});

describe("scope storage", () => {
  test("the ceiling falls back to IGLOOHOME_SCOPES until a sync, then the latest sync wins; syncs are audited", async () => {
    const db = await openTestDb();
    expect((await getCeiling(db)).source).toBe("env");
    await recordSync(CEILING, "root", db);
    expect(await recordSync([...CEILING, s("update-device")], "root", db)).toEqual({ added: [s("update-device")], removed: [] });
    expect(await getCeiling(db)).toMatchObject({ source: "sync", syncedBy: "root", scopes: [...CEILING, s("update-device")].sort() });
    expect((await listAudit(5, db))[0]).toMatchObject({ action: "scopes.sync", detail: expect.stringContaining("+update-device") });
  });

  test("assigning: read scopes are implicit, unknown ones refused, super-admins not editable, changes audited", async () => {
    const db = await openTestDb();
    const hash = bcrypt.hashSync("x-long-password", 4);
    await ensureBootstrap({ fallback: { username: "root", passwordHash: hash, role: "super_admin" } } as never, db);
    const op = await createUser({ username: "ops", displayName: "", role: "operator" }, "root", db);
    if (!op.ok) throw new Error(op.reason);

    expect(await setUserScopes(op.user.id, [s("algopin-onetime"), s("get-devices")], "root", db)).toEqual({ ok: true, scopes: [s("algopin-onetime")] });
    expect(await assignedScopes(op.user.id, db)).toEqual([s("algopin-onetime")]);
    expect(await setUserScopes(op.user.id, ["igloohomeapi/made-up"], "root", db)).toMatchObject({ ok: false, reason: expect.stringContaining("made-up") });
    expect(await setUserScopes(1, [s("algopin-onetime")], "root", db)).toMatchObject({ ok: false, reason: expect.stringContaining("super-admin") });

    await setUserScopes(op.user.id, [s("algopin-hourly")], "root", db);
    const event = (await listAudit(10, db)).find((e) => e.action === "user.scopes");
    expect(event).toMatchObject({ target: "ops", detail: "+algopin-hourly -algopin-onetime" });
  });
});

describe("tokens", () => {
  const settings = { tokenUrl: "https://auth.example/token", clientId: "id", clientSecret: "secret", timeoutMs: 1000 };
  const capture = () => {
    const bodies: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return new Response(JSON.stringify({ access_token: "t", expires_in: 86400, token_type: "Bearer" }), { status: 200 });
    }) as unknown as typeof fetch;
    return { bodies, fetchImpl };
  };

  test("a user's token carries exactly their scopes", async () => {
    const { bodies, fetchImpl } = capture();
    await new TokenProvider({ ...settings, scopes: [s("get-devices"), s("algopin-onetime")] }, fetchImpl).getToken();
    expect(new URLSearchParams(bodies[0]).get("scope")).toBe(`${s("get-devices")} ${s("algopin-onetime")}`);
  });

  test("only the explicit sync mode omits scope; an empty list is still refused", async () => {
    const { bodies, fetchImpl } = capture();
    expect(() => new TokenProvider({ ...settings, scopes: [] }, fetchImpl)).toThrow("without explicit scopes");
    await new TokenProvider({ ...settings, scopes: [] }, fetchImpl, Date.now, true).getToken();
    expect(new URLSearchParams(bodies[0]).has("scope")).toBe(false);
  });
});
