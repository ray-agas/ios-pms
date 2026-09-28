"use client";

import { Eye, EyeOff, KeyRound, LoaderCircle, RadioTower, Trash2, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { DateHour, Field, inputClass, toDate } from "@/components/algopin-form";
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
import { epochOf, nowIn } from "@/lib/algopin-rules";
import { checkCustomPin, checkDeletePin, CUSTOM_PIN_TYPES, type CustomPinDraft, type CustomPinType } from "@/lib/pin-job-rules";
import { cn } from "@/lib/utils";
import type { PinJobResult, PinJobTarget } from "@/server/application/pin-jobs";

// Bridge PIN jobs (M5 E12/E14): job 4 creates a custom PIN, job 5 deletes any PIN (custom or algoPIN).
// Both write to the lock, so both need a typed confirmation. After sending, the job page follows the result.

type Mode = "create" | "delete";

function fmt(ms: number, timeZone: string) {
  return new Date(ms).toLocaleString("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function PinJobForm({
  mode,
  targets,
  create,
  remove,
}: {
  mode: Mode;
  targets: PinJobTarget[];
  create: (deviceRef: string, draft: CustomPinDraft, confirm?: { reason: string; password: string }) => Promise<PinJobResult>;
  remove: (deviceRef: string, pin: string, confirm?: { reason: string; password: string }) => Promise<PinJobResult>;
}) {
  const router = useRouter();
  const allowedOf = (t?: PinJobTarget) => (mode === "create" ? t?.create : t?.remove);
  const [deviceRef, setDeviceRef] = useState(targets.find((t) => allowedOf(t)?.allowed)?.deviceRef ?? targets[0]?.deviceRef ?? "");
  const target = targets.find((t) => t.deviceRef === deviceRef);
  const gate = allowedOf(target);
  const tz = target?.timeZone ?? "Asia/Jakarta";

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const today = nowIn(tz, now);

  const [accessName, setAccessName] = useState("");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [pinType, setPinType] = useState<CustomPinType>(4);
  const [startNow, setStartNow] = useState(true);
  const [startDate, setStartDate] = useState(today.date);
  const [startHour, setStartHour] = useState(Math.min(today.hour + 1, 23));
  const [endDate, setEndDate] = useState(today.date);
  const [endHour, setEndHour] = useState(Math.min(today.hour + 2, 23));

  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  // G1: an experiment (keypad/switch) also needs a reason and the person's password.
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const experimental = Boolean(target?.experimental);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  const draft: CustomPinDraft = { accessName, pin, pinType, startNow, startDate, startHour, endDate, endHour };
  const create_ = checkCustomPin(draft, { now, timeZone: tz });
  const delete_ = checkDeletePin(pin);
  const valid = mode === "create" ? !!create_.jobData : !delete_.error;
  const warnings = mode === "create" ? create_.warnings : delete_.warnings;

  const submit = () =>
    startTransition(async () => {
      setError(undefined);
      const confirm = experimental ? { reason, password } : undefined;
      const r = mode === "create" ? await create(deviceRef, draft, confirm) : await remove(deviceRef, pin, confirm);
      setConfirming(false);
      setTyped("");
      setPassword("");
      if (r.ok || r.id) {
        setPin("");
        router.push(`/jobs/${r.id}`);
      } else setError(r.reason);
    });

  const Icon = mode === "create" ? KeyRound : Trash2;

  return (
    <section className="flex flex-col gap-5 rounded-2xl border bg-card p-4 md:p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <Icon className={cn("size-4", mode === "create" ? "text-primary" : "text-destructive")} aria-hidden />
        {mode === "create" ? "New custom PIN (Bridge job 4)" : "Delete a PIN (Bridge job 5)"}
      </h2>

      <Field label="Device" hint={target ? `via ${target.bridgeName ?? "Bridge"} · ${tz}` : undefined} error={gate && !gate.allowed ? gate.reason : undefined}>
        <DevicePicker
          label="Device"
          value={deviceRef}
          onChange={setDeviceRef}
          items={targets.map((t) => ({
            ref: t.deviceRef,
            name: t.name,
            kind: t.kind,
            place: t.place,
            allowed: Boolean(allowedOf(t)?.allowed),
            reason: allowedOf(t)?.reason,
            hint: [t.experimental && "Experiment", t.bridgeName && `via ${t.bridgeName}`].filter(Boolean).join(" · ") || undefined,
          }))}
        />
      </Field>

      {mode === "create" && (
        <div role="radiogroup" aria-label="PIN type" className="grid grid-cols-3 gap-2">
          {([4, 1, 2] as CustomPinType[]).map((t) => {
            const active = t === pinType;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPinType(t)}
                className={cn(
                  "relative flex flex-col items-start gap-0.5 rounded-xl border p-3 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                  active ? "border-primary/50" : "text-muted-foreground hover:border-primary/30",
                )}
              >
                {active && <motion.span layoutId="custom-pin-type" className="absolute inset-0 rounded-xl bg-accent" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                <span className="relative text-sm font-semibold">{CUSTOM_PIN_TYPES[t].label}</span>
                <span className="relative text-xs">{CUSTOM_PIN_TYPES[t].hint}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {mode === "create" && (
          <Field label="Name" hint="shows in the igloohome app" error={accessName ? create_.errors.accessName : undefined}>
            <input value={accessName} onChange={(e) => setAccessName(e.target.value)} placeholder="e.g. Housekeeping test" className={inputClass} />
          </Field>
        )}
        <Field
          label="PIN"
          hint={mode === "create" ? "4–6 digits you choose" : "the PIN to remove (custom 4–6 digits, algoPIN usually 7+)"}
          error={pin ? (mode === "create" ? create_.errors.pin : delete_.error) : undefined}
        >
          <div className="flex gap-2">
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, mode === "create" ? 6 : 12))}
              type={showPin ? "text" : "password"}
              inputMode="numeric"
              autoComplete="off"
              className={cn(inputClass, "font-mono tracking-[0.3em]")}
            />
            <Button type="button" variant="outline" size="icon-lg" aria-label={showPin ? "Hide PIN" : "Show PIN"} onClick={() => setShowPin((v) => !v)}>
              {showPin ? <EyeOff /> : <Eye />}
            </Button>
          </div>
        </Field>
      </div>

      {mode === "create" && (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Starts" error={create_.errors.start}>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} className="size-4 accent-(--primary)" /> Now
              </label>
              {!startNow && (
                <DateHour
                  date={startDate}
                  hour={startHour}
                  onDate={setStartDate}
                  onHour={setStartHour}
                  disabled={{ before: toDate(today.date) }}
                  hourDisabled={(h) => epochOf(startDate, h, tz) < now}
                  timeZone={tz}
                />
              )}
            </div>
          </Field>
          {CUSTOM_PIN_TYPES[pinType].needsEnd ? (
            <Field label="Ends" error={create_.errors.end}>
              <DateHour
                date={endDate}
                hour={endHour}
                onDate={setEndDate}
                onHour={setEndHour}
                disabled={{ before: toDate(startDate) }}
                hourDisabled={(h) => epochOf(endDate, h, tz) <= create_.startMs}
                timeZone={tz}
              />
            </Field>
          ) : (
            <p className="flex items-end text-sm text-muted-foreground">{pinType === 1 ? "Ends 24 hours after the start." : "No end."}</p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5 rounded-xl bg-muted/50 p-3 text-sm">
        {mode === "create" && (
          <p>
            <span className="font-medium">{fmt(create_.startMs, tz)}</span>
            {create_.endMs !== undefined ? ` → ${fmt(create_.endMs, tz)}` : " → no end"} <span className="text-muted-foreground">· {tz}</span>
          </p>
        )}
        {mode === "create" && create_.jobData && (
          <p className="font-mono text-xs text-muted-foreground">
            jobType 4 · pinType {create_.jobData.pinType} · startDate {create_.jobData.startDate}
            {create_.jobData.endDate ? ` · endDate ${create_.jobData.endDate}` : ""} · pin ••••
          </p>
        )}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <RadioTower className="size-3.5" aria-hidden /> Sent through {target?.bridgeName ?? "the Bridge"}; the result arrives as a job (usually 10–20 s).
        </p>
        {warnings.map((w) => (
          <p key={w} className="flex items-start gap-1.5 text-xs text-warning">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {w}
          </p>
        ))}
      </div>

      {error && (
        <div role="alert" className="flex flex-col gap-1 text-sm text-destructive">
          <p>{error}</p>
          {/already taken/i.test(error) && (
            <p className="text-xs text-muted-foreground">
              igloohome still reserves this PIN for the lock, even after a one-time PIN was used. Delete it first (Delete PIN tab): the job may
              answer &quot;PIN not found&quot; (the lock no longer has it), but the reservation is released and the PIN can be created again
              (EXP-20260926-04).
            </p>
          )}
        </div>
      )}

      <div>
        <Button size="lg" variant={mode === "delete" ? "destructive" : "default"} disabled={!valid || !gate?.allowed || pending} onClick={() => setConfirming(true)} className="px-4">
          <Icon /> {mode === "create" ? "Create custom PIN" : "Delete PIN"}
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={(open) => !pending && setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{mode === "create" ? `Write a PIN into ${target?.name}?` : `Delete a PIN from ${target?.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {mode === "create"
                ? "Anyone with this PIN can open the lock during its window. Sent once through the Bridge, never retried."
                : "The PIN stops working on the lock. This cannot be undone. Sent once through the Bridge, never retried."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {experimental && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-2 text-sm text-warning">
              Experiment: igloohome documents PIN jobs for locks only, not for a {target?.kind}. The result is recorded either way.
            </p>
          )}
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Type the device name <span className="font-mono">{target?.name}</span> to confirm
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className={inputClass} />
          </label>
          {experimental && (
            <>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Reason
                <input value={reason} onChange={(e) => setReason(e.target.value)} minLength={10} maxLength={200} placeholder="e.g. E16: PIN on the bedlock keypad" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Your password
                <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
              </label>
            </>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button
              variant={mode === "delete" ? "destructive" : "default"}
              onClick={submit}
              disabled={pending || typed.trim() !== target?.name || (experimental && (reason.trim().length < 10 || !password))}
            >
              {pending && <LoaderCircle className="animate-spin" />} {pending ? "Sending…" : mode === "create" ? "Create PIN" : "Delete PIN"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
