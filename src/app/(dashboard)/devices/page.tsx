import { ArrowLeft, ArrowRight, Eye, PackagePlus, Settings2, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DevPanel } from "@/components/developer/dev-panel";
import { FilterBar } from "@/components/filter-bar";
import { FadeIn, Stagger, StaggerItem } from "@/components/motion";
import { LiveRefresh } from "@/components/live-refresh";
import { RefreshAt } from "@/components/refresh-at";
import { RoomPanel } from "@/components/room-topology";
import { SpaceList } from "@/components/space-list";
import { Button } from "@/components/ui/button";
import { DeviceGlyph, EvidenceBadge, LoadError, RelativeTime } from "@/components/visuals";
import { KIND_LABEL } from "@/lib/device-kinds";
import { filterSpaces, PAGE_SIZE, parseWatch, summarize } from "@/lib/space-summary";
import { auth } from "@/auth";
import { callerOf } from "@/server/application/scopes";
import { getSite, latestEventByDevice } from "@/server/application/dashboard";
import { experimentFindings, healthCheckOptions, listJobs } from "@/server/application/health-check";
import { listSpaces } from "@/server/application/device-registry";
import { remoteLockOptions } from "@/server/application/remote-lock";
import { getMonitorMax } from "@/server/config";
import { atLeast } from "@/server/domain/models";

import { remoteLockAction, startHealthCheckAction } from "../jobs/actions";
import { revealDeviceIdAction } from "./manage/actions";

export const metadata: Metadata = { title: "Devices · iot-pms" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Plan F7b: a compact, filterable list of cabins and rooms. Only watched ones (at most IOT_PMS_MONITOR_MAX) load
// per-device detail from igloohome and show the full topology; the rest cost no igloohome call per render.
export default async function DevicesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const session = await auth();
  const caller = await callerOf(session?.user?.role, session?.user?.uid);
  const max = getMonitorMax();
  const spaceIds = (await listSpaces()).map((s) => s.id);
  const watched = parseWatch(one(params.watch), spaceIds, max);

  const [site, options, jobs, latest] = await Promise.all([
    getSite(watched.join(",")),
    healthCheckOptions(caller),
    listJobs(1),
    latestEventByDevice(),
  ]);
  const canManage = atLeast(session?.user?.role, "super_admin");
  // Plan F4b: the Emergency panel exists only for super-admins, and only watched cabins show device details.
  const emergency =
    canManage && watched.length ? { options: await remoteLockOptions(caller), run: remoteLockAction, findings: await experimentFindings() } : undefined;
  const checks = { options, start: startHealthCheckAction, lastEvents: latest.events, emergency, revealId: canManage ? revealDeviceIdAction : undefined };
  // Earliest moment a temporarily disabled button becomes available again.
  const nextRetry = [
    ...Object.values(options).flatMap((list) => list.map((o) => o.retryAt)),
    ...Object.values(emergency?.options ?? {}).flatMap((o) => [o.lock.retryAt, o.unlock.retryAt]),
  ]
    .filter((x): x is string => Boolean(x))
    .sort()[0]; // only set while disabled, so it is in the future; RefreshAt ignores anything past

  const rows = (site.data?.spaces ?? []).map((room) => summarize(room, latest.events));
  const filtered = filterSpaces(rows, { q: one(params.q), kind: one(params.kind), bridge: one(params.bridge), attention: one(params.attention) === "1" });
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number(one(params.page)) || 1));
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const watchedRooms = (site.data?.spaces ?? []).filter((r) => r.spaceId !== undefined && watched.includes(r.spaceId));
  const watchRefs = watchedRooms.flatMap((r) => [...r.bridges, ...r.devices].map((d) => d.id));

  const href = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (one(v)) next.set(k, one(v)!);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    return `/devices${next.size ? `?${next}` : ""}`;
  };
  const watchHref = (id: number) => {
    const next = watched.includes(id) ? watched.filter((w) => w !== id) : [...watched, id];
    return href({ watch: next.length ? next.join(",") : undefined });
  };

  return (
    <div className="flex flex-col gap-6">
      <LiveRefresh lastRowId={latest.lastRowId} names={site.data ? namesOf(site.data) : {}} watchRefs={watchRefs} />
      <RefreshAt at={nextRetry} />
      <FadeIn className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-primary">Topology</p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Devices</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every cabin and room at a glance. Watch up to {max} to see their devices live.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {canManage && (
            <Button asChild variant="outline" size="sm" className="mb-1">
              <Link href="/devices/manage">
                <Settings2 /> Manage devices
              </Link>
            </Button>
          )}
          <Link href="/jobs" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            Health checks{jobs.length ? "" : " (none yet)"} <ArrowRight className="size-3.5" aria-hidden />
          </Link>
          {site.data && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              Device list from <RelativeTime iso={site.data.fetchedAt} /> (refreshed at most every minute) <EvidenceBadge level="API" />
            </p>
          )}
        </div>
      </FadeIn>

      {site.error && <LoadError error={site.error} />}

      {site.data && (
        <>
          <Stagger className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            {kindCounts([...site.data.bridges, ...site.data.devices]).map(([kind, count]) => (
              <StaggerItem key={kind}>
                <span className="flex items-center gap-2 rounded-full border bg-card py-1 pr-3 pl-1">
                  <DeviceGlyph kind={kind} className="size-7 rounded-full [&_svg]:size-3.5" />
                  <span className="text-sm font-medium tabular-nums">{count}</span>
                  <span className="text-sm text-muted-foreground">
                    {KIND_LABEL[kind]}
                    {count === 1 ? "" : "s"}
                  </span>
                </span>
              </StaggerItem>
            ))}
          </Stagger>

          {watchedRooms.length > 0 && (
            <section aria-labelledby="watching" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="watching" className="flex items-center gap-2 font-semibold">
                  <Eye className="size-4 text-primary" aria-hidden /> Watching {watchedRooms.length} of {max}
                </h2>
                {watchedRooms.map((r) => (
                  <Link
                    key={r.id}
                    href={watchHref(r.spaceId!)}
                    scroll={false}
                    className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-0.5 text-xs font-medium hover:border-destructive/40 hover:text-destructive"
                  >
                    {r.name} <X className="size-3" aria-label={`Stop watching ${r.name}`} />
                  </Link>
                ))}
                <span className="text-xs text-muted-foreground">Live detail from igloohome; refreshes when one of these devices sends an event.</span>
              </div>
              <div className="grid gap-5 lg:grid-cols-2">
                {watchedRooms.map((room, i) => (
                  <RoomPanel key={room.id} room={room} names={namesOf(site.data!)} checks={checks} index={i} />
                ))}
              </div>
            </section>
          )}

          <section aria-labelledby="spaces" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="spaces" className="font-semibold">
                Cabins &amp; rooms{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  ({filtered.length === rows.length ? rows.length : `${filtered.length} of ${rows.length}`})
                </span>
              </h2>
            </div>
            <FilterBar
              placeholder="Search cabin, room or device"
              selects={[
                { name: "kind", label: "Kind", options: [{ value: "cabin", label: "Cabins" }, { value: "room", label: "Rooms" }] },
                {
                  name: "bridge",
                  label: "Bridge",
                  options: [
                    { value: "online", label: "Online" },
                    { value: "offline", label: "Offline" },
                    { value: "none", label: "No status yet" },
                  ],
                },
              ]}
              toggles={[{ name: "attention", label: "Needs attention" }]}
            />
            {rows.length === 0 ? (
              <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed bg-card p-5">
                <p className="font-medium">No cabins or rooms yet</p>
                <p className="text-sm text-muted-foreground">
                  iot-pms only runs jobs on devices it manages. A super-admin adds cabins and rooms and places the paired devices in them.
                </p>
                {canManage && (
                  <Button asChild size="sm">
                    <Link href="/devices/manage">
                      <PackagePlus /> Add devices
                    </Link>
                  </Button>
                )}
              </div>
            ) : shown.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nothing matches these filters.</p>
            ) : (
              <SpaceList rows={shown} watched={watched} full={watched.length >= max} watchHref={watchHref} />
            )}
            {pages > 1 && (
              <nav aria-label="Pages" className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">
                  Page {page} of {pages}
                </span>
                <span className="flex gap-2">
                  {page > 1 && (
                    <Button asChild variant="outline" size="sm">
                      <Link href={href({ page: String(page - 1) })} scroll={false}>
                        <ArrowLeft /> Previous
                      </Link>
                    </Button>
                  )}
                  {page < pages && (
                    <Button asChild variant="outline" size="sm">
                      <Link href={href({ page: String(page + 1) })} scroll={false}>
                        Next <ArrowRight />
                      </Link>
                    </Button>
                  )}
                </span>
              </nav>
            )}
          </section>

          {site.data.unmanaged.length > 0 && (
            <section aria-labelledby="unmanaged" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-dashed p-4">
              <p id="unmanaged" className="text-sm">
                <span className="font-medium">{site.data.unmanaged.length}</span> device{site.data.unmanaged.length === 1 ? "" : "s"} on the igloohome
                account {site.data.unmanaged.length === 1 ? "is" : "are"} not managed by iot-pms. No jobs run on them.
              </p>
              {canManage && (
                <Link href="/devices/manage" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  Add <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              )}
            </section>
          )}
        </>
      )}
      <DevPanel
        operations={["listDevices", "listProperties", "getDevice", "createProxiedJob", "createBridgeDiagnosticsJob"]}
        note="Rows come from Postgres (registry, webhook events, last-known state) plus the cached device list. GET /devices/{id} runs only for watched cabins and rooms."
      />
    </div>
  );
}

function kindCounts(devices: { kind: string }[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const d of devices) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1);
  return [...counts];
}

function namesOf(site: { devices: { id: string; name?: string }[]; bridges: { id: string; name?: string }[] }) {
  return Object.fromEntries([...site.bridges, ...site.devices].map((d) => [d.id, d.name ?? d.id]));
}
