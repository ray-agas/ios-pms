import { describe, expect, test } from "bun:test";

import { checkCustomPin, checkDeletePin, isoInZone, type CustomPinDraft } from "@/lib/pin-job-rules";

// Bridge job 4 / 5 rules (DOC: bridge-jobs-proxied). Clock: 2026-09-26 10:20 Asia/Jakarta.
const TZ = "Asia/Jakarta";
const NOW = Date.parse("2026-09-26T03:20:00Z");
const draft = (d: Partial<CustomPinDraft> = {}): CustomPinDraft => ({
  accessName: "Test",
  pin: "482913",
  pinType: 4,
  startNow: false,
  startDate: "2026-09-26",
  startHour: 11,
  endDate: "2026-09-26",
  endHour: 13,
  ...d,
});
const check = (d: Partial<CustomPinDraft> = {}) => checkCustomPin(draft(d), { now: NOW, timeZone: TZ });

describe("custom PIN (job 4)", () => {
  test("builds the documented jobData with minute-resolution dates", () => {
    expect(check().jobData).toEqual({ accessName: "Test", pin: "482913", pinType: 4, startDate: "2026-09-26T11:00:00+07:00", endDate: "2026-09-26T13:00:00+07:00" });
    expect(isoInZone(Date.parse("2026-09-26T03:21:00Z"), TZ)).toBe("2026-09-26T10:21:00+07:00");
  });
  test("start now = next minute; one-time has no endDate", () => {
    const r = check({ startNow: true, pinType: 1 });
    expect(r.jobData?.startDate).toBe("2026-09-26T10:21:00+07:00");
    expect(r.jobData?.endDate).toBeUndefined();
  });
  test("PIN is 4–6 digits only", () => {
    expect(check({ pin: "123" }).errors.pin).toBeDefined();
    expect(check({ pin: "1234567" }).errors.pin).toBeDefined();
    expect(check({ pin: "12a4" }).errors.pin).toBeDefined();
    expect(check({ pin: "4829" }).errors.pin).toBeUndefined();
  });
  test("start now or later; duration end after start", () => {
    expect(check({ startHour: 10 }).errors.start).toBe("Start must be now or later"); // 10:00 < 10:20
    expect(check({ endHour: 11 }).errors.end).toBe("End must be after start");
    expect(check({ accessName: " " }).errors.accessName).toBeDefined();
  });
});

test("easy-PIN warning only for a full PIN", () => {
  expect(check({ pin: "" }).warnings.some((w) => w.includes("Easy"))).toBe(false);
  expect(check({ pin: "1234" }).warnings.some((w) => w.includes("Easy"))).toBe(true);
  expect(check({ pin: "4321" }).warnings.some((w) => w.includes("Easy"))).toBe(true);
  expect(check({ pin: "482913" }).warnings.some((w) => w.includes("Easy"))).toBe(false);
});

describe("delete PIN (job 5)", () => {
  test("accepts custom and algoPIN lengths", () => {
    expect(checkDeletePin("4829").error).toBeUndefined();
    expect(checkDeletePin("7541869").error).toBeUndefined();
    expect(checkDeletePin("12").error).toBeDefined();
    expect(checkDeletePin("12x4").error).toBeDefined();
  });
});
