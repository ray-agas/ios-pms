import { ArrowRight, BatteryWarning, CalendarClock, ChevronDown, Cpu, House, RadioTower, ShieldCheck, ShieldX, Siren, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { FeedRow } from "@/components/activity-feed";
import { LiveRefresh } from "@/components/live-refresh";
import { DevPanel } from "@/components/developer/dev-panel";
import { FadeIn, Stagger, StaggerItem } from "@/components/motion";
import { CountUp, DeviceGlyph, LiveDot, LoadError, RelativeTime } from "@/components/visuals";
import { cn } from "@/lib/utils";
import { auth } from "@/auth";
import { deviceNames, getActivityFeed, getConnection, getSite } from "@/server/application/dashboard";
import { recentEmergencyActions } from "@/server/application/remote-lock";
import { callerOf } from "@/server/application/scopes";
import { atLeast } from "@/server/domain/models";

export const metadata: Metadata = { title: "Overview · iot-pms" };

const LOW_BATTERY = 30;

export default async function OverviewPage() {
  const session = await auth();
  const [connection, site, feed, names, caller] = await Promise.all([
    getConnection(),
    getSite(),
    getActivityFeed({ limit: 500 }),
    deviceNames(),
    callerOf(session?.user?.role, session?.user?.uid),
  ]);
  const emergencies = await recentEmergencyActions();
  const superAdmin = atLeast(session?.user?.role, "super_admin");

  const events24h = countSince(feed.items, 86_400_000);
  const bridges = site.data?.bridges ?? [];
  const bridgesOnline = bridges.filter((b) => b.status?.online).length;
  const lowBattery = (site.data?.devices ?? []).filter((d) => d.batteryPercent !== undefined && d.batteryPercent <= LOW_BATTERY);

  return (
    <div className="flex flex-col gap-6">
      <LiveRefresh lastRowId={feed.lastRowId} names={names} />
      <FadeIn>
        <p className="text-sm font-medium text-primary">
          {new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Jakarta", weekday: "long", day: "numeric", month: "long" })}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Lab overview</h1>
      </FadeIn>

      {/* Plan F4b: every emergency lock/unlock of the last 24 h, visible to everyone. Collapsible: it can get long;
          it opens by itself while an unlock has not been locked again. */}
      {emergencies.length > 0 && (
        <details
          open={emergencies.some((e) => e.action === "unlock" && !e.relocked)}
          className="group rounded-2xl border border-destructive/40 bg-destructive/5 p-4 [&_summary::-webkit-details-marker]:hidden"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg font-semibold text-destructive outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <Siren className="size-4" aria-hidden /> Emergency actions · last 24 hours
            <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs">{emergencies.length}</span>
            {(() => {
              const open = emergencies.filter((e) => e.action === "unlock" && !e.relocked).length;
              return open ? <span className="text-xs font-medium">· {open} not locked again</span> : <span className="text-xs font-normal text-muted-foreground">· all locked again</span>;
            })()}
            <ChevronDown className="ml-auto size-4 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="mt-2 flex max-h-80 flex-col divide-y divide-destructive/15 overflow-y-auto text-sm">
            {emergencies.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", e.action === "unlock" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground")}>
                  {e.action === "unlock" ? "Unlocked" : "Locked"}
                </span>
                <span className="min-w-0 flex-1">
                  {names[e.deviceRef]?.name ?? e.deviceRef} · by {e.actor} <RelativeTime iso={e.at} />
                  {e.detail ? <span className="text-muted-foreground"> · {e.detail}</span> : null}
                </span>
                {e.action === "unlock" &&
                  (e.relocked ? (
                    <span className="text-xs text-success">Locked again</span>
                  ) : superAdmin && e.spaceId ? (
                    <Link href={`/devices?watch=${e.spaceId}`} className="inline-flex items-center gap-1 rounded-lg bg-destructive px-2.5 py-1 text-xs font-medium text-white hover:bg-destructive/90">
                      Lock again <ArrowRight className="size-3" aria-hidden />
                    </Link>
                  ) : (
                    <span className="text-xs font-medium text-destructive">Not locked again yet</span>
                  ))}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Connection hero + trial */}
      <div className="grid gap-4 lg:grid-cols-3">
        <FadeIn delay={0.05} className="lg:col-span-2">
          {connection.data ? (
            <section
              aria-labelledby="conn-title"
              className="relative h-full overflow-hidden rounded-2xl border bg-linear-to-br from-primary/12 via-card to-card p-5"
            >
              <div aria-hidden className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full border-[28px] border-primary/5" />
              <div className="flex items-start gap-4">
                <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
                  <Zap className="size-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 id="conn-title" className="text-lg font-semibold">
                    igloohome API connected
                  </h2>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <LiveDot online label="Healthy" />
                    <span className="capitalize">{connection.data.tier ?? "Tier not reported"}</span>
                    {connection.data.flow && <span>{connection.data.flow}</span>}
                    <span>
                      checked <RelativeTime iso={connection.data.checkedAt} />
                    </span>
                  </p>
                </div>
              </div>
              <div className="mt-5">
                <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Your scopes (igloohomeapi/…) · {caller.scopes.length} of {caller.ceiling.length} granted to iot-pms
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {caller.scopes.map((scope) => (
                    <li key={scope} title={scope} className="inline-flex items-center gap-1 rounded-full bg-background/80 px-2.5 py-1 font-mono text-xs ring-1 ring-border">
                      <ShieldCheck className="size-3.5 text-success" aria-hidden /> {shortScope(scope)}
                    </li>
                  ))}
                  {caller.ceiling
                    .filter((scope) => !caller.scopes.includes(scope))
                    .map((scope) => (
                      <li key={scope} title="Granted to iot-pms, not to you" className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
                        <ShieldX className="size-3.5" aria-hidden /> {shortScope(scope)} <span className="sr-only">(not yours)</span>
                      </li>
                    ))}
                </ul>
              </div>
            </section>
          ) : (
            <LoadError error={connection.error!} />
          )}
        </FadeIn>

        <FadeIn delay={0.1}>
          <TrialCard daysLeft={connection.data?.trialDaysLeft} endsAt={connection.data?.subscriptionEndsAt} status={connection.data?.status} />
        </FadeIn>
      </div>

      {/* Stat tiles */}
      <Stagger className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={House} label="Rooms" value={site.data?.rooms.length} tint="bg-primary/10 text-primary" />
        <Stat icon={Cpu} label="Devices" value={site.data?.devices.length} tint="bg-info/10 text-info" />
        <Stat
          icon={RadioTower}
          label="Bridges online"
          value={bridgesOnline}
          suffix={`/ ${bridges.length}`}
          hint={bridges.some((b) => !b.status) ? "some not reported yet" : undefined}
          tint="bg-warning/15 text-warning"
        />
        <Stat icon={Zap} label="Events · 24 h" value={events24h} tint="bg-success/10 text-success" />
      </Stagger>

      {lowBattery.length > 0 && (
        <FadeIn className="flex items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4">
          <BatteryWarning className="size-5 shrink-0 text-warning" aria-hidden />
          <p className="text-sm">
            <span className="font-medium">Low battery:</span> {lowBattery.map((d) => `${d.name ?? d.id} (${d.batteryPercent}%)`).join(", ")}
          </p>
        </FadeIn>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Rooms */}
        <FadeIn delay={0.15} className="lg:col-span-2">
          <section aria-labelledby="rooms-title" className="flex h-full flex-col gap-3 rounded-2xl border bg-card p-5">
            <SectionTitle id="rooms-title" title="Rooms" href="/devices" linkLabel="Topology" />
            {site.error && <LoadError error={site.error} />}
            <ul className="flex flex-col gap-2">
              {site.data?.rooms.map((room) => (
                <li key={room.id}>
                  <Link
                    href="/devices"
                    className="group flex items-center gap-3 rounded-xl border bg-background/60 p-3 outline-none transition-colors hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{room.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        via {room.bridges.map((b) => b.name ?? b.id).join(", ") || "no Bridge"}
                      </span>
                    </span>
                    <span className="flex -space-x-2">
                      {room.devices.map((d) => (
                        <DeviceGlyph key={d.id} kind={d.kind} className="size-8 rounded-full ring-2 ring-card [&_svg]:size-4" />
                      ))}
                    </span>
                    <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </FadeIn>

        {/* Recent activity */}
        <FadeIn delay={0.2} className="lg:col-span-3">
          <section aria-labelledby="recent-title" className="flex h-full flex-col gap-2 rounded-2xl border bg-card p-5">
            <SectionTitle id="recent-title" title="Latest activity" href="/activity" linkLabel="All events" />
            {feed.items.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No events stored yet. They appear once igloohome sends a webhook.</p>
            ) : (
              <ol className="-mx-2.5 flex flex-col">
                {feed.items.slice(0, 5).map((item) => (
                  <li key={item.key}>
                    <FeedRow item={item} names={names} />
                  </li>
                ))}
              </ol>
            )}
          </section>
        </FadeIn>
      </div>
      <DevPanel operations={["serverHealth", "listDevices", "listProperties", "getDevice"]} />
    </div>
  );
}

const shortScope = (scope: string) => scope.replace(/^igloohomeapi\//, "");

function countSince(items: { occurredAt: string }[], ms: number) {
  const since = new Date(Date.now() - ms).toISOString();
  return items.filter((i) => i.occurredAt >= since).length;
}

function SectionTitle({ id, title, href, linkLabel }: { id: string; title: string; href: string; linkLabel: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 id={id} className="font-semibold">
        {title}
      </h2>
      <Link href={href} className="inline-flex items-center gap-1 rounded text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
        {linkLabel} <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  suffix,
  hint,
  tint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: number;
  suffix?: string;
  hint?: string;
  tint: string;
}) {
  return (
    <StaggerItem className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <span aria-hidden className={cn("flex size-9 items-center justify-center rounded-xl", tint)}>
        <Icon className="size-4.5" />
      </span>
      <div>
        <p className="text-2xl font-semibold tracking-tight md:text-3xl">
          {value === undefined ? "—" : <CountUp value={value} />}
          {suffix && <span className="ml-1 text-base font-normal text-muted-foreground">{suffix}</span>}
        </p>
        <p className="text-sm text-muted-foreground">{label}</p>
        {hint && <p className="text-xs text-muted-foreground/80">{hint}</p>}
      </div>
    </StaggerItem>
  );
}

function TrialCard({ daysLeft, endsAt, status }: { daysLeft?: number; endsAt?: string; status?: string }) {
  const urgent = daysLeft !== undefined && daysLeft <= 7;
  // Ring shows the last 30 days; the trial's real length is not reported by the API.
  const fraction = daysLeft === undefined ? 0 : Math.min(daysLeft, 30) / 30;
  const circumference = 2 * Math.PI * 34;
  return (
    <section aria-labelledby="trial-title" className={cn("flex h-full items-center gap-4 rounded-2xl border bg-card p-5", urgent && "border-warning/50 bg-warning/5")}>
      <div className="relative size-20 shrink-0">
        <svg viewBox="0 0 80 80" className="size-20 -rotate-90" aria-hidden>
          <circle cx="40" cy="40" r="34" fill="none" strokeWidth="8" className="stroke-muted" />
          <circle
            cx="40"
            cy="40"
            r="34"
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            className={cn("transition-[stroke-dashoffset] duration-1000", urgent ? "stroke-warning" : "stroke-primary")}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
          />
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl leading-none font-semibold">{daysLeft === undefined ? "—" : <CountUp value={daysLeft} />}</span>
          <span className="text-[10px] text-muted-foreground">days</span>
        </span>
      </div>
      <div className="min-w-0">
        <h2 id="trial-title" className="flex items-center gap-1.5 font-semibold">
          <CalendarClock className="size-4 text-muted-foreground" aria-hidden /> Subscription
        </h2>
        <p className="text-sm text-muted-foreground">{status ? status[0].toUpperCase() + status.slice(1) : "Status not reported"}</p>
        <p className="text-sm">
          {endsAt
            ? `Ends ${new Date(endsAt).toLocaleDateString("en-GB", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" })}`
            : "End date not reported"}
        </p>
      </div>
    </section>
  );
}
