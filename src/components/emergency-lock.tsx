"use client";

import { LoaderCircle, Lock, LockOpen, Siren } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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
import { EvidenceBadge } from "@/components/visuals";
import { cn } from "@/lib/utils";
import { FindingBadge, type ExperimentFinding } from "@/components/experiment-finding";
import { supportOf } from "@/lib/device-support";
import type { DeviceKind } from "@/server/domain/models";

// Emergency lock/unlock (plan F4b). Super-admin only; the server re-checks everything. Each run needs a reason and
// the person's own password, so an unattended open session cannot open a door.

export type LockAction = "lock" | "unlock";
export type EmergencyOptions = Record<string, Record<LockAction, { allowed: boolean; reason?: string; retryAt?: string; experimental?: boolean }>>;
export type EmergencyRun = (
  deviceRef: string,
  action: LockAction,
  reason: string,
  password: string,
) => Promise<{ ok: true; id: number } | { ok: false; reason: string; id?: number }>;

const field =
  "w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-shadow focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40";

export function EmergencyLock({
  deviceRef,
  lockName,
  place,
  bridgeOnline,
  lockState,
  options,
  run,
  finding,
  deviceKind = "lock",
}: {
  deviceRef: string;
  lockName: string;
  place?: string;
  bridgeOnline?: boolean;
  lockState?: string;
  options: Record<LockAction, { allowed: boolean; reason?: string; experimental?: boolean }>;
  run: EmergencyRun;
  /** Latest result of an experiment on this device (G1), shown with the reason on hover. */
  finding?: ExperimentFinding;
  deviceKind?: string;
}) {
  const [action, setAction] = useState<LockAction | undefined>();
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string; id?: number } | undefined>();
  const [pending, start] = useTransition();
  const router = useRouter();

  const open = (a: LockAction) => {
    setAction(a);
    setReason("");
    setPassword("");
    setResult(undefined);
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-destructive">
        <Siren className="size-4" aria-hidden /> Emergency <span className="font-normal text-muted-foreground">super-admin · jobs 1/2 through the Bridge</span>
        {options.unlock.experimental || options.lock.experimental ? (
          <span
            title="igloohome documents Bridge lock/unlock for locks only. This is an experiment: a reason and your password are required, and the result is recorded."
            className="cursor-help rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning"
          >
            Experiment · UNVERIFIED
          </span>
        ) : (
          // Proven on hardware: the lock in E22 (EXP-20260927-02), the switch in G1 (EXP-20260928-01).
          <span title={deviceKind === "lock" ? "Tested on the Doorlock (EXP-20260927-02)" : supportOf(deviceKind as DeviceKind, "remote_unlock")?.note} className="cursor-help">
            <EvidenceBadge level="HW" />
          </span>
        )}
        {finding && <FindingBadge finding={finding} />}
      </p>
      <div className="flex flex-wrap gap-2">
        {(["unlock", "lock"] as const).map((a) => (
          <span key={a} title={options[a].allowed ? undefined : options[a].reason}>
            <Button variant={a === "unlock" ? "destructive" : "outline"} size="sm" disabled={!options[a].allowed} onClick={() => open(a)}>
              {a === "unlock" ? <LockOpen /> : <Lock />} {a === "unlock" ? "Unlock now" : "Lock now"}
            </Button>
          </span>
        ))}
      </div>
      {!options.unlock.allowed && <p className="text-xs text-muted-foreground">{options.unlock.reason}</p>}
      {result && (
        <p className={cn("text-xs", result.ok ? "text-success" : "text-destructive")}>
          {result.text}{" "}
          {result.id && (
            <Link href={`/jobs/${result.id}`} className="font-medium underline">
              Follow job #{result.id}
            </Link>
          )}
        </p>
      )}

      <AlertDialog open={Boolean(action)} onOpenChange={(o) => !o && !pending && setAction(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className={cn(action === "unlock" && "text-destructive")}>
              {action === "unlock" ? "Unlock" : "Lock"} {lockName} now?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {place ?? "No cabin or room"} · Bridge {bridgeOnline === true ? "online" : bridgeOnline === false ? "offline (the job will fail)" : "status unknown"} · lock last
              known {lockState ?? "unknown"}. Sent once through the Bridge, never retried. Recorded with your name and reason
              {action === "unlock" ? "; the Overview shows it for 24 hours" : ""}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form
            id="emergency-form"
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const a = action!;
                const r = await run(deviceRef, a, reason, password);
                setPassword("");
                if (r.ok) {
                  setAction(undefined);
                  setResult({ ok: true, text: `${a === "unlock" ? "Unlock" : "Lock"} sent. The buttons come back when the lock answers.`, id: r.id });
                  router.refresh();
                } else setResult({ ok: false, text: r.reason, id: r.id });
              });
            }}
          >
            <label className="flex flex-col gap-1 text-sm font-medium">
              Reason
              <textarea
                required
                minLength={10}
                maxLength={200}
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. guest locked out, phone battery dead"
                className={cn(field, "py-2")}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Your password
              <input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={cn(field, "h-9")} />
            </label>
            {result && !result.ok && <p className="text-sm text-destructive">{result.text}</p>}
          </form>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button type="submit" form="emergency-form" variant={action === "unlock" ? "destructive" : "default"} disabled={pending || reason.trim().length < 10 || !password}>
              {pending && <LoaderCircle className="animate-spin" />} {action === "unlock" ? "Unlock" : "Lock"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
