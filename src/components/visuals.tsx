"use client";

import {
  Bluetooth,
  CircleAlert,
  CloudOff,
  CreditCard,
  FingerprintPattern,
  Grid3x3,
  Hand,
  KeyRound,
  LockKeyhole,
  LockKeyholeOpen,
  RadioTower,
  ShieldAlert,
  Timer,
  ToggleRight,
  Workflow,
  Wifi,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { animate, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { KIND_LABEL } from "@/lib/device-kinds";
import { cn } from "@/lib/utils";

export { KIND_LABEL };

// Small visual building blocks shared by the dashboard screens.

export const KIND_ICON: Record<string, LucideIcon> = {
  lock: LockKeyhole,
  keypad: Grid3x3,
  bridge: RadioTower,
  switch: ToggleRight,
  fob: KeyRound,
  unknown: CircleAlert,
};

export function DeviceGlyph({ kind, className }: { kind: string; className?: string }) {
  const Icon = KIND_ICON[kind] ?? CircleAlert;
  const tint: Record<string, string> = {
    lock: "bg-primary/12 text-primary",
    keypad: "bg-info/12 text-info",
    bridge: "bg-warning/15 text-warning",
    switch: "bg-success/12 text-success",
  };
  return (
    <span
      aria-hidden
      className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-xl", tint[kind] ?? "bg-muted text-muted-foreground", className)}
    >
      <Icon className="size-5" />
    </span>
  );
}

const EVIDENCE_TEXT: Record<string, string> = {
  API: "Confirmed by a real igloohome API response",
  HW: "Confirmed on the physical device",
  DOC: "Documented by igloohome, not yet verified by us",
  "DOC-PARTIAL": "Documented, but incomplete",
  UNVERIFIED: "Received, but the webhook signature is not verified yet",
  BLOCKED: "Documented, but calls from our account fail (see the evidence note)",
};

export function EvidenceBadge({ level, className }: { level: string; className?: string }) {
  const style: Record<string, string> = {
    API: "border-success/40 bg-success/10 text-success",
    HW: "border-success/40 bg-success/15 text-success",
    DOC: "border-info/40 bg-info/10 text-info",
    "DOC-PARTIAL": "border-info/30 bg-info/5 text-info",
    UNVERIFIED: "border-warning/50 bg-warning/10 text-warning",
    BLOCKED: "border-destructive/40 bg-destructive/10 text-destructive",
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn("cursor-help font-mono text-[10px] tracking-wide", style[level], className)}>
          {level}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{EVIDENCE_TEXT[level] ?? level}</TooltipContent>
    </Tooltip>
  );
}

export function BatteryMeter({ percent }: { percent?: number }) {
  const reduce = useReducedMotion();
  if (percent === undefined) {
    return <span className="text-xs text-muted-foreground">Battery not reported</span>;
  }
  const tone = percent <= 20 ? "bg-destructive" : percent <= 40 ? "bg-warning" : "bg-success";
  return (
    <div className="flex items-center gap-2" aria-label={`Battery ${percent} percent`}>
      <div className="h-2 w-20 overflow-hidden rounded-full bg-muted" role="presentation">
        <motion.div
          className={cn("h-full rounded-full", tone)}
          initial={{ width: reduce ? `${percent}%` : 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <span className="text-xs font-medium tabular-nums">{percent}%</span>
    </div>
  );
}

export function LockStatePill({ state }: { state?: string }) {
  if (!state) return null;
  const locked = state === "locked";
  const Icon = locked ? LockKeyhole : LockKeyholeOpen;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        locked ? "bg-success/12 text-success" : "bg-warning/15 text-warning",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {locked ? "Locked" : state === "unlocked" ? "Unlocked" : "Unknown"}
    </span>
  );
}

export function LiveDot({ online, label }: { online?: boolean; label?: string }) {
  const color = online === undefined ? "bg-muted-foreground/50" : online ? "bg-success" : "bg-destructive";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="relative flex size-2.5" aria-hidden>
        {online && <span className="absolute inline-flex size-full animate-ping rounded-full bg-success/60 motion-reduce:animate-none" />}
        <span className={cn("relative inline-flex size-2.5 rounded-full", color)} />
      </span>
      {label ?? (online === undefined ? "Status unknown" : online ? "Online" : "Offline")}
    </span>
  );
}

export const METHOD_ICON: Record<string, LucideIcon> = {
  pin: Grid3x3,
  bluetooth: Bluetooth,
  manual: Hand,
  card: CreditCard,
  fingerprint: FingerprintPattern,
  auto: Timer,
  master: ShieldAlert,
};

export const FEED_ICON: Record<string, LucideIcon> = {
  job: Workflow,
  online: Wifi,
  offline: WifiOff,
};

/** "3 min ago", refreshed every 30 s, with the absolute time on hover. */
export function RelativeTime({ iso, timeZone = "Asia/Jakarta" }: { iso?: string; timeZone?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (!iso) return <span className="text-muted-foreground">never</span>;
  const date = new Date(iso);
  const seconds = Math.round((date.getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const abs = Math.abs(seconds);
  const text =
    abs < 60 ? rtf.format(seconds, "second")
    : abs < 3600 ? rtf.format(Math.round(seconds / 60), "minute")
    : abs < 86400 ? rtf.format(Math.round(seconds / 3600), "hour")
    : rtf.format(Math.round(seconds / 86400), "day");
  const full = date.toLocaleString("en-GB", { timeZone, dateStyle: "medium", timeStyle: "short" });
  return (
    <time dateTime={iso} title={full} suppressHydrationWarning>
      {text}
    </time>
  );
}

/** Counts up from 0 on mount; server HTML already holds the final value. */
export function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return;
    const controls = animate(0, value, {
      duration: 0.9,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = String(Math.round(v));
      },
    });
    return () => controls.stop();
  }, [value, reduce]);
  return (
    <span ref={ref} className="tabular-nums">
      {value}
    </span>
  );
}

const ERROR_HINT: Record<string, string> = {
  not_configured: "Add IGLOOHOME_CLIENT_ID and IGLOOHOME_CLIENT_SECRET to your local .env, then restart.",
  auth: "igloohome rejected the credentials. Check the client ID and secret.",
  scope: "The granted scopes do not allow this call.",
  subscription: "The igloohome subscription does not cover this call (trial ended?).",
  rate_limited: "igloohome is rate limiting us. Wait a minute and reload.",
  unavailable: "igloohome did not answer. Check your connection and reload.",
};

export function LoadError({ error }: { error: { code: string; message: string } }) {
  return (
    <div role="alert" className="flex items-start gap-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
      <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <CloudOff className="size-5" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-medium">Could not load data from igloohome</p>
        <p className="text-sm text-muted-foreground">{ERROR_HINT[error.code] ?? error.message}</p>
        <p className="font-mono text-xs text-muted-foreground">{error.code}</p>
      </div>
    </div>
  );
}
