// algoPIN request rules, shared by the form (live limits) and the server (final check). No dependencies.
// Sources: docs.igloohome.co/home/what-is-algopin (types, ranges, variances, 24 h activation, 256 rule) and the
// Stoplight algoPIN operations (hour resolution, "not in the past" rules, daily same-hour, name ≤ 60).
// Snapshot: docs/research/igloohome/sources/2026-09-25. Evidence: DOC until M5 experiments confirm each rule.

export type AlgoPinType = "onetime" | "permanent" | "hourly" | "daily";

export const ALGOPIN_TYPES: Record<AlgoPinType, { label: string; variances: number; needsEnd: boolean; scope: string; hint: string }> = {
  onetime: { label: "One-time", variances: 5, needsEnd: false, scope: "igloohomeapi/algopin-onetime", hint: "Works once, from the start hour" },
  hourly: { label: "Hourly", variances: 3, needsEnd: true, scope: "igloohomeapi/algopin-hourly", hint: "1 to 672 hours" },
  daily: { label: "Daily", variances: 3, needsEnd: true, scope: "igloohomeapi/algopin-daily", hint: "29 to 367 whole days, same hour" },
  permanent: { label: "Permanent", variances: 5, needsEnd: false, scope: "igloohomeapi/algopin-permanent", hint: "No end date" },
};

export const HOURLY_MIN_H = 1;
export const HOURLY_MAX_H = 672;
export const DAILY_MIN_D = 29;
export const DAILY_MAX_D = 367;
export const ACCESS_NAME_MAX = 60;
export const NO_DELETE_AFTER_H = 256; // start further ahead than this: the PIN can never be deleted
export const ACTIVATION_WINDOW_H = 24; // PINs valid > 24 h must be used within 24 h of start

const HOUR = 3_600_000;

export interface AlgoPinDraft {
  type: AlgoPinType;
  accessName: string;
  variance: number;
  startDate: string; // YYYY-MM-DD in the property's time zone
  startHour: number; // 0–23
  endDate?: string; // hourly / daily
  endHour?: number; // hourly only; daily always uses startHour
}

export interface AlgoPinCheck {
  errors: Partial<Record<"accessName" | "variance" | "start" | "end", string>>;
  warnings: string[];
  body?: { accessName: string; variance: number; startDate: string; endDate?: string };
  startMs?: number;
  endMs?: number;
  activateBy?: number; // epoch ms, when the 24 h activation rule applies
}

/** Minutes east of UTC for `timeZone` at `utcMs` (e.g. Asia/Jakarta → 420). */
export function offsetMinutes(timeZone: string, utcMs: number): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(utcMs)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = name?.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/** Epoch ms of `date` at `hour`:00 in `timeZone`. */
export function epochOf(date: string, hour: number, timeZone: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, hour);
  const first = guess - offsetMinutes(timeZone, guess) * 60_000;
  return guess - offsetMinutes(timeZone, first) * 60_000; // second pass settles DST edges
}

/** `2026-09-27T10:00:00+07:00`: the only format igloohome accepts (hour resolution, explicit offset). */
export function vendorDate(date: string, hour: number, timeZone: string): string {
  const off = offsetMinutes(timeZone, epochOf(date, hour, timeZone));
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date}T${pad(hour)}:00:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Today's date and current hour in `timeZone`. */
export function nowIn(timeZone: string, now: number): { date: string; hour: number } {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
  return { date, hour };
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function checkAlgoPin(draft: AlgoPinDraft, opts: { now: number; timeZone: string }): AlgoPinCheck {
  const { now, timeZone } = opts;
  const rules = ALGOPIN_TYPES[draft.type];
  const errors: AlgoPinCheck["errors"] = {};
  const warnings: string[] = [];
  if (!rules) return { errors: { start: "Unknown algoPIN type" }, warnings };

  const accessName = draft.accessName.trim();
  if (!accessName) errors.accessName = "Name is required";
  else if (accessName.length > ACCESS_NAME_MAX) errors.accessName = `Up to ${ACCESS_NAME_MAX} characters`;

  if (!Number.isInteger(draft.variance) || draft.variance < 1 || draft.variance > rules.variances) {
    errors.variance = `Variance must be 1 to ${rules.variances}`;
  }

  if (!DATE.test(draft.startDate) || !Number.isInteger(draft.startHour) || draft.startHour < 0 || draft.startHour > 23) {
    errors.start = "Pick a start date and hour";
    return { errors, warnings };
  }
  const startMs = epochOf(draft.startDate, draft.startHour, timeZone);
  const local = nowIn(timeZone, now);
  const currentHourStart = epochOf(local.date, local.hour, timeZone); // property-local hour (half-hour zones differ from UTC)
  if (rules.needsEnd) {
    if (startMs < now - HOUR) errors.start = "Start cannot be more than 1 hour in the past";
  } else if (startMs < currentHourStart) {
    errors.start = "Start must be the current hour or later";
  }

  let endMs: number | undefined;
  let endDate: string | undefined;
  if (draft.type === "hourly") {
    const hour = draft.endHour;
    if (!draft.endDate || !DATE.test(draft.endDate) || hour === undefined || !Number.isInteger(hour) || hour < 0 || hour > 23) {
      errors.end = "Pick an end date and hour";
    } else {
      endMs = epochOf(draft.endDate, hour, timeZone);
      const hours = (endMs - startMs) / HOUR;
      if (hours < HOURLY_MIN_H || hours > HOURLY_MAX_H) errors.end = `Hourly PINs last ${HOURLY_MIN_H} to ${HOURLY_MAX_H} hours (now ${Math.round(hours)})`;
      endDate = vendorDate(draft.endDate, hour, timeZone);
    }
  } else if (draft.type === "daily") {
    if (!draft.endDate || !DATE.test(draft.endDate)) errors.end = "Pick an end date";
    else {
      endMs = epochOf(draft.endDate, draft.startHour, timeZone); // igloohome: end hour must equal start hour
      const days = Math.round((endMs - startMs) / (24 * HOUR));
      if (days < DAILY_MIN_D || days > DAILY_MAX_D) errors.end = `Daily PINs last ${DAILY_MIN_D} to ${DAILY_MAX_D} days (now ${days})`;
      endDate = vendorDate(draft.endDate, draft.startHour, timeZone);
    }
  }

  const longLived = draft.type === "permanent" || draft.type === "daily" || (endMs !== undefined && endMs - startMs > ACTIVATION_WINDOW_H * HOUR);
  const activateBy = longLived ? startMs + ACTIVATION_WINDOW_H * HOUR : undefined;
  if (longLived) warnings.push("Valid for more than 24 hours: it must be entered on the lock within 24 hours of the start, or it will never work.");
  if (startMs - now > NO_DELETE_AFTER_H * HOUR) warnings.push("Starts more than 256 hours from now: igloohome can never delete this PIN.");
  if (draft.type === "permanent") warnings.push("Permanent: stays valid until deleted through a Bridge job, which this app does not do yet.");

  const ok = Object.keys(errors).length === 0;
  return {
    errors,
    warnings,
    startMs,
    endMs,
    activateBy,
    body: ok ? { accessName, variance: draft.variance, startDate: vendorDate(draft.startDate, draft.startHour, timeZone), endDate } : undefined,
  };
}
