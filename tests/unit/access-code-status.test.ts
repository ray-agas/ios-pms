import { describe, expect, test } from "bun:test";

import { statusOf, type AccessCodeView } from "@/server/application/access-codes";

// algoPINs are deterministic (same device, type, start hour, variance → same PIN). A delete or use of an earlier
// code with the same PIN must not change a newly issued one (2026-09-28 regression).

const NOW = Date.parse("2026-09-28T08:00:00+07:00");
const base: Omit<AccessCodeView, "status"> = {
  id: 13,
  createdAt: "2026-09-28T00:25:00Z",
  actor: "root",
  deviceRef: "EK2X••••••81",
  type: "daily",
  typeLabel: "Daily",
  accessName: "test",
  variance: 1,
  startAt: "2026-09-28T07:00:00+07:00",
  startMs: Date.parse("2026-09-28T07:00:00+07:00"),
  endMs: Date.parse("2026-10-30T07:00:00+07:00"),
  activateByMs: Date.parse("2026-09-29T07:00:00+07:00"),
  state: "issued",
};

describe("algoPIN status", () => {
  test("a PIN deleted before this code was issued → 'previously deleted', not 'deleted'", () => {
    expect(statusOf({ ...base, deletedBefore: "2026-09-28T00:18:00Z" }, NOW)).toBe("previously_deleted");
  });
  test("a delete after issue wins; a real first use clears the earlier-delete warning", () => {
    expect(statusOf({ ...base, deletedBefore: "2026-09-28T00:18:00Z", deletion: { jobId: 1, state: "completed", jobStatus: 0 } }, NOW)).toBe("deleted");
    expect(statusOf({ ...base, deletedBefore: "2026-09-28T00:18:00Z", firstUse: { at: "2026-09-28T00:30:00Z", logType: 22, receivedAt: "" } }, NOW)).toBe("active");
  });
  test("no use yet → needs activation within 24 h", () => {
    expect(statusOf(base, NOW)).toBe("needs_activation");
  });
});
