"use client";

import { ChevronDown, CircleCheck, KeyRound, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { Code } from "@/components/code-hint";
import { RelativeTime } from "@/components/visuals";
import { cn } from "@/lib/utils";
import type { AccessCodeView, CodeStatus } from "@/server/application/access-codes";

// Issued algoPINs. No PIN values here (the vault has them); "used on lock" comes from webhook logs matched by
// fingerprint. Compact rows that expand, with filters for many codes: text, device, status, created date.

const STATUS: Record<CodeStatus, { label: string; tone: string }> = {
  upcoming: { label: "Upcoming", tone: "bg-info/12 text-info" },
  active: { label: "Active", tone: "bg-success/12 text-success" },
  needs_activation: { label: "Enter on lock within 24 h", tone: "bg-warning/15 text-warning" },
  activation_missed: { label: "Activation window missed", tone: "bg-destructive/12 text-destructive" },
  expired: { label: "Ended", tone: "bg-muted text-muted-foreground" },
  deleted: { label: "Deleted from lock", tone: "bg-muted text-muted-foreground" },
  previously_deleted: { label: "Refused: deleted before", tone: "bg-destructive/12 text-destructive" },
  rejected: { label: "Rejected", tone: "bg-destructive/12 text-destructive" },
  unknown: { label: "Outcome unknown", tone: "bg-warning/15 text-warning" },
};

const TZ = "Asia/Jakarta";
const PAGE = 15;
const fmt = (ms: number) => new Date(ms).toLocaleString("en-GB", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
/** YYYY-MM-DD of an instant, in the lab's time zone (for the date filter). */
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const field =
  "h-9 rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-shadow focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40";

export function AccessCodeList({ codes, names }: { codes: AccessCodeView[]; names: Record<string, { name?: string }> }) {
  const [q, setQ] = useState("");
  const [device, setDevice] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState<number | undefined>();
  const [limit, setLimit] = useState(PAGE);

  const deviceName = (ref: string) => names[ref]?.name ?? ref;
  const devices = [...new Set(codes.map((c) => c.deviceRef))];
  const statuses = (Object.keys(STATUS) as CodeStatus[]).filter((s) => codes.some((c) => c.status === s));
  const filtering = Boolean(q || device || status || from || to);
  const shown = codes.filter((c) => {
    const day = dayOf(c.createdAt);
    return (
      (!device || c.deviceRef === device) &&
      (!status || c.status === status) &&
      (!from || day >= from) &&
      (!to || day <= to) &&
      (!q || [c.accessName, deviceName(c.deviceRef), c.typeLabel, c.actor].some((x) => x.toLowerCase().includes(q.toLowerCase())))
    );
  });

  return (
    <section aria-labelledby="codes-title" className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 md:p-5">
      <h2 id="codes-title" className="font-semibold">
        Issued <span className="text-sm font-normal text-muted-foreground">({filtering ? `${shown.length} of ${codes.length}` : codes.length})</span>
      </h2>

      {codes.length > 0 && (
        <div className="flex flex-col gap-2">
          <label className="relative">
            <span className="sr-only">Search issued codes</span>
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, device, type, creator" className={cn(field, "w-full pl-8")} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <select aria-label="Device" value={device} onChange={(e) => setDevice(e.target.value)} className={field}>
              <option value="">All devices</option>
              {devices.map((ref) => (
                <option key={ref} value={ref}>
                  {deviceName(ref)}
                </option>
              ))}
            </select>
            <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={field}>
              <option value="">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {STATUS[s].label}
                </option>
              ))}
            </select>
            <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              Created from
              <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={field} />
            </label>
            <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              to
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={field} />
            </label>
          </div>
          {filtering && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                setDevice("");
                setStatus("");
                setFrom("");
                setTo("");
              }}
              className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" aria-hidden /> Clear filters
            </button>
          )}
        </div>
      )}

      {codes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
          <KeyRound className="size-7 text-primary" aria-hidden />
          No algoPINs yet.
        </div>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">Nothing matches these filters.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {shown.slice(0, limit).map((c) => {
            const s = STATUS[c.status];
            const expanded = open === c.id;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? undefined : c.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left outline-none hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{c.accessName}</span>
                      <span title={c.statusNote} className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", s.tone, c.statusNote && "cursor-help")}>
                        {s.label}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.typeLabel} · {deviceName(c.deviceRef)} · created {fmt(Date.parse(c.createdAt))}
                    </span>
                  </span>
                  <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} aria-hidden />
                </button>
                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="flex flex-col gap-1.5 bg-background/60 px-3 pb-3 text-xs">
                        {c.statusNote && <p className="text-muted-foreground">{c.statusNote}</p>}
                        <p className="text-muted-foreground">
                          Valid {fmt(c.startMs)}
                          {c.endMs !== undefined ? ` → ${fmt(c.endMs)}` : " onwards"} · variance {c.variance}
                        </p>
                        {c.status === "needs_activation" && c.activateByMs && <p className="text-warning">Enter before {fmt(c.activateByMs)}</p>}
                        {c.firstUse && (
                          <p className="flex items-center gap-1 text-success">
                            <CircleCheck className="size-3.5" aria-hidden /> Used on the device <RelativeTime iso={c.firstUse.at} /> ·{" "}
                            <Code kind="log" value={c.firstUse.logType}>
                              log type {c.firstUse.logType}
                            </Code>
                          </p>
                        )}
                        {c.deletion && (
                          <a href={`/jobs/${c.deletion.jobId}`} className="text-primary hover:underline">
                            Delete job #{c.deletion.jobId}: {c.deletion.jobStatus === 0 ? "deleted" : c.deletion.jobStatus === 3 ? "PIN not found on the device" : c.deletion.state}
                          </a>
                        )}
                        {c.error && <p className="text-destructive">{c.error}</p>}
                        <p className="font-mono text-[11px] text-muted-foreground">
                          #{c.id} · {c.deviceRef} · by {c.actor}
                          {c.fingerprint ? ` · fp ${c.fingerprint}` : ""}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      )}
      {shown.length > limit && (
        <button type="button" onClick={() => setLimit(limit + PAGE)} className="w-fit text-sm font-medium text-primary hover:underline">
          Show {Math.min(PAGE, shown.length - limit)} more
        </button>
      )}
    </section>
  );
}
