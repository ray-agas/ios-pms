import { BedSingle, DoorClosed, Eye, EyeOff, House, TriangleAlert, Unplug } from "lucide-react";
import Link from "next/link";

import { Stagger, StaggerItem } from "@/components/motion";
import { LiveDot, RelativeTime } from "@/components/visuals";
import type { SpaceSummary } from "@/lib/space-summary";
import { cn } from "@/lib/utils";

// Compact cabin/room rows (plan F7b). Server-rendered; the watch toggle is a plain link that edits `?watch=`.

const ICON = { cabin: BedSingle, room: DoorClosed } as const;
const TONE: Record<string, string> = {
  access: "bg-success",
  denied: "bg-warning",
  alert: "bg-destructive",
  config: "bg-info",
  job: "bg-primary",
  online: "bg-success",
  offline: "bg-destructive",
};

export function SpaceList({
  rows,
  watched,
  full,
  watchHref,
}: {
  rows: SpaceSummary[];
  watched: number[];
  full: boolean;
  watchHref: (spaceId: number) => string;
}) {
  return (
    <Stagger className="flex flex-col gap-2">
      {rows.map((r) => {
        const Icon = r.kind ? ICON[r.kind] : r.id === "no-space" ? Unplug : House;
        const on = r.spaceId !== undefined && watched.includes(r.spaceId);
        return (
          <StaggerItem key={r.id}>
            <div
              className={cn(
                "grid items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-3 py-2.5 transition-colors md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,1.5fr)_auto]",
                on ? "border-primary/50 bg-primary/5" : "hover:border-primary/30",
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    <span className="truncate">{r.name}</span>
                    {r.kind && <span className="shrink-0 rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold text-accent-foreground capitalize">{r.kind}</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.devices} device{r.devices === 1 ? "" : "s"}
                    {r.disabled ? ` · ${r.disabled} disabled` : ""}
                    {r.subtitle ? ` · ${r.subtitle}` : ""}
                  </p>
                </div>
              </div>

              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                {r.bridges.length === 0 ? (
                  <span className="text-xs text-muted-foreground">No Bridge</span>
                ) : (
                  r.bridges.map((b) => (
                    <span key={b.id} className="inline-flex min-w-0 items-center gap-1.5">
                      <LiveDot online={b.online} label={b.name ?? "Bridge"} />
                      {b.since && (
                        <span className="text-xs text-muted-foreground">
                          <RelativeTime iso={b.since} timeZone={r.timezone} />
                        </span>
                      )}
                    </span>
                  ))
                )}
              </div>

              <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                {r.lastEvent ? (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TONE[r.lastEvent.tone] ?? "bg-muted-foreground")} />
                    <span className="truncate">
                      {r.lastEvent.label} <span className="text-muted-foreground">· {r.lastEvent.device}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      <RelativeTime iso={r.lastEvent.occurredAt} timeZone={r.timezone} />
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">No recent events</span>
                )}
                {r.attention.map((a) => (
                  <span key={a} className="inline-flex items-center gap-1 rounded-full bg-warning/12 px-2 py-0.5 text-[11px] font-medium text-warning">
                    <TriangleAlert className="size-3" aria-hidden /> {a}
                  </span>
                ))}
              </div>

              <div className="flex justify-end">
                {r.spaceId === undefined ? (
                  <Link href="/devices/manage" className="text-xs font-medium text-primary hover:underline">
                    Place in a cabin
                  </Link>
                ) : on || !full ? (
                  <Link
                    href={watchHref(r.spaceId)}
                    scroll={false}
                    aria-pressed={on}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40",
                      on ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90" : "bg-background hover:border-primary/40 hover:text-primary",
                    )}
                  >
                    {on ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />} {on ? "Stop" : "Watch"}
                  </Link>
                ) : (
                  <span title="Watch limit reached: stop one first" className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-lg border px-3 text-sm text-muted-foreground opacity-60">
                    <Eye className="size-3.5" aria-hidden /> Watch
                  </span>
                )}
              </div>
            </div>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}
