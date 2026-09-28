import { describe, expect, test } from "bun:test";

import { toProviderError } from "@/server/igloohome/errors";
import { REDACTED, redact, redactDeviceId, redactFreeText, redactHeaders } from "@/server/igloohome/redaction";

import { errors } from "../fixtures/igloohome/doc-examples";

describe("redaction", () => {
  test("redacts every known secret key, at any depth", () => {
    const input = {
      access_token: "eyJ.secret",
      client_secret: "s3cr3t",
      nested: { pin: "123456", newPin: "654321", bluetoothGuestKey: "base64key==", admin_key: "k" },
      list: [{ customPin: "5837" }],
      password: "hunter2",
      // server-health returns the OAuth client id and user ref; treated as secret (environment-configuration.md)
      clientId: "7k8m9n0p1q2r3s4t5u6v7w8x",
      userRef: "user_abc123def456",
    };
    const json = JSON.stringify(redact(input));
    for (const secret of [
      "eyJ.secret",
      "s3cr3t",
      "123456",
      "654321",
      "base64key==",
      "5837",
      "hunter2",
      "7k8m9n0p1q2r3s4t5u6v7w8x",
      "user_abc123def456",
    ]) {
      expect(json).not.toContain(secret);
    }
    expect(json).toContain(REDACTED);
  });

  test("scrubs bearer/basic credentials inside strings", () => {
    expect(redact("Authorization failed for Bearer abc.def.ghi")).toBe(`Authorization failed for Bearer ${REDACTED}`);
    expect(redact({ note: "Basic dXNlcjpwYXNz" })).toEqual({ note: `Basic ${REDACTED}` });
  });

  test("does not mangle timestamps or device ids outside free text", () => {
    const value = { pairedAt: "2022-06-30T17:00:00+08:00", deviceId: "IGP102c1854a", batteryLevel: 87 };
    expect(redact(value)).toEqual(value);
  });

  test("redacts PIN-like digits in free-text fields", () => {
    expect(redactFreeText("Unlocked by PIN 4642226")).toBe("Unlocked by PIN ••••");
    expect(redact({ description: "Wrong PIN 123456 entered" })).toEqual({ description: "Wrong PIN •••• entered" });
  });

  test("device ids keep the model prefix only", () => {
    expect(redactDeviceId("IGB403fe3b9d")).toBe("IGB4••••••9d");
    expect(redactDeviceId("abc")).toBe("••••••");
  });

  test("masks auth and cookie headers", () => {
    expect(redactHeaders({ Authorization: "Bearer x", Cookie: "a=b", Accept: "application/json" })).toEqual({
      Authorization: REDACTED,
      Cookie: REDACTED,
      Accept: "application/json",
    });
  });
});

describe("error mapping (documented bodies)", () => {
  test.each([
    [401, {}, "auth"],
    [402, errors.trialEnded, "subscription"],
    [403, {}, "scope"],
    [404, { message: "not found device" }, "not_found"],
    [406, errors.bridgeOffline, "bridge_offline"],
    [406, errors.lockNotLinked, "lock_not_linked"],
    [406, { error: "something else" }, "not_acceptable"],
    [409, errors.timezoneMissing, "data_integrity"],
    [418, errors.unsupported, "unsupported"],
    [429, errors.tooManyRequests, "rate_limited"],
    [500, {}, "unavailable"],
    [503, "plain text body", "unavailable"],
  ] as const)("HTTP %i → %s", (status, body, code) => {
    expect(toProviderError(status, body, "45").code).toBe(code);
  });

  test("429 carries Retry-After seconds", () => {
    expect(toProviderError(429, errors.tooManyRequests, "45").retryAfterSeconds).toBe(45);
  });

  test("error messages are redacted", () => {
    expect(toProviderError(400, { error: "PIN 123456 is already taken" }).message).not.toContain("123456");
  });
});
