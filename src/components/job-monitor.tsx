"use client";

import {
  BatteryFull,
  BatteryMedium,
  CircleCheck,
  CircleHelp,
  CircleX,
  Clock,
  DoorClosed,
  DoorOpen,
  KeyRound,
  Link2,
  LoaderCircle,
  LockKeyhole,
  LockKeyholeOpen,
  RadioTower,
  RefreshCw,
  Router,
  Send,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Trash2,
  TriangleAlert,
  Webhook,
  Wifi,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";

import { JsonView } from "@/components/developer/json-view";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EvidenceBadge, RelativeTime } from "@/components/visuals";
import { cn } from "@/lib/utils";
import type { JobState, JobView } from "@/server/application/health-check";
import { Code } from "@/components/code-hint";

// Job screen (first-slice-workflow §2.5, §4). Polls every 3 s while igloohome says "not completed" and the job
// has not expired, then keeps watching ~2 min for the job-complete webhook (arrives 8–12 s later in our tests).

const POLL_MS = 3000;
const WEBHOOK_GRACE_MS = 2 * 60_000;

const STATE: Record<JobState, { label: string; icon: LucideIcon; tone: string }> = {
  requested: { label: "Sending to igloohome…", icon: Send, tone: "text-info bg-info/12" },
  queued: { label: "Queued at the Bridge, waiting for the lock", icon: LoaderCircle, tone: "text-primary bg-primary/12" },
  unknown: { label: "No answer from igloohome: outcome unknown", icon: CircleHelp, tone: "text-warning bg-warning/15" },
  completed: { label: "Finished", icon: CircleCheck, tone: "text-success bg-success/12" },
  expired: { label: "No result before the job expired: outcome unknown", icon: Clock, tone: "text-warning bg-warning/15" },
  rejected: { label: "Rejected by igloohome", icon: CircleX, tone: "text-destructive bg-destructive/12" },
};

type Names = Record<string, { name?: string }>;

export function JobMonitor({ initial, names, refresh }: { initial: JobView; names: Names; refresh: (id: number) => Promise<JobView | undefined> }) {
  const [job, setJob] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());

  const watching =
    (job.state === "queued" && now < Date.parse(job.pollUntil) + POLL_MS) ||
    ((job.state === "completed" || job.state === "queued") && !job.webhook && now < Date.parse(job.createdAt) + WEBHOOK_GRACE_MS);

  const tick = useCallback(() => {
    startTransition(async () => {
      const next = await refresh(job.id);
      if (next) setJob(next);
      setNow(Date.now());
    });
  }, [job.id, refresh]);

  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => {
      if (!document.hidden) tick();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [watching, tick]);

  const state = STATE[job.state];
  const Icon = state.icon;
  const device = names[job.deviceRef]?.name ?? job.deviceRef;
  const bridge = names[job.bridgeRef]?.name ?? job.bridgeRef;

  return (
    <div className="flex flex-col gap-5">
      {/* Status hero */}
      <section aria-live="polite" className="flex flex-col gap-4 rounded-2xl border bg-card p-5 md:flex-row md:items-center">
        <motion.span
          key={job.state}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 380, damping: 22 }}
          className={cn("flex size-14 shrink-0 items-center justify-center rounded-2xl", state.tone)}
          aria-hidden
        >
          <Icon className={cn("size-7", job.state === "queued" && "animate-spin motion-reduce:animate-none")} />
        </motion.span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">{state.label}</p>
          <p className="text-sm text-muted-foreground">
            {job.kindLabel} · {device} via {bridge} · started <RelativeTime iso={job.createdAt} /> by {job.actor}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {watching && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="relative flex size-2" aria-hidden>
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60 motion-reduce:animate-none" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
              Watching
            </span>
          )}
          <Button variant="outline" size="sm" onClick={tick} disabled={pending}>
            <RefreshCw className={cn(pending && "animate-spin")} /> Refresh
          </Button>
        </div>
      </section>

      {/* Result */}
      <Result job={job} names={names} />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Timeline */}
        <section aria-labelledby="timeline-title" className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
          <h2 id="timeline-title" className="font-semibold">
            Timeline
          </h2>
          <ol className="relative flex flex-col gap-4 before:absolute before:top-2 before:bottom-2 before:left-[11px] before:w-px before:bg-border">
            <Step
              icon={Send}
              done
              title="Requested"
              at={job.createdAt}
              detail={
                <>
                  POST <Code kind="jobType" value={job.jobType}>job {job.jobType}</Code> · actor {job.actor}
                </>
              }
            />
            {job.state === "rejected" ? (
              <Step
                icon={CircleX}
                tone="destructive"
                done
                title="Rejected"
                detail={
                  <>
                    {job.httpStatus !== undefined && <Code kind="http" value={job.httpStatus} />} {job.errorMessage}
                  </>
                }
              />
            ) : job.state === "unknown" ? (
              <Step icon={CircleHelp} tone="warning" done title="No response" detail={`${job.errorMessage ?? ""} Not retried: igloohome may still run it.`} />
            ) : (
              <Step icon={RadioTower} done={!!job.providerJobId} title="Queued at the Bridge" detail={job.providerJobId && `jobId ${job.providerJobId}`} />
            )}
            {job.providerJobId && (
              <Step
                icon={RefreshCw}
                done={job.polls > 0}
                title={`Polled GET /jobs · ${job.polls}×`}
                at={job.polledAt}
                detail={job.errorMessage && job.state !== "rejected" ? `Last poll error: ${job.errorMessage}` : `completed: ${String(job.completed ?? "—")}`}
              />
            )}
            {(job.state === "completed" || job.state === "expired") && (
              <Step icon={job.state === "completed" ? CircleCheck : Clock} tone={job.state === "completed" ? "success" : "warning"} done title={STATE[job.state].label} />
            )}
            <Step
              icon={Webhook}
              done={!!job.webhook}
              title={job.webhook ? "Job-complete webhook received" : "Waiting for job-complete webhook"}
              at={job.webhook?.receivedAt}
              detail={job.webhook ? `signature: ${job.webhook.verification}` : watching ? "usually 8–12 s after the lock answers" : "none received"}
            />
          </ol>
        </section>

        {/* D23 (resolved) */}
        <section aria-labelledby="d23-title" className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
          <h2 id="d23-title" className="flex flex-wrap items-center gap-2 font-semibold">
            jobStatus, two sources <EvidenceBadge level="API" />
          </h2>
          <p className="text-sm text-muted-foreground">
            D23 resolved (EXP-20260926-01): the webhook value is the job <span className="font-medium text-foreground">result</span>; the polled value is
            the job <span className="font-medium text-foreground">state</span> (1 pending, 0 completed).
          </p>
          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-muted/50 p-3">
              <dt className="text-xs text-muted-foreground">Webhook · result</dt>
              <dd className="font-mono text-2xl font-semibold">{job.webhook?.jobStatus !== undefined ? <Code kind="jobStatus" value={job.webhook.jobStatus} /> : "—"}</dd>
              <dd className="text-sm">{job.webhook?.meaning ?? (job.webhook ? "not in the table" : "no webhook yet")}</dd>
            </div>
            <div className="rounded-xl bg-muted/50 p-3">
              <dt className="text-xs text-muted-foreground">GET /jobs · state</dt>
              <dd className="font-mono text-2xl font-semibold">{job.polledJobStatus !== undefined ? <Code kind="jobState" value={job.polledJobStatus} /> : "—"}</dd>
              <dd className="text-sm">{job.interpretations[0]?.meaning?.meaning ?? (job.polls ? "not in the table" : "not polled yet")}</dd>
            </div>
          </dl>
        </section>
      </div>

      <details className="rounded-2xl border bg-card">
        <summary className="cursor-pointer rounded-2xl px-5 py-3 font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Raw data (redacted)</summary>
        <div className="grid gap-3 px-5 pb-5 lg:grid-cols-2">
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">Last GET /jobs/{"{jobId}"}</p>
            {job.rawJob ? <JsonView text={job.rawJob} /> : <p className="text-sm text-muted-foreground">Not polled yet</p>}
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">Webhook event.data</p>
            {job.webhook ? <JsonView text={job.webhook.data} /> : <p className="text-sm text-muted-foreground">No webhook yet</p>}
          </div>
        </div>
      </details>

      <Link href="/jobs" className="w-fit text-sm font-medium text-primary hover:underline">
        All health checks
      </Link>
    </div>
  );
}

const WIFI: Record<number, string> = { 0: "Connected", 2: "Disconnected", 5: "No internet" };

type Tone = "success" | "warning" | "destructive" | "info" | "muted";
const TONE_CLASS: Record<Tone, string> = {
  success: "bg-success/12 text-success ring-success/25",
  warning: "bg-warning/15 text-warning ring-warning/30",
  destructive: "bg-destructive/12 text-destructive ring-destructive/25",
  info: "bg-info/12 text-info ring-info/25",
  muted: "bg-muted text-muted-foreground ring-border",
};

/** A readable badge; the exact igloohome field and value appear on hover / keyboard focus. */
function Badge({ icon: Icon, label, tone, raw, meter }: { icon: LucideIcon; label: string; tone: Tone; raw: string; meter?: number }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={`${label}. Raw: ${raw}`}
          className={cn("inline-flex cursor-help items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ring-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50", TONE_CLASS[tone])}
        >
          <Icon className="size-4" aria-hidden />
          {label}
          {meter !== undefined && (
            <span className="h-1.5 w-12 overflow-hidden rounded-full bg-current/15" aria-hidden>
              <span className="block h-full rounded-full bg-current" style={{ width: `${Math.max(3, Math.min(100, meter * 100))}%` }} />
            </span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 font-mono text-xs">{raw}</TooltipContent>
    </Tooltip>
  );
}

function SignalIcon(rssi: number): LucideIcon {
  return rssi >= -60 ? SignalHigh : rssi >= -75 ? SignalMedium : SignalLow;
}

function Result({ job, names }: { job: JobView; names: Names }) {
  const r = job.result;
  const badges: React.ReactNode[] = [];
  if (typeof r?.batteryLevel === "number") {
    const b = r.batteryLevel;
    badges.push(<Badge key="battery" icon={b > 40 ? BatteryFull : BatteryMedium} label={`Battery ${b}%`} tone={b > 40 ? "success" : b > 20 ? "warning" : "destructive"} raw={`batteryLevel: ${b}`} meter={b / 100} />);
  }
  if (typeof r?.lockOpen === "boolean") {
    badges.push(
      <Badge
        key="lock"
        icon={r.lockOpen ? LockKeyholeOpen : LockKeyhole}
        label={r.lockOpen ? "Unlocked" : "Locked"}
        tone={r.lockOpen ? "warning" : "success"}
        raw={`lockOpen: ${r.lockOpen} (docs: false = locking mechanism not open)`}
      />,
    );
  }
  if (r?.doorOpen !== undefined) {
    const door = r.doorOpen;
    badges.push(
      typeof door === "boolean" ? (
        <Badge key="door" icon={door ? DoorOpen : DoorClosed} label={door ? "Door open" : "Door closed"} tone={door ? "warning" : "success"} raw={`doorOpen: ${door}`} />
      ) : (
        // D24: docs define a boolean; the API sent a number that stayed 1 while the lock was not on a door.
        <Badge key="door" icon={DoorOpen} label="Door: not verified" tone="muted" raw={`doorOpen: ${String(door)} · docs say true/false (D24) · lock not mounted on a door yet`} />
      ),
    );
  }
  if (typeof r?.pinsCurrentActive === "number") {
    const max = typeof r.pinsMaxCapacity === "number" ? r.pinsMaxCapacity : 199;
    badges.push(<Badge key="pins" icon={KeyRound} label={`${r.pinsCurrentActive} / ${max} PINs`} tone="info" raw={`pinsCurrentActive: ${r.pinsCurrentActive} · pinsMaxCapacity: ${String(r.pinsMaxCapacity)}`} meter={r.pinsCurrentActive / max} />);
  }
  if (typeof r?.wifiNetworkStatus === "number") {
    const ok = r.wifiNetworkStatus === 0;
    badges.push(<Badge key="wifi" icon={ok ? Wifi : WifiOff} label={WIFI[r.wifiNetworkStatus] ?? `Wi-Fi ${r.wifiNetworkStatus}`} tone={ok ? "success" : "destructive"} raw={`wifiNetworkStatus: ${r.wifiNetworkStatus}`} />);
  }
  if (typeof r?.wifiNetworkRssi === "number") {
    const rssi = r.wifiNetworkRssi;
    badges.push(<Badge key="rssi" icon={SignalIcon(rssi)} label={rssi >= -60 ? "Strong signal" : rssi >= -75 ? "Fair signal" : "Weak signal"} tone={rssi >= -60 ? "success" : rssi >= -75 ? "warning" : "destructive"} raw={`wifiNetworkRssi: ${rssi} dBm · channel ${String(r.wifiNetworkChannel ?? "?")} · band ${String(r.wifiNetworkBand ?? "?")}`} />);
  }
  if (typeof r?.wifiNetworkSsid === "string") {
    badges.push(<Badge key="ssid" icon={Router} label={r.wifiNetworkSsid} tone="muted" raw={`wifiNetworkSsid: ${r.wifiNetworkSsid} · ip ${String(r.wifiNetworkIpaddr ?? "?")} · dns ${String(r.wifiNetworkDns ?? "?")}`} />);
  }
  if (typeof r?.locksLinkCount === "number") {
    const max = typeof r.locksMaxCapacity === "number" ? r.locksMaxCapacity : 10;
    badges.push(<Badge key="links" icon={Link2} label={`${r.locksLinkCount} / ${max} links`} tone="info" raw={`locksLinkCount: ${r.locksLinkCount} · locksMaxCapacity: ${String(r.locksMaxCapacity)}`} meter={r.locksLinkCount / max} />);
  }
  // Jobs 4/5 report no device fields: their outcome is the webhook jobStatus (webhook table, API-verified for 0).
  if ((job.kind === "pin_create" || job.kind === "pin_delete") && job.webhook?.jobStatus !== undefined) {
    const status = job.webhook.jobStatus;
    const done = status === 0;
    // EXP-20260926-04: delete → 3 still releases igloohome's reservation of the PIN (it can be created again).
    const label = done
      ? job.kind === "pin_create"
        ? "PIN written to the lock"
        : "PIN deleted from the lock"
      : job.kind === "pin_delete" && status === 3
        ? "Not on the lock any more (used or expired) · igloohome released the PIN"
        : (job.webhook.meaning ?? `Failed (${status})`);
    badges.push(<Badge key="pin" icon={job.kind === "pin_create" ? KeyRound : Trash2} label={label} tone={done ? "success" : status === 3 ? "warning" : "destructive"} raw={`webhook jobStatus: ${status}${job.webhook.meaning ? ` (${job.webhook.meaning})` : ""}`} />);
  }
  const rssi = Array.isArray(r?.lockRssiList) ? (r.lockRssiList as { bluetoothName?: string; rssi?: number }[]) : [];
  const known = badges.length > 0;

  return (
    <AnimatePresence>
      {(known || job.state === "rejected") && (
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          aria-labelledby="result-title"
          className={cn("flex flex-col gap-3 rounded-2xl border p-5", job.state === "rejected" ? "border-destructive/30 bg-destructive/5" : "border-success/30 bg-success/5")}
        >
          <h2 id="result-title" className="flex items-center gap-2 font-semibold">
            {job.state === "rejected" ? <TriangleAlert className="size-4 text-destructive" aria-hidden /> : null}
            {job.state === "rejected" ? "igloohome said no" : "What the device reported"}
            {known && <EvidenceBadge level={job.webhook?.verification === "valid" ? "API" : job.webhook ? "UNVERIFIED" : "API"} />}
          </h2>
          {job.state === "rejected" ? (
            <p className="text-sm">
              {job.httpStatus !== undefined && <Code kind="http" value={job.httpStatus} />} {job.errorMessage}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">{badges}</div>
              {rssi.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Bluetooth signal to linked devices</p>
                  <ul className="flex flex-wrap gap-2">
                    {rssi.map((d, i) => (
                      <li key={`${d.bluetoothName}-${i}`}>
                        <Badge
                          icon={SignalIcon(d.rssi ?? -100)}
                          label={(d.bluetoothName && names[d.bluetoothName]?.name) || d.bluetoothName || "device"}
                          tone={(d.rssi ?? -100) >= -70 ? "success" : (d.rssi ?? -100) >= -85 ? "warning" : "destructive"}
                          raw={`bluetoothName: ${d.bluetoothName} · rssi: ${d.rssi} dBm`}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </motion.section>
      )}
    </AnimatePresence>
  );
}

function Step({
  icon: Icon,
  title,
  detail,
  at,
  done,
  tone = "primary",
}: {
  icon: LucideIcon;
  title: string;
  detail?: React.ReactNode;
  at?: string;
  done?: boolean;
  tone?: "primary" | "success" | "warning" | "destructive";
}) {
  const tones = {
    primary: "bg-primary text-primary-foreground",
    success: "bg-success text-primary-foreground",
    warning: "bg-warning text-primary-foreground",
    destructive: "bg-destructive text-primary-foreground",
  };
  return (
    <li className="relative flex gap-3 pl-0">
      <span aria-hidden className={cn("z-10 flex size-6 shrink-0 items-center justify-center rounded-full ring-4 ring-card", done ? tones[tone] : "bg-muted text-muted-foreground")}>
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium", !done && "text-muted-foreground")}>
          {title} {!done && <span className="sr-only">(pending)</span>}
        </p>
        {detail && <p className="text-xs break-all text-muted-foreground">{detail}</p>}
      </div>
      {at && (
        <span className="shrink-0 text-xs text-muted-foreground">
          <RelativeTime iso={at} />
        </span>
      )}
    </li>
  );
}
