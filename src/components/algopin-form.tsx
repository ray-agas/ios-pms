"use client";

import { CalendarDays, Check, Copy, Eye, EyeOff, KeyRound, LoaderCircle, Lock, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DevicePicker } from "@/components/device-picker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ACCESS_NAME_MAX,
  addDays,
  ALGOPIN_TYPES,
  checkAlgoPin,
  DAILY_MAX_D,
  DAILY_MIN_D,
  epochOf,
  HOURLY_MAX_H,
  nowIn,
  type AlgoPinDraft,
  type AlgoPinType,
} from "@/lib/algopin-rules";
import { cn } from "@/lib/utils";
import type { AlgoPinTarget, IssueResult } from "@/server/application/access-codes";

// algoPIN issue form (M5). Every picker is limited by lib/algopin-rules, the same module the server re-checks with.

const HOUR = 3_600_000;
const pad = (n: number) => String(n).padStart(2, "0");
export const toDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const fromDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function fmt(ms: number, timeZone: string) {
  return new Date(ms).toLocaleString("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function durationText(ms: number) {
  const h = Math.round(ms / HOUR);
  return h % 24 === 0 ? `${h / 24} day${h === 24 ? "" : "s"}` : `${h} h`;
}

export function AlgoPinForm({
  targets,
  issue,
}: {
  targets: AlgoPinTarget[];
  issue: (deviceRef: string, draft: AlgoPinDraft) => Promise<IssueResult>;
}) {
  const router = useRouter();
  const [deviceRef, setDeviceRef] = useState(targets.find((t) => t.allowed)?.deviceRef ?? targets[0]?.deviceRef ?? "");
  const target = targets.find((t) => t.deviceRef === deviceRef);
  const tz = target?.timeZone ?? "Asia/Jakarta";

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const today = nowIn(tz, now);

  const [type, setType] = useState<AlgoPinType>("hourly");
  const [accessName, setAccessName] = useState("");
  const [variance, setVariance] = useState(1);
  const [startDate, setStartDate] = useState(today.date);
  const [startHour, setStartHour] = useState(Math.min(today.hour + 1, 23));
  const [endDate, setEndDate] = useState(today.date);
  const [endHour, setEndHour] = useState(Math.min(today.hour + 3, 23));

  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<IssueResult | undefined>();
  const [shown, setShown] = useState(true);
  const [copied, setCopied] = useState(false);

  const rules = ALGOPIN_TYPES[type];
  const draft: AlgoPinDraft = { type, accessName, variance: Math.min(variance, rules.variances), startDate, startHour, endDate, endHour };
  const check = checkAlgoPin(draft, { now, timeZone: tz }); // cheap: a few Intl calls per render

  // Keep the end inside the allowed range when the type or start changes.
  const selectType = (next: AlgoPinType) => {
    setType(next);
    setVariance((v) => Math.min(v, ALGOPIN_TYPES[next].variances));
    if (next === "daily") setEndDate(addDays(startDate, DAILY_MIN_D));
    if (next === "hourly") {
      const end = new Date(epochOf(startDate, startHour, tz) + 2 * HOUR);
      const local = nowIn(tz, end.getTime());
      setEndDate(local.date);
      setEndHour(local.hour);
    }
  };

  const startMs = epochOf(startDate, startHour, tz);
  const startHourDisabled = (h: number) => {
    const ms = epochOf(startDate, h, tz);
    return rules.needsEnd ? ms < now - HOUR : ms < epochOf(today.date, today.hour, tz);
  };
  const endHourDisabled = (h: number) => {
    const hours = (epochOf(endDate, h, tz) - startMs) / HOUR;
    return hours < 1 || hours > HOURLY_MAX_H;
  };

  const startDisabled = { before: toDate(rules.needsEnd && today.hour === 0 ? addDays(today.date, -1) : today.date) };
  const endRange =
    type === "daily"
      ? { from: addDays(startDate, DAILY_MIN_D), to: addDays(startDate, DAILY_MAX_D) }
      : { from: startDate, to: nowIn(tz, startMs + HOURLY_MAX_H * HOUR).date };

  const typeState = target?.types[type];
  const canSubmit = !!check.body && !!target?.allowed && !!typeState?.allowed && !pending;

  const submit = () =>
    startTransition(async () => {
      const r = await issue(deviceRef, draft);
      setResult(r);
      setConfirming(false);
      setTyped("");
      setShown(true);
      if (r.ok) router.refresh();
    });

  if (targets.length === 0) {
    return <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">igloohome lists no algoPIN-capable device for this account.</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="new-pin" className="flex flex-col gap-5 rounded-2xl border bg-card p-4 md:p-5">
        <h2 id="new-pin" className="flex items-center gap-2 font-semibold">
          <KeyRound className="size-4 text-primary" aria-hidden /> New algoPIN
        </h2>

        {/* Device */}
        <Field label="Device" hint={target ? `${target.modelName ?? ""} · ${tz}` : undefined} error={target?.reason}>
          <DevicePicker
            label="Device"
            value={deviceRef}
            onChange={setDeviceRef}
            items={targets.map((t) => ({ ref: t.deviceRef, name: t.name, kind: t.kind, place: t.place, allowed: t.allowed, reason: t.reason, hint: t.modelName }))}
          />
        </Field>

        {/* Type */}
        <div role="radiogroup" aria-label="algoPIN type" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(ALGOPIN_TYPES) as AlgoPinType[]).map((t) => {
            const active = t === type;
            const state = target?.types[t];
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => selectType(t)}
                className={cn(
                  "relative flex flex-col items-start gap-0.5 rounded-xl border p-3 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                  active ? "border-primary/50 text-foreground" : "text-muted-foreground hover:border-primary/30",
                )}
              >
                {active && <motion.span layoutId="pin-type" className="absolute inset-0 rounded-xl bg-accent" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                <span className="relative flex items-center gap-1.5 text-sm font-semibold">
                  {ALGOPIN_TYPES[t].label}
                  {state && !state.allowed && <Lock className="size-3" aria-label="not allowed" />}
                </span>
                <span className="relative text-xs">{ALGOPIN_TYPES[t].hint}</span>
              </button>
            );
          })}
        </div>
        {/* Device-level reasons show once, under Lock; only a type-specific reason (missing scope) shows here. */}
        {target?.allowed && typeState && !typeState.allowed && <p className="-mt-2 text-sm text-destructive">{typeState.reason}</p>}

        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <Field label="Name" hint={`${accessName.trim().length}/${ACCESS_NAME_MAX} · shows in the igloohome app`} error={accessName ? check.errors.accessName : undefined}>
            <input value={accessName} maxLength={ACCESS_NAME_MAX + 5} onChange={(e) => setAccessName(e.target.value)} placeholder="e.g. Test guest, room lab" className={inputClass} />
          </Field>
          <Field label="Variance" hint={`1–${rules.variances}: another PIN for the same window`} error={check.errors.variance}>
            <div className="flex gap-1">
              {Array.from({ length: rules.variances }, (_, i) => i + 1).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={variance === v}
                  onClick={() => setVariance(v)}
                  className={cn(
                    "size-10 rounded-lg border font-mono text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    variance === v ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary/40",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </Field>
        </div>

        {/* Window */}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Starts" error={check.errors.start}>
            <DateHour
              date={startDate}
              hour={startHour}
              onDate={(d) => {
                setStartDate(d);
                if (type === "daily") setEndDate(addDays(d, DAILY_MIN_D));
              }}
              onHour={setStartHour}
              disabled={startDisabled}
              hourDisabled={startHourDisabled}
              timeZone={tz}
            />
          </Field>
          {rules.needsEnd ? (
            <Field label={type === "daily" ? `Ends (hour fixed at ${pad(startHour)}:00)` : "Ends"} error={check.errors.end}>
              <DateHour
                date={endDate}
                hour={type === "daily" ? startHour : endHour}
                onDate={setEndDate}
                onHour={setEndHour}
                disabled={[{ before: toDate(endRange.from) }, { after: toDate(endRange.to) }]}
                hourDisabled={type === "daily" ? () => true : endHourDisabled}
                hourLocked={type === "daily"}
                timeZone={tz}
                defaultMonth={toDate(endRange.from)}
              />
            </Field>
          ) : (
            <div className="flex items-end text-sm text-muted-foreground">{type === "onetime" ? "Works for one entry, from the start hour." : "No end: valid until deleted."}</div>
          )}
        </div>

        {/* Summary */}
        <div className="flex flex-col gap-2 rounded-xl bg-muted/50 p-3 text-sm">
          <p className="flex flex-wrap items-center gap-x-2">
            <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
            <span className="font-medium">{fmt(startMs, tz)}</span>
            {check.endMs !== undefined && (
              <>
                → <span className="font-medium">{fmt(check.endMs, tz)}</span>
                <span className="text-muted-foreground">({durationText(check.endMs - startMs)})</span>
              </>
            )}
            <span className="text-muted-foreground">· {tz}</span>
          </p>
          {check.body && <p className="font-mono text-xs text-muted-foreground">startDate {check.body.startDate}{check.body.endDate ? ` · endDate ${check.body.endDate}` : ""}</p>}
          {check.activateBy && <p className="text-xs">Must be entered on the lock before {fmt(check.activateBy, tz)}.</p>}
          {check.warnings.map((w) => (
            <p key={w} className="flex items-start gap-1.5 text-xs text-warning">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {w}
            </p>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" disabled={!canSubmit} onClick={() => setConfirming(true)} className="px-4">
            <KeyRound /> Create algoPIN
          </Button>
        </div>
      </section>

      {/* Result */}
      <div aria-live="polite">
        <AnimatePresence mode="wait">
          {result && (
            <motion.section
              key={result.ok ? `ok-${result.id}` : `err-${result.reason}`}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              className={cn("flex flex-col gap-3 rounded-2xl border p-5", result.ok ? "border-success/40 bg-success/5" : "border-destructive/30 bg-destructive/5")}
            >
              {result.ok ? (
                <>
                  <p className="text-sm font-medium text-success">algoPIN created for {target?.name}</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-4xl font-semibold tracking-[0.25em] tabular-nums md:text-5xl">{shown ? result.pin : "•".repeat(result.pin.length)}</span>
                    <Button variant="outline" size="icon-lg" aria-label={shown ? "Hide PIN" : "Show PIN"} onClick={() => setShown((s) => !s)}>
                      {shown ? <EyeOff /> : <Eye />}
                    </Button>
                    <Button
                      variant="outline"
                      size="icon-lg"
                      aria-label="Copy PIN"
                      onClick={async () => {
                        await navigator.clipboard.writeText(result.pin);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }}
                    >
                      {copied ? <Check /> : <Copy />}
                    </Button>
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">
                    {result.startAt}
                    {result.endAt ? ` → ${result.endAt}` : ""} · pinId {result.pinId ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Shown only now. iot-pms stores a fingerprint, not the PIN, so it can match the PIN when the lock reports it was used.
                    {result.activateByMs ? ` Enter it on the lock before ${fmt(result.activateByMs, tz)}.` : ""}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium text-destructive">Not created</p>
                  <p className="text-sm">{result.reason}</p>
                  {result.fieldErrors && (
                    <ul className="list-disc pl-5 text-sm text-muted-foreground">
                      {Object.values(result.fieldErrors).map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </motion.section>
          )}
        </AnimatePresence>
      </div>

      {/* Typed confirmation: an algoPIN is a working credential (first-slice-workflow §5). */}
      <AlertDialog open={confirming} onOpenChange={(open) => !pending && setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create a working PIN on {target?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Anyone with this PIN can open the lock during its window. {type === "permanent" ? "It has no end date." : ""} Sent once, never retried.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl bg-muted/50 p-3 text-sm">
            <dt className="text-muted-foreground">Type</dt>
            <dd>
              {rules.label} · variance {draft.variance}
            </dd>
            <dt className="text-muted-foreground">Window</dt>
            <dd>
              {fmt(startMs, tz)}
              {check.endMs !== undefined ? ` → ${fmt(check.endMs, tz)}` : ""}
            </dd>
            <dt className="text-muted-foreground">Name</dt>
            <dd>{accessName.trim()}</dd>
          </dl>
          {check.warnings.map((w) => (
            <p key={w} className="text-xs text-warning">
              {w}
            </p>
          ))}
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Type the lock name <span className="font-mono">{target?.name}</span> to confirm
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className={inputClass} />
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button onClick={submit} disabled={pending || typed.trim() !== target?.name}>
              {pending && <LoaderCircle className="animate-spin" />} {pending ? "Creating…" : "Create PIN"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export const inputClass =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-shadow focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40";

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {error ? <span className="text-xs text-destructive">{error}</span> : hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

export function DateHour({
  date,
  hour,
  onDate,
  onHour,
  disabled,
  hourDisabled,
  hourLocked,
  timeZone,
  defaultMonth,
}: {
  date: string;
  hour: number;
  onDate: (d: string) => void;
  onHour: (h: number) => void;
  disabled: React.ComponentProps<typeof Calendar>["disabled"];
  hourDisabled: (h: number) => boolean;
  hourLocked?: boolean;
  timeZone: string;
  defaultMonth?: Date;
}) {
  const [open, setOpen] = useState(false);
  const label = toDate(date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="flex gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-10 flex-1 justify-start font-normal">
            <CalendarDays /> {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={toDate(date)}
            defaultMonth={defaultMonth ?? toDate(date)}
            captionLayout="dropdown"
            disabled={disabled}
            onSelect={(d) => {
              if (d) onDate(fromDate(d));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      <select
        aria-label={`Hour (${timeZone})`}
        value={hour}
        disabled={hourLocked}
        onChange={(e) => onHour(Number(e.target.value))}
        className={cn(inputClass, "w-24 font-mono")}
      >
        {Array.from({ length: 24 }, (_, h) => (
          <option key={h} value={h} disabled={!hourLocked && hourDisabled(h)}>
            {pad(h)}:00
          </option>
        ))}
      </select>
    </div>
  );
}
