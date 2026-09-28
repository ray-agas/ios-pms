"use client";

import { Activity, BatteryMedium, DoorOpen, KeyRound, LoaderCircle, Lock, LockOpen, type LucideIcon, ScrollText, Trash2, Wifi } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { HealthCheckOption, StartResult } from "@/server/application/health-check";

// Health-check buttons + confirmation (first-slice-workflow §2.5). The server decides what is allowed; this only shows it.

const ICON: Record<HealthCheckOption["kind"], LucideIcon> = {
  lock_battery: BatteryMedium,
  lock_status: DoorOpen,
  bridge_diagnostics: Wifi,
  pin_create: KeyRound, // PIN jobs start from the Access page, not from here
  pin_delete: Trash2,
  remote_lock: Lock, // emergency lock/unlock start from the lock's Emergency panel, not from here
  remote_unlock: LockOpen,
  pull_logs: ScrollText, // super-admin, from Developer → Try it
};

const WHAT_IT_DOES: Record<HealthCheckOption["kind"], string> = {
  lock_battery: "Wakes the lock over Bluetooth through the Bridge and reads its battery level (job 9).",
  lock_status: "Wakes the lock and reads whether it is locked and whether the door is open (job 10).",
  bridge_diagnostics: "Asks the Bridge for its Wi-Fi and capacity status (targeted job 10). igloohome allows 1 request per Bridge every 5 minutes.",
  pin_create: "Writes a custom PIN into the lock (job 4).",
  pin_delete: "Removes a PIN from the lock (job 5).",
  remote_lock: "Locks the lock through the Bridge (job 1).",
  remote_unlock: "Unlocks the lock through the Bridge (job 2).",
  pull_logs: "Pulls the activity logs off the lock (job 15). The lock deletes them after handing them over.",
};

export type StartAction = (deviceRef: string, kind: string) => Promise<StartResult>;

export function HealthCheckLauncher({
  options,
  deviceName,
  bridgeName,
  start,
}: {
  options: HealthCheckOption[];
  deviceName: string;
  bridgeName?: string;
  start: StartAction;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<HealthCheckOption | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  if (options.length === 0) return null;

  const confirm = () => {
    if (!open) return;
    setError(undefined);
    startTransition(async () => {
      const result = await start(open.deviceRef, open.kind);
      if (result.ok) router.push(`/jobs/${result.id}`);
      else if (result.id) router.push(`/jobs/${result.id}`); // rejected by igloohome: the job page shows why
      else setError(result.reason);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Activity className="size-3.5" aria-hidden /> Health check
      </span>
      {options.map((option) => {
        const Icon = ICON[option.kind];
        const button = (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!option.allowed}
            onClick={() => {
              setError(undefined);
              setOpen(option);
            }}
          >
            <Icon /> {option.label}
          </Button>
        );
        return option.allowed ? (
          <span key={option.kind}>{button}</span>
        ) : (
          <Tooltip key={option.kind}>
            <TooltipTrigger asChild>
              {/* Disabled buttons do not fire pointer events; the wrapper keeps the reason reachable. */}
              <span tabIndex={0} className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={`${option.label}: ${option.reason}`}>
                {button}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{option.reason}</TooltipContent>
          </Tooltip>
        );
      })}

      <AlertDialog open={open !== undefined} onOpenChange={(value) => !value && !pending && setOpen(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run {open?.label.toLowerCase()} check?</AlertDialogTitle>
            <AlertDialogDescription>{open && WHAT_IT_DOES[open.kind]}</AlertDialogDescription>
          </AlertDialogHeader>
          {open && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl bg-muted/50 p-3 text-sm">
              <dt className="text-muted-foreground">Target</dt>
              <dd>
                {deviceName} <span className="font-mono text-xs text-muted-foreground">{open.deviceRef}</span>
              </dd>
              {open.kind !== "bridge_diagnostics" && (
                <>
                  <dt className="text-muted-foreground">Via Bridge</dt>
                  <dd>
                    {bridgeName ?? "Bridge"} <span className="font-mono text-xs text-muted-foreground">{open.bridgeRef}</span>
                  </dd>
                </>
              )}
              <dt className="text-muted-foreground">Does not</dt>
              <dd>move the lock, change any PIN or credential</dd>
              <dt className="text-muted-foreground">Retries</dt>
              <dd>none: the request is sent once</dd>
            </dl>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            {/* Plain Button, not AlertDialogAction: the dialog must stay open while the request runs. */}
            <Button type="button" onClick={confirm} disabled={pending}>
              {pending && <LoaderCircle className="animate-spin" />} {pending ? "Sending…" : "Run check"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
