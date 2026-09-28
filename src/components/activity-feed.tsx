"use client";

import { Clock, Info, RadioTower, ShieldAlert, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { DeviceGlyph, EvidenceBadge, FEED_ICON, LiveDot, METHOD_ICON, RelativeTime } from "@/components/visuals";
import { cn } from "@/lib/utils";
import type { FeedItem } from "@/server/application/dashboard";
import { Code } from "@/components/code-hint";

export type DeviceNames = Record<string, { name?: string; kind: string; modelName?: string }>;
interface Feed {
  items: FeedItem[];
  lastRowId: number;
  hiddenSystem: number;
}

const TIME_ZONE = "Asia/Jakarta";
const POLL_MS = 5000;

const TONE: Record<FeedItem["tone"], string> = {
  access: "bg-success/12 text-success ring-success/25",
  denied: "bg-warning/15 text-warning ring-warning/30",
  alert: "bg-destructive/12 text-destructive ring-destructive/25",
  config: "bg-info/12 text-info ring-info/25",
  system: "bg-muted text-muted-foreground ring-border",
  job: "bg-primary/12 text-primary ring-primary/25",
  online: "bg-success/12 text-success ring-success/25",
  offline: "bg-destructive/12 text-destructive ring-destructive/25",
};

function iconFor(item: FeedItem): LucideIcon {
  if (item.method) return METHOD_ICON[item.method];
  if (item.kind === "job") return FEED_ICON.job;
  if (item.kind === "bridge") return FEED_ICON[item.tone === "online" ? "online" : "offline"];
  if (item.tone === "alert") return ShieldAlert;
  if (item.tone === "system") return Clock;
  return Info;
}

export function FeedRow({ item, names, fresh }: { item: FeedItem; names: DeviceNames; fresh?: boolean }) {
  const device = names[item.deviceDisplay];
  const time = new Date(item.occurredAt).toLocaleTimeString("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });

  return (
    <div className={cn("relative flex gap-3 rounded-xl p-2.5 transition-colors", fresh && "bg-primary/5")}>
      <span aria-hidden className={cn("relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full ring-1", TONE[item.tone])}>
        {createElement(iconFor(item), { className: "size-4" })}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
          {item.label}
          {fresh && <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground uppercase">new</span>}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {device?.name ?? item.deviceDisplay}
          {device?.modelName && <span className="hidden sm:inline"> · {device.modelName}</span>}
          {item.bridgeDisplay && <span className="hidden sm:inline"> · via Bridge {names[item.bridgeDisplay]?.name ?? item.bridgeDisplay}</span>}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {item.pinFingerprint && (
            <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground" title="PIN fingerprint (the PIN itself is never stored)">
              PIN #{item.pinFingerprint.slice(0, 6)}
            </span>
          )}
          {item.logType !== undefined && (
            <Code kind="log" value={item.logType} className="text-[11px] text-muted-foreground">
              type {item.logType}
            </Code>
          )}
          {item.jobStatus !== undefined && (
            <Code kind="jobStatus" value={item.jobStatus} className="text-[11px] text-muted-foreground">
              jobStatus {item.jobStatus}
            </Code>
          )}
          {item.verification !== "valid" && <EvidenceBadge level="UNVERIFIED" />}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
        <time dateTime={item.occurredAt} className="text-sm font-medium tabular-nums">
          {time}
        </time>
        <span className="text-xs text-muted-foreground">
          <RelativeTime iso={item.occurredAt} />
        </span>
      </div>
    </div>
  );
}

const FILTERS = [
  { id: "all", label: "All" },
  { id: "access", label: "Access" },
  { id: "denied", label: "Denied" },
  { id: "alert", label: "Alerts" },
  { id: "config", label: "Settings" },
  { id: "bridge", label: "Bridge & jobs" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

function matches(item: FeedItem, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "bridge") return item.kind !== "log";
  return item.tone === filter;
}

function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
}

function dayLabel(key: string) {
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return new Date(`${key}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

function merge(current: FeedItem[], incoming: FeedItem[]) {
  const seen = new Set(current.map((i) => i.key));
  return [...incoming.filter((i) => !seen.has(i.key)), ...current].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

/** Which Bridge an event belongs to: connection events are about the Bridge itself; lock logs and jobs came through one. */
export function bridgeOf(item: FeedItem): string {
  return item.kind === "bridge" ? item.deviceDisplay : (item.bridgeDisplay ?? NO_BRIDGE);
}
const NO_BRIDGE = "none";

export interface BridgeChoice {
  id: string;
  name: string;
  online?: boolean;
}

export function ActivityFeed({
  initial,
  names,
  bridges,
  initialBridge = "all",
  initialDevice = "all",
}: {
  initial: Feed;
  names: DeviceNames;
  bridges: BridgeChoice[];
  initialBridge?: string;
  initialDevice?: string;
}) {
  const [bridge, setBridgeState] = useState(initialBridge);
  const [device, setDeviceState] = useState(initialDevice);
  // Keep the choices in the URL so they survive a reload and can be shared.
  const setParam = (key: string, value: string) => {
    const url = new URL(window.location.href);
    if (value === "all") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    window.history.replaceState(null, "", url);
  };
  const setBridge = (next: string) => {
    setBridgeState(next);
    setParam("bridge", next);
    setDeviceState("all"); // a device belongs to one Bridge: start over
    setParam("device", "all");
  };
  const setDevice = (next: string) => {
    setDeviceState(next);
    setParam("device", next);
  };
  const [items, setItems] = useState(initial.items);
  const [hiddenSystem, setHiddenSystem] = useState(initial.hiddenSystem);
  const [showSystem, setShowSystem] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [state, setState] = useState<"live" | "error">("live");
  const [announcement, setAnnouncement] = useState("");
  const lastRowId = useRef(initial.lastRowId);

  const poll = useCallback(
    async (reset = false) => {
      try {
        const after = reset ? 0 : lastRowId.current;
        const response = await fetch(`/api/activity?after=${after}&system=${showSystem ? 1 : 0}`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const feed: Feed = await response.json();
        lastRowId.current = feed.lastRowId;
        setState("live");
        if (reset) {
          setItems(feed.items);
          setHiddenSystem(feed.hiddenSystem);
          return;
        }
        setHiddenSystem((n) => n + feed.hiddenSystem);
        if (feed.items.length) {
          setItems((current) => merge(current, feed.items));
          setFresh(new Set(feed.items.map((i) => i.key)));
          setAnnouncement(`${feed.items.length} new event${feed.items.length === 1 ? "" : "s"}: ${feed.items[0].label}`);
        }
      } catch {
        setState("error");
      }
    },
    [showSystem],
  );

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void poll();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  const toggleSystem = () => {
    setShowSystem((v) => !v);
  };
  // Reload from scratch when the system filter flips (skips the first render).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    void poll(true);
  }, [showSystem, poll]);

  const inBridgeAll = bridge === "all" ? items : items.filter((i) => bridgeOf(i) === bridge);
  // Devices seen through the selected Bridge (the Bridge's own connection events count as the Bridge).
  const devices = useMemo(() => {
    const seen = new Map<string, number>();
    for (const i of inBridgeAll) seen.set(i.deviceDisplay, (seen.get(i.deviceDisplay) ?? 0) + 1);
    return [...seen].sort((a, b) => b[1] - a[1]);
  }, [inBridgeAll]);
  const deviceActive = device !== "all" && devices.some(([id]) => id === device) ? device : "all";
  const inBridge = deviceActive === "all" ? inBridgeAll : inBridgeAll.filter((i) => i.deviceDisplay === deviceActive);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, inBridge.filter((i) => matches(i, f.id)).length])), [inBridge]);
  const visible = inBridge.filter((i) => matches(i, filter));
  const perBridge = useMemo(() => {
    const known = new Map(bridges.map((b) => [b.id, 0]));
    for (const i of items) known.set(bridgeOf(i), (known.get(bridgeOf(i)) ?? 0) + 1);
    return known;
  }, [items, bridges]);
  const bridgeName = (id: string) => (id === NO_BRIDGE ? "No Bridge" : (bridges.find((b) => b.id === id)?.name ?? names[id]?.name ?? id));
  // "All": one section per Bridge (known Bridges first, in topology order), each with its own day groups.
  const sections = useMemo(() => {
    const order = [...bridges.map((b) => b.id), ...[...perBridge.keys()].filter((id) => !bridges.some((b) => b.id === id))];
    return bridge === "all"
      ? order.map((id) => ({ id, items: visible.filter((i) => bridgeOf(i) === id) })).filter((sec) => sec.items.length > 0)
      : [{ id: bridge, items: visible }];
  }, [bridge, bridges, perBridge, visible]);

  return (
    <div className="flex flex-col gap-4">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <div role="group" aria-label="Bridge" className="-mx-4 -my-1 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] md:mx-0 md:px-1">
        {[{ id: "all", name: "All Bridges" } as BridgeChoice, ...bridges, ...(perBridge.get(NO_BRIDGE) ? [{ id: NO_BRIDGE, name: "No Bridge" }] : [])].map((b) => {
          const active = bridge === b.id;
          return (
            <button
              key={b.id}
              type="button"
              aria-pressed={active}
              onClick={() => setBridge(b.id)}
              className={cn(
                "flex h-11 shrink-0 items-center gap-2.5 rounded-xl border px-3.5 text-left text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                active ? "border-primary/50 bg-accent text-foreground" : "bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground",
              )}
            >
              <RadioTower className={cn("size-4", active ? "text-primary" : "")} aria-hidden />
              <span className="flex flex-col leading-tight">
                <span className="font-medium">{b.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {b.id === "all" ? `${items.length} events` : `${perBridge.get(b.id) ?? 0} events`}
                  {b.online !== undefined && ` · ${b.online ? "online" : "offline"}`}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {devices.length > 1 && (
        <div role="group" aria-label="Device" className="-mx-4 -my-1 flex gap-1.5 overflow-x-auto px-4 py-1 [scrollbar-width:none] md:mx-0 md:px-1">
          {[["all", inBridgeAll.length] as [string, number], ...devices].map(([id, n]) => {
            const active = deviceActive === id;
            const d = names[id];
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => setDevice(id)}
                className={cn(
                  "flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                  active ? "border-primary/50 bg-primary/10 text-primary" : "bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {id !== "all" && d?.kind && <DeviceGlyph kind={d.kind} className="size-5 rounded [&_svg]:size-3" />}
                <span className="max-w-40 truncate">{id === "all" ? "All devices" : (d?.name ?? id)}</span>
                <span className="text-xs tabular-nums opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filter events" className="-mx-4 -my-1 flex gap-1.5 overflow-x-auto px-4 py-1 [scrollbar-width:none] md:mx-0 md:px-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "relative flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                filter === f.id ? "text-primary-foreground" : "bg-card text-muted-foreground ring-1 ring-border hover:text-foreground",
              )}
            >
              {filter === f.id && (
                <motion.span layoutId="feed-filter" className="absolute inset-0 rounded-full bg-primary" transition={{ type: "spring", stiffness: 400, damping: 32 }} />
              )}
              <span className="relative">{f.label}</span>
              <span className="relative text-xs tabular-nums opacity-70">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <LiveDot online={state === "live"} label={state === "live" ? "Live" : "Reconnecting…"} />
          <Button variant="outline" size="sm" aria-pressed={showSystem} onClick={toggleSystem}>
            <Clock /> {showSystem ? "Hide" : "Show"} clock syncs{!showSystem && hiddenSystem > 0 ? ` (${hiddenSystem})` : ""}
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyFeed filtered={inBridge.length > 0} bridge={bridge === "all" || inBridge.length > 0 ? undefined : bridgeName(bridge)} />
      ) : (
        <div className="flex flex-col gap-8">
          {sections.map((sec) => (
            <section key={sec.id} aria-label={`Events via ${bridgeName(sec.id)}`} className="flex flex-col gap-3">
              {bridge === "all" && (
                <h2 className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm font-semibold">
                  <RadioTower className="size-4 text-warning" aria-hidden />
                  {bridgeName(sec.id)}
                  <span className="font-normal text-muted-foreground">
                    · {sec.items.length} event{sec.items.length === 1 ? "" : "s"}
                  </span>
                </h2>
              )}
              <DayGroups items={sec.items} names={names} fresh={fresh} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function DayGroups({ items, names, fresh }: { items: FeedItem[]; names: DeviceNames; fresh: Set<string> }) {
  const groups: { key: string; items: FeedItem[] }[] = [];
  for (const item of items) {
    const key = dayKey(item.occurredAt);
    if (groups.at(-1)?.key !== key) groups.push({ key, items: [] });
    groups.at(-1)!.items.push(item);
  }
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.key} aria-label={dayLabel(group.key)} className="flex flex-col gap-1">
          <h3 className="sticky top-14 z-20 -mx-1 bg-background/85 px-1 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur md:top-0">
            {dayLabel(group.key)}
          </h3>
          <ol className="relative flex flex-col before:absolute before:top-4 before:bottom-4 before:left-[27px] before:w-px before:bg-border">
            <AnimatePresence initial={false}>
              {group.items.map((item) => (
                <motion.li
                  key={item.key}
                  layout
                  initial={{ opacity: 0, y: -12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                >
                  <FeedRow item={item} names={names} fresh={fresh.has(item.key)} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        </section>
      ))}
    </div>
  );
}

function EmptyFeed({ filtered, bridge }: { filtered: boolean; bridge?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card/50 px-6 py-14 text-center">
      <span aria-hidden className="relative flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <span className="absolute inset-0 animate-ping rounded-2xl bg-primary/10 motion-reduce:animate-none" />
        <RadioTower className="size-6" />
      </span>
      <p className="font-medium">{bridge ? `No events via ${bridge} yet` : filtered ? "Nothing matches this filter" : "Listening for events"}</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {bridge
          ? "Nothing has arrived through this Bridge since the webhook was set up. An offline Bridge sends no events."
          : filtered
          ? "Try another filter."
          : "Use a lock or the igloohome app. Events arrive by webhook, usually within 10 seconds, and appear here on their own."}
      </p>
    </div>
  );
}
