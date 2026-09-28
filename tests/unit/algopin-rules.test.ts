import { describe, expect, test } from "bun:test";

import { checkAlgoPin, epochOf, vendorDate, type AlgoPinDraft } from "@/lib/algopin-rules";

// algoPIN rules (DOC: what-is-algopin + Stoplight algoPIN operations). Clock fixed at 2026-09-26 10:20 Asia/Jakarta.

const TZ = "Asia/Jakarta";
const NOW = Date.parse("2026-09-26T03:20:00Z"); // 10:20 +07:00
const check = (d: Partial<AlgoPinDraft>, timeZone = TZ) =>
  checkAlgoPin({ type: "onetime", accessName: "Test", variance: 1, startDate: "2026-09-26", startHour: 11, ...d }, { now: NOW, timeZone });

describe("algoPIN rules", () => {
  test("formats dates exactly on the hour with the property offset", () => {
    expect(vendorDate("2026-09-27", 9, TZ)).toBe("2026-09-27T09:00:00+07:00");
    expect(vendorDate("2026-09-27", 9, "Asia/Kolkata")).toBe("2026-09-27T09:00:00+05:30");
    expect(epochOf("2026-09-27", 9, TZ)).toBe(Date.parse("2026-09-27T02:00:00Z"));
    expect(check({}).body).toEqual({ accessName: "Test", variance: 1, startDate: "2026-09-26T11:00:00+07:00", endDate: undefined });
  });

  test("one-time / permanent: start at the current hour or later", () => {
    expect(check({ startHour: 10 }).errors.start).toBeUndefined(); // current hour (10:00) is allowed
    expect(check({ startHour: 9 }).errors.start).toBe("Start must be the current hour or later");
    expect(check({ type: "permanent", startHour: 9 }).errors.start).toBeDefined();
  });

  test("hourly / daily: start may be up to 1 hour in the past", () => {
    const base = { type: "hourly" as const, endDate: "2026-09-26", endHour: 12 };
    expect(check({ ...base, startHour: 10 }).errors.start).toBeUndefined(); // 20 min ago
    expect(check({ ...base, startHour: 9 }).errors.start).toBe("Start cannot be more than 1 hour in the past"); // 80 min ago
    const at = Date.parse("2026-09-26T02:50:00Z"); // 09:50: 09:00 is 50 min ago, allowed for hourly, not one-time
    const draft = { type: "hourly" as const, accessName: "T", variance: 1, startDate: "2026-09-26", startHour: 9, endDate: "2026-09-26", endHour: 12 };
    expect(checkAlgoPin(draft, { now: at, timeZone: TZ }).errors.start).toBeUndefined();
    expect(checkAlgoPin({ ...draft, type: "onetime" }, { now: at, timeZone: TZ }).errors.start).toBeUndefined(); // 09:00 is the current hour
  });

  test("variance ranges: 1–5 one-time/permanent, 1–3 hourly/daily", () => {
    expect(check({ variance: 5 }).errors.variance).toBeUndefined();
    expect(check({ variance: 6 }).errors.variance).toBe("Variance must be 1 to 5");
    expect(check({ type: "hourly", variance: 4, endDate: "2026-09-26", endHour: 13 }).errors.variance).toBe("Variance must be 1 to 3");
    expect(check({ variance: 0 }).errors.variance).toBeDefined();
  });

  test("hourly: 1 to 672 hours", () => {
    const h = (endDate: string, endHour: number) => check({ type: "hourly", endDate, endHour }).errors.end;
    expect(h("2026-09-26", 12)).toBeUndefined(); // 1 h
    expect(h("2026-09-26", 11)).toContain("1 to 672"); // 0 h
    expect(h("2026-10-24", 11)).toBeUndefined(); // 672 h
    expect(h("2026-10-24", 12)).toContain("1 to 672"); // 673 h
  });

  test("daily: 29 to 367 whole days, end hour forced to the start hour", () => {
    const d = (endDate: string) => check({ type: "daily", endDate, endHour: 3 });
    expect(d("2026-10-25").errors.end).toBeUndefined(); // 29 days
    expect(d("2026-10-24").errors.end).toContain("29 to 367");
    expect(d("2027-09-28").errors.end).toBeUndefined(); // 367 days
    expect(d("2027-09-29").errors.end).toContain("29 to 367");
    expect(d("2026-10-25").body?.endDate).toBe("2026-10-25T11:00:00+07:00"); // endHour ignored
  });

  test("access name required, max 60", () => {
    expect(check({ accessName: "  " }).errors.accessName).toBe("Name is required");
    expect(check({ accessName: "x".repeat(61) }).errors.accessName).toContain("60");
    expect(check({ accessName: " Maintenance " }).body?.accessName).toBe("Maintenance");
  });

  test("warnings: 24 h activation, 256 h no-delete, permanent", () => {
    expect(check({}).warnings).toEqual([]);
    const long = check({ type: "hourly", endDate: "2026-09-28", endHour: 11 });
    expect(long.warnings[0]).toContain("within 24 hours");
    expect(long.activateBy).toBe(epochOf("2026-09-27", 11, TZ));
    expect(check({ startDate: "2026-10-08", startHour: 11 }).warnings.some((w) => w.includes("256"))).toBe(true); // 12 days ahead
    expect(check({ type: "permanent" }).warnings.length).toBe(2);
  });

  test("no body while any rule fails", () => {
    expect(check({ variance: 9 }).body).toBeUndefined();
  });
});
