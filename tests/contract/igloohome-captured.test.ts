import { describe, expect, test } from "bun:test";

import { toProviderError } from "@/server/igloohome/errors";
import { toDeviceSnapshot, toTopologyEdges } from "@/server/igloohome/mapping";
import {
  devicePageSchema,
  deviceSchema,
  propertyDetailSchema,
  propertyPageSchema,
  serverHealthSchema,
} from "@/server/igloohome/schemas";

import captured from "../fixtures/igloohome/captured-2026-09-25.json";

// Real (sanitized) responses from EXP-20260925-01. If igloohome changes a shape, these fail first.

describe("captured responses match our schemas", () => {
  test("server-health", () => {
    const health = serverHealthSchema.parse(captured.serverHealth.body);
    expect(health.flow).toBe("client_credentials");
    expect(health.tier).toBe("TRIAL");
  });

  test("device list, support-pins, property devices", () => {
    expect(devicePageSchema.parse(captured.deviceList.body).payload).toHaveLength(6);
    expect(devicePageSchema.parse(captured.supportPins.body).payload).toHaveLength(3);
    for (const page of captured.propertyDevices) expect(() => devicePageSchema.parse(page.body)).not.toThrow();
  });

  test("every device detail", () => {
    for (const detail of captured.deviceDetails) expect(() => deviceSchema.parse(detail.body)).not.toThrow();
  });

  test("properties", () => {
    expect(propertyPageSchema.parse(captured.properties.body).payload.every((p) => p.timezone === "Asia/Jakarta")).toBe(
      true,
    );
    expect(() => propertyDetailSchema.parse(captured.propertyDetail.body)).not.toThrow();
  });
});

describe("observed behaviour", () => {
  const devices = captured.deviceDetails.map((detail) => deviceSchema.parse(detail.body));
  const snapshots = devices.map((device) => toDeviceSnapshot(device, "2026-09-25T08:18:40.000Z"));

  test("the switch is reported with API type Lock; we classify it as switch by prefix", () => {
    const sw = snapshots.find((s) => s.modelPrefix === "SW1X")!;
    expect(sw.providerType).toBe("Lock");
    expect(sw.kind).toBe("switch");
  });

  test("links are reported on the Bridge and keypad side, not on the lock side", () => {
    const lockLinks = snapshots.filter((s) => s.kind === "lock").flatMap((s) => s.linkedDeviceIds);
    expect(lockLinks).toEqual([]);
    expect(toTopologyEdges(devices)).toHaveLength(5);
  });

  test("Bridges have no property and no battery", () => {
    for (const bridge of snapshots.filter((s) => s.kind === "bridge")) {
      expect(bridge.propertyIds).toEqual([]);
      expect(bridge.batteryPercent).toBeUndefined();
    }
  });

  test("lockStatus is uppercase on the igloohome API and normalised", () => {
    const raw = devices.map((d) => d.lockStatus).filter(Boolean);
    expect(raw.every((value) => value === value!.toUpperCase())).toBe(true);
    expect(snapshots.filter((s) => s.lockState).every((s) => s.lockState === "locked" || s.lockState === "unlocked")).toBe(
      true,
    );
  });

  test("gateway scope denials are plain-text 'Forbidden' and map to a scope error", () => {
    expect(captured.activityForbidden.status).toBe(403);
    expect(captured.activityForbidden.body).toBe("Forbidden");
    expect(toProviderError(403, captured.activityForbidden.body).code).toBe("scope");
    expect(captured.masterPinWithoutScope.status).toBe(403);
  });
});
