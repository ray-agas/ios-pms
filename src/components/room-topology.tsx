"use client";

import { BedSingle, Bluetooth, ChevronDown, Clock, DoorClosed, House, Info, Link2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useId, useState } from "react";

import { EmergencyLock, type EmergencyOptions, type EmergencyRun } from "@/components/emergency-lock";
import { FindingBadge, type ExperimentFinding } from "@/components/experiment-finding";
import { RevealId, type RevealIdAction } from "@/components/reveal-id";
import { HealthCheckLauncher, type StartAction } from "@/components/health-check-launcher";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  BatteryMeter,
  DeviceGlyph,
  EvidenceBadge,
  KIND_LABEL,
  LiveDot,
  LockStatePill,
  RelativeTime,
} from "@/components/visuals";
import { cn } from "@/lib/utils";
import type { BridgeView, DeviceView, RoomView } from "@/server/application/dashboard";
import type { HealthCheckOption } from "@/server/application/health-check";
import { Code } from "@/components/code-hint";

type Names = Record<string, string>;
type LastEvent = { label: string; tone: string; occurredAt: string; kind: string };
type Checks = {
  options: Record<string, HealthCheckOption[]>;
  start: StartAction;
  lastEvents?: Record<string, LastEvent>;
  /** Plan F4b: super-admin only; absent for everyone else. */
  emergency?: { options: EmergencyOptions; run: EmergencyRun; findings?: Record<string, ExperimentFinding[]> };
  /** Plan G1: super-admin only; shows the full device ID on request. */
  revealId?: RevealIdAction;
};

const EVENT_TONE: Record<string, string> = {
  access: "text-success",
  denied: "text-warning",
  alert: "text-destructive",
  config: "text-info",
  job: "text-primary",
  online: "text-success",
  offline: "text-destructive",
};

const ease = [0.22, 1, 0.36, 1] as const;

const SPACE_ICON = { cabin: BedSingle, room: DoorClosed } as const;

export function RoomPanel({ room, names, checks, index = 0 }: { room: RoomView; names: Names; checks: Checks; index?: number }) {
  const direct = room.devices.filter((d) => !d.bridgeId);
  const Icon = room.kind ? SPACE_ICON[room.kind] : House;
  return (
    <motion.section
      aria-labelledby={`room-${room.id}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.08, ease }}
      className="flex min-w-0 flex-col gap-5 rounded-2xl border bg-card p-4 md:p-5"
    >
      <header className="flex items-center gap-3">
        <span aria-hidden className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`room-${room.id}`} className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <span className="truncate">{room.name}</span>
            {room.kind && (
              <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold tracking-normal text-accent-foreground capitalize">{room.kind}</span>
            )}
          </h2>
          <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
            {room.subtitle && <span>{room.subtitle}</span>}
            <span>
              {room.devices.length} device{room.devices.length === 1 ? "" : "s"} · {room.bridges.length} Bridge
              {room.bridges.length === 1 ? "" : "s"}
            </span>
            {room.timezone && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" aria-hidden /> {room.timezone}
              </span>
            )}
          </p>
        </div>
      </header>

      {room.bridges.map((bridge, i) => (
        <BridgeTree
          key={bridge.id}
          bridge={bridge}
          devices={room.devices.filter((d) => d.bridgeId === bridge.id)}
          names={names}
          checks={checks}
          timezone={room.timezone}
          place={room.name}
          delay={index * 0.08 + i * 0.1}
        />
      ))}

      {direct.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <Bluetooth className="size-3.5" aria-hidden /> Not on a Bridge · Bluetooth only
          </p>
          <ul className="flex flex-col gap-3">
            {direct.map((d) => (
              <li key={d.id}>
                <DeviceNode device={d} names={names} checks={checks} timezone={room.timezone} place={room.name} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {room.devices.length === 0 && <p className="text-sm text-muted-foreground">No devices in this {room.kind ?? "property"} yet.</p>}
    </motion.section>
  );
}

function BridgeTree({
  bridge,
  devices,
  names,
  checks,
  timezone,
  place,
  delay,
}: {
  bridge: BridgeView;
  devices: DeviceView[];
  names: Names;
  checks: Checks;
  timezone?: string;
  place?: string;
  delay: number;
}) {
  const online = bridge.status?.online;
  const rail = online === true ? "bg-success/50" : online === false ? "bg-destructive/30" : "bg-border";

  return (
    <div>
      <BridgeNode bridge={bridge} checks={checks} timezone={timezone} />
      <ul className="ml-[31px] pl-6" aria-label={`Devices linked to ${bridge.name ?? "Bridge"}`}>
        {devices.map((device, i) => {
          const last = i === devices.length - 1;
          return (
            <motion.li
              key={device.id}
              className="relative pt-3"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: delay + 0.15 + i * 0.07, ease }}
            >
              <motion.span
                aria-hidden
                className={cn("absolute -left-6 top-0 w-0.5 origin-top rounded-full", rail, last ? "h-11" : "bottom-0")}
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ duration: 0.35, delay: delay + i * 0.07 }}
              />
              <span aria-hidden className={cn("absolute -left-6 top-11 h-0.5 w-6 rounded-full", rail)} />
              {online && (
                <span
                  aria-hidden
                  className="absolute -left-6 top-[42px] size-1.5 animate-signal rounded-full bg-success motion-reduce:hidden"
                  style={{ animationDelay: `${i * 0.4}s` }}
                />
              )}
              <DeviceNode device={device} names={names} checks={checks} timezone={timezone} place={place} bridgeOnline={bridge.status?.online} />
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}

function BridgeNode({ bridge, checks, timezone }: { bridge: BridgeView; checks: Checks; timezone?: string }) {
  const online = bridge.status?.online;
  return (
    <div className="relative flex flex-wrap items-center gap-3 overflow-hidden rounded-xl border border-warning/30 bg-linear-to-br from-warning/10 via-card to-card p-3">
      <span className="relative">
        {online && (
          <span aria-hidden className="absolute inset-0 animate-ping rounded-xl bg-success/25 motion-reduce:animate-none" />
        )}
        <DeviceGlyph kind="bridge" className="relative" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{bridge.name ?? "Unnamed Bridge"}</p>
        <p className="truncate text-xs text-muted-foreground">
          Bridge · <span className="font-mono">{bridge.id}</span> · {bridge.linked.length} linked
        </p>
      </div>
      <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:flex-col sm:items-end sm:gap-1">
        {bridge.status ? (
          <span className="inline-flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="rounded outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                  <LiveDot online={online} label={online ? "Online" : "Offline"} />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                From the last Bridge connection webhook (event type 10, isOnline: {String(online)}). Not a live ping: it changes when
                igloohome sends the next connection event.
              </TooltipContent>
            </Tooltip>
            <span className="text-xs text-muted-foreground">
              <RelativeTime iso={bridge.status.since} timeZone={timezone} />
            </span>
            <EvidenceBadge level={bridge.status.evidence} />
          </span>
        ) : (
          <LiveDot label="No connection event yet" />
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="inline-flex items-center gap-1 rounded text-xs text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              Paired <RelativeTime iso={bridge.lastSyncAt} timeZone={timezone} />
              <Info className="size-3" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">
            A Bridge&apos;s lastSync equals its pairing time, so it is not a health signal. Online/offline comes from
            Bridge webhook events.
          </TooltipContent>
        </Tooltip>
      </div>
      {checks.options[bridge.id] && (
        <div className="w-full border-t border-warning/20 pt-3">
          <HealthCheckLauncher options={checks.options[bridge.id]} deviceName={bridge.name ?? "Bridge"} start={checks.start} />
        </div>
      )}
    </div>
  );
}

function DeviceNode({
  device,
  names,
  checks,
  timezone,
  place,
  bridgeOnline,
}: {
  device: DeviceView;
  names: Names;
  checks: Checks;
  timezone?: string;
  place?: string;
  bridgeOnline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const title = device.name ?? `Unnamed ${KIND_LABEL[device.kind]?.toLowerCase() ?? "device"}`;

  return (
    <motion.div
      layout
      transition={{ duration: 0.3, ease }}
      className={cn(
        "overflow-hidden rounded-xl border bg-background/60 transition-colors",
        open ? "border-primary/40 shadow-sm shadow-primary/5" : "hover:border-primary/30",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 p-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <DeviceGlyph kind={device.kind} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-medium">{title}</span>
            <LockStatePill state={device.lockState} />
            {device.managed?.status === "disabled" && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Disabled in iot-pms</span>
            )}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {device.modelName ?? KIND_LABEL[device.kind]} · <span className="font-mono">{device.id}</span>
          </span>
        </span>
        <span className="hidden flex-col items-end gap-1 sm:flex">
          <BatteryMeter percent={device.batteryPercent} />
          <span className="text-xs text-muted-foreground">
            Synced <RelativeTime iso={device.lastSyncAt} timeZone={timezone} />
          </span>
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} className="text-muted-foreground">
          <ChevronDown className="size-4" aria-hidden />
        </motion.span>
      </button>

      {checks.lastEvents?.[device.id] && (
        <p className="flex items-center gap-1.5 px-3 pb-2 text-xs text-muted-foreground">
          <span className={cn("size-1.5 rounded-full bg-current", EVENT_TONE[checks.lastEvents[device.id].tone])} aria-hidden />
          Last event: <span className={cn("font-medium", EVENT_TONE[checks.lastEvents[device.id].tone])}>{checks.lastEvents[device.id].label}</span>
          <RelativeTime iso={checks.lastEvents[device.id].occurredAt} timeZone={timezone} />
        </p>
      )}

      <div className="flex items-center justify-between gap-3 px-3 pb-3 sm:hidden">
        <BatteryMeter percent={device.batteryPercent} />
        <span className="text-xs text-muted-foreground">
          Synced <RelativeTime iso={device.lastSyncAt} timeZone={timezone} />
        </span>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={detailsId}
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease }}
          >
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t bg-muted/40 p-3 text-sm sm:grid-cols-3">
              <Detail label="API type" value={device.providerType} mono />
              <Detail label="Model" value={<Code kind="model" value={device.modelPrefix} />} />
              <Detail label="Battery" value={device.batteryPercent === undefined ? "Not reported" : `${device.batteryPercent}%`} />
              <Detail label="Lock state" value={device.lockState ? device.lockState[0].toUpperCase() + device.lockState.slice(1) : "Not reported"} />
              <Detail
                label="Last sync"
                value={
                  device.lastSyncAt
                    ? new Date(device.lastSyncAt).toLocaleString("en-GB", { timeZone: timezone ?? "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" })
                    : "Not reported"
                }
              />
              <Detail label="Bridge" value={device.bridgeName ?? (device.bridgeId ? device.bridgeId : "None")} />
              {checks.revealId && (
                <div className="col-span-2 flex min-w-0 flex-col gap-0.5 sm:col-span-3">
                  <dt className="text-xs text-muted-foreground">Device ID</dt>
                  <dd className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-sm">{device.id}</span>
                    <RevealId deviceRef={device.id} reveal={checks.revealId} />
                  </dd>
                </div>
              )}
              <div className="col-span-2 flex flex-col gap-1 sm:col-span-3">
                <dt className="text-xs text-muted-foreground">Paired with</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {device.linked.length === 0 ? (
                    <span className="text-muted-foreground">Nothing reported on this record</span>
                  ) : (
                    device.linked.map((id) => (
                      <span key={id} className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-xs ring-1 ring-border">
                        <Link2 className="size-3" aria-hidden /> {names[id] ?? id}
                      </span>
                    ))
                  )}
                </dd>
              </div>
              <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-3">
                <dt className="text-xs text-muted-foreground">Algo PIN support</dt>
                <dd className="flex items-center gap-2">
                  {device.capabilities.algoPin === "unknown" ? "Unknown" : device.capabilities.algoPin ? "Yes" : "No"}
                  <EvidenceBadge level={device.capabilities.evidence} />
                </dd>
                <dd className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                  Record <EvidenceBadge level="API" />
                </dd>
              </div>
              {checks.options[device.id]?.length ? (
                <div className="col-span-2 border-t pt-3 sm:col-span-3">
                  <HealthCheckLauncher options={checks.options[device.id]} deviceName={title} bridgeName={device.bridgeName} start={checks.start} />
                </div>
              ) : null}
              {checks.emergency?.findings?.[device.id]?.length ? (
                // Collapsed by default: history, not something needed every time (hover a badge for the reason).
                <details className="group col-span-2 text-xs sm:col-span-3 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
                    <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden /> Experiment history ({checks.emergency.findings[device.id].length})
                  </summary>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {checks.emergency.findings[device.id].map((f) => (
                      <FindingBadge key={f.kind} finding={f} withLabel />
                    ))}
                  </div>
                </details>
              ) : null}
              {checks.emergency?.options[device.id] && (
                <div className="col-span-2 sm:col-span-3">
                  <EmergencyLock
                    deviceRef={device.id}
                    lockName={title}
                    place={place}
                    bridgeOnline={bridgeOnline}
                    lockState={device.lockState}
                    options={checks.emergency.options[device.id]}
                    run={checks.emergency.run}
                    deviceKind={device.kind}
                  />
                </div>
              )}
            </dl>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Detail({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("truncate", mono && "font-mono")}>{value}</dd>
    </div>
  );
}
