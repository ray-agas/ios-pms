// Custom PIN (Bridge job 4) and Delete PIN (Bridge job 5) rules, shared by form and server.
// Source: docs.igloohome.co/home/bridge-jobs-proxied (snapshot 2026-09-25). Evidence: DOC until E12/E14.

import { epochOf, vendorDate } from "./algopin-rules";

export const CUSTOM_PIN_TYPES = {
  1: { label: "One-time", hint: "Valid for 24 hours from the start", needsEnd: false },
  4: { label: "Duration", hint: "Valid between start and end", needsEnd: true },
  2: { label: "Permanent", hint: "No end; stays until deleted", needsEnd: false },
} as const;
export type CustomPinType = keyof typeof CUSTOM_PIN_TYPES;

export interface CustomPinDraft {
  accessName: string;
  pin: string;
  pinType: CustomPinType;
  startNow: boolean; // "now" = current time + 1 min (the lock needs "now or after"; minutes are allowed for job 4)
  startDate: string;
  startHour: number;
  endDate?: string;
  endHour?: number;
}

export interface CustomPinJobData {
  accessName: string;
  pin: string;
  pinType: CustomPinType;
  startDate: string;
  endDate?: string;
}

const HOUR = 3_600_000;

/** `YYYY-MM-DDTHH:mm:ss+hh:mm` for an instant, in `timeZone` (job 4 accepts minutes, unlike algoPIN). */
export function isoInZone(ms: number, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(ms)
      .map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return vendorDate(date, Number(parts.hour), timeZone).replace(/T\d{2}:00:00/, `T${parts.hour}:${parts.minute}:00`);
}

export function checkCustomPin(draft: CustomPinDraft, opts: { now: number; timeZone: string }) {
  const { now, timeZone } = opts;
  const errors: Partial<Record<"accessName" | "pin" | "pinType" | "start" | "end", string>> = {};
  const warnings: string[] = [];
  const type = CUSTOM_PIN_TYPES[draft.pinType];
  if (!type) errors.pinType = "Pick a PIN type";

  const accessName = draft.accessName.trim();
  if (!accessName) errors.accessName = "Name is required";
  if (!/^\d{4,6}$/.test(draft.pin)) errors.pin = "4 to 6 digits, 0–9 only";

  const startMs = draft.startNow ? Math.ceil((now + 60_000) / 60_000) * 60_000 : epochOf(draft.startDate, draft.startHour, timeZone);
  if (!draft.startNow && startMs < now) errors.start = "Start must be now or later";

  let endMs: number | undefined;
  if (type?.needsEnd) {
    if (!draft.endDate || draft.endHour === undefined) errors.end = "Pick an end";
    else {
      endMs = epochOf(draft.endDate, draft.endHour, timeZone);
      if (endMs <= startMs) errors.end = "End must be after start";
    }
  }
  if (draft.pinType === 1) endMs = startMs + 24 * HOUR;

  warnings.push("Written into the lock's PIN storage through the Bridge (199 slots shared with algoPINs). The Bridge must be online.");
  if (draft.pinType === 2) warnings.push("Permanent: stays on the lock until a Delete PIN job removes it.");
  const easy = /^(\d)\1+$/.test(draft.pin) || "0123456789".includes(draft.pin) || "9876543210".includes(draft.pin);
  if (draft.pin.length >= 4 && easy) warnings.push("Easy to guess PIN (repeated or sequential digits).");

  const ok = Object.keys(errors).length === 0;
  const jobData: CustomPinJobData | undefined = ok
    ? {
        accessName,
        pin: draft.pin,
        pinType: draft.pinType,
        startDate: isoInZone(startMs, timeZone),
        endDate: type.needsEnd && endMs !== undefined ? isoInZone(endMs, timeZone) : undefined,
      }
    : undefined;
  return { errors, warnings, startMs, endMs, jobData };
}

export function checkDeletePin(pin: string) {
  // algoPINs are longer than custom PINs (7+ digits seen in EXP-20260926-02), so accept 4–12 digits.
  const ok = /^\d{4,12}$/.test(pin);
  return {
    error: ok ? undefined : "4 to 12 digits, 0–9 only",
    warnings: [
      "Deleting is permanent. A missing PIN finishes with jobStatus 3 (PIN not found).",
      "algoPINs: unactivated ones can only be deleted within one week of their start; ones issued > 256 h ahead can never be deleted.",
    ],
  };
}
