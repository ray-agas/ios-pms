"use client";

import { Check, Copy, Eye, EyeOff, LoaderCircle, LockKeyhole, Search, ShieldCheck, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

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
import { RelativeTime } from "@/components/visuals";
import { cn } from "@/lib/utils";
import type { VaultEntry, VaultStatus } from "@/server/application/pin-vault";

// PIN vault (plan F4). Super-admin: reveal (hidden again after 30 s) and one-click revoke. Everyone else sees the
// list with masked PINs. Reveals and revokes are audited on the server.

const STATUS: Record<VaultStatus, { label: string; tone: string }> = {
  pending: { label: "Waiting for the lock", tone: "bg-info/12 text-info" },
  active: { label: "Active", tone: "bg-success/12 text-success" },
  upcoming: { label: "Upcoming", tone: "bg-primary/12 text-primary" },
  needs_activation: { label: "Needs first use", tone: "bg-warning/12 text-warning" },
  used: { label: "Used", tone: "bg-muted text-muted-foreground" },
  previously_deleted: { label: "Refused: deleted before", tone: "bg-destructive/12 text-destructive" },
  expired: { label: "Expired", tone: "bg-muted text-muted-foreground" },
  failed: { label: "Not created", tone: "bg-destructive/12 text-destructive" },
  revoking: { label: "Revoking…", tone: "bg-warning/12 text-warning" },
  revoked: { label: "Revoked", tone: "bg-muted text-muted-foreground" },
  revoke_failed: { label: "Revoke failed", tone: "bg-destructive/12 text-destructive" },
  unknown: { label: "Unknown", tone: "bg-muted text-muted-foreground" },
};
const REVEAL_MS = 30_000;
const LIVE: VaultStatus[] = ["pending", "active", "upcoming", "needs_activation", "unknown", "revoke_failed"];
// While something waits for the lock, statuses are re-read every few seconds (a light call, not a page reload).
const WAITING: VaultStatus[] = ["pending", "revoking"];
const POLL_MS = 4000;
const POLL_FOR_MS = 3 * 60_000;

type Reveal = (id: number) => Promise<{ ok: true; pin: string } | { ok: false; reason: string }>;
type Revoke = (id: number, confirm: { reason: string; password: string }) => Promise<{ ok: true; id: number } | { ok: false; reason: string }>;
type Poll = () => Promise<VaultEntry[]>;

export function PinVaultList({
  entries: initial,
  names,
  superAdmin,
  enabled,
  reveal,
  revoke,
  poll,
}: {
  entries: VaultEntry[];
  names: Record<string, { name?: string }>;
  superAdmin: boolean;
  enabled: boolean;
  reveal: Reveal;
  revoke: Revoke;
  poll: Poll;
}) {
  const [entries, setEntries] = useState(initial);
  const [pollSince, setPollSince] = useState<number | undefined>();
  const waiting = entries.some((e) => WAITING.includes(e.status));

  // New server data (e.g. after router.refresh) replaces the local copy.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setEntries(initial);
  }

  useEffect(() => {
    if (!waiting) return;
    const started = pollSince ?? Date.now();
    if (Date.now() - started > POLL_FOR_MS) return;
    const t = setTimeout(async () => {
      try {
        setEntries(await poll());
      } catch {
        // offline for a moment: the next tick tries again
      }
      setPollSince(started);
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [entries, waiting, poll, pollSince]);
  const [q, setQ] = useState("");
  // Filters (built for many PINs): status chip ("live" = still valid), device, text.
  const [statusFilter, setStatusFilter] = useState<"" | "live" | VaultStatus>("");
  const [device, setDevice] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string; jobId?: number } | undefined>();
  const [confirm, setConfirm] = useState<VaultEntry | undefined>();
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const router = useRouter();

  const name = (e: VaultEntry) => names[e.deviceRef]?.name ?? e.deviceRef;
  const counts = entries.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.status]: (acc[e.status] ?? 0) + 1 }), {});
  const liveCount = entries.filter((e) => LIVE.includes(e.status)).length;
  const deviceRefs = [...new Set(entries.map((e) => e.deviceRef))];
  const shown = entries.filter(
    (e) =>
      (!statusFilter || (statusFilter === "live" ? LIVE.includes(e.status) : e.status === statusFilter)) &&
      (!device || e.deviceRef === device) &&
      (!q || [e.accessName, name(e), e.deviceRef, e.createdBy, e.typeLabel].some((x) => x?.toLowerCase().includes(q.toLowerCase()))),
  );

  if (!enabled) {
    return <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">The PIN vault is off: set IOT_PMS_PIN_KEY and restart.</p>;
  }

  return (
    <section aria-labelledby="vault" className="flex flex-col gap-3 rounded-2xl border bg-card p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="vault" className="flex items-center gap-2 font-semibold">
            <LockKeyhole className="size-4 text-primary" aria-hidden /> PIN vault <span className="text-sm font-normal text-muted-foreground">({entries.length})</span>
          </h2>
          <p className="text-sm text-muted-foreground">
            {superAdmin
              ? "Every PIN iot-pms created since the vault started, encrypted. Revealing or revoking one is recorded."
              : "PINs are stored encrypted. Only a super-admin can reveal or revoke them."}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <label className="relative min-w-0 flex-1 sm:flex-none">
            <span className="sr-only">Search the vault</span>
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name, lock, creator"
              className="h-9 w-full rounded-lg border border-input bg-background pr-2.5 pl-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 sm:w-52"
            />
          </label>
          <select
            aria-label="Device"
            value={device}
            onChange={(e) => setDevice(e.target.value)}
            className="h-9 max-w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <option value="">All devices</option>
            {deviceRefs.map((ref) => (
              <option key={ref} value={ref}>
                {names[ref]?.name ?? ref}
              </option>
            ))}
          </select>
        </div>
      </div>

      {entries.length > 0 && (
        <div role="group" aria-label="Status" className="-mt-1 flex flex-wrap gap-1.5">
          {([["", "All", entries.length], ["live", "Still valid", liveCount]] as const).map(([value, text, n]) => (
            <StatusChip key={value || "all"} on={statusFilter === value} onClick={() => setStatusFilter(value)} label={text} count={n} />
          ))}
          {(Object.keys(STATUS) as VaultStatus[])
            .filter((st) => counts[st])
            .map((st) => (
              <StatusChip key={st} on={statusFilter === st} onClick={() => setStatusFilter(statusFilter === st ? "" : st)} label={STATUS[st].label} count={counts[st]} tone={STATUS[st].tone} />
            ))}
        </div>
      )}

      <div aria-live="polite">
        <AnimatePresence>
          {message && (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={cn("rounded-lg px-3 py-2 text-sm", message.tone === "ok" ? "bg-success/8 text-success" : "bg-destructive/8 text-destructive")}
            >
              {message.text}{" "}
              {message.jobId && (
                <Link href={`/jobs/${message.jobId}`} className="font-medium underline">
                  Follow job #{message.jobId}
                </Link>
              )}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">{entries.length ? "Nothing matches." : "No PINs stored yet. New algoPINs and custom PINs land here."}</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {shown.map((e) => (
            <li key={e.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {e.accessName || "Unnamed"}
                  <span
                    title={e.statusNote}
                    tabIndex={e.statusNote ? 0 : undefined}
                    className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS[e.status].tone, e.statusNote && "cursor-help")}
                  >
                    {WAITING.includes(e.status) && <LoaderCircle className="size-3 animate-spin" aria-hidden />}
                    {STATUS[e.status].label}
                  </span>
                  {e.statusNote && <span className="sr-only">{e.statusNote}</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {e.typeLabel} · {name(e)} · by {e.createdBy} <RelativeTime iso={e.createdAt} />
                  {e.revokedBy ? ` · revoke by ${e.revokedBy}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {superAdmin ? <RevealedPin id={e.id} reveal={reveal} /> : <span className="font-mono text-sm tracking-widest text-muted-foreground">••••••</span>}
                {superAdmin && !e.revokeJobId && e.status !== "failed" && (
                  <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={pending} onClick={() => {
                      setConfirm(e);
                      setReason("");
                      setPassword("");
                      setDialogError(undefined);
                    }}
                  >
                    <Trash2 /> Revoke
                  </Button>
                )}
                {e.revokeJobId && (
                  <Link href={`/jobs/${e.revokeJobId}`} className="text-xs font-medium text-primary hover:underline">
                    Job #{e.revokeJobId}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={Boolean(confirm)} onOpenChange={(open) => !open && !pending && setConfirm(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke “{confirm?.accessName || "Unnamed"}” on {confirm ? name(confirm) : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              iot-pms sends Delete PIN (job 5) through the Bridge. Once the device confirms, this PIN stops working. It cannot be undone, and it is sent
              once, never retried.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Reason
            <input
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              minLength={10}
              maxLength={200}
              placeholder="e.g. guest checked out early"
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Your password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
            />
          </label>
          {dialogError && <p className="text-sm text-destructive">{dialogError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={pending || reason.trim().length < 10 || !password}
              onClick={() =>
                start(async () => {
                  const target = confirm!;
                  const r = await revoke(target.id, { reason, password });
                  setPassword("");
                  if (!r.ok) {
                    setDialogError(r.reason); // keep the dialog open so the person sees what to fix
                    return;
                  }
                  setConfirm(undefined);
                  setMessage({ tone: "ok", text: `Delete sent for “${target.accessName || "Unnamed"}”.`, jobId: r.id });
                  if (r.ok) {
                    setPollSince(undefined);
                    router.refresh();
                  }
                })
              }
            >
              {pending && <LoaderCircle className="animate-spin" />} Revoke PIN
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {superAdmin && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" aria-hidden /> PINs created before the vault were never stored and cannot be shown here.
        </p>
      )}
    </section>
  );
}

function StatusChip({ on, onClick, label, count, tone }: { on: boolean; onClick: () => void; label: string; count: number; tone?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40",
        on ? "border-primary/60 ring-1 ring-primary/30" : "border-transparent",
        tone ?? "bg-muted text-foreground",
      )}
    >
      {label} <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function RevealedPin({ id, reveal }: { id: number; reveal: Reveal }) {
  const [pin, setPin] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!pin) return;
    const t = setTimeout(() => setPin(undefined), REVEAL_MS); // do not leave PINs on screen
    return () => clearTimeout(t);
  }, [pin]);

  if (error) return <span className="text-xs text-destructive">{error}</span>;
  if (!pin) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await reveal(id);
            if (r.ok) setPin(r.pin);
            else setError(r.reason);
          })
        }
      >
        {pending ? <LoaderCircle className="animate-spin" /> : <Eye />} Reveal
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <code className="rounded-lg bg-background px-2 py-1 font-mono text-sm tracking-widest ring-1 ring-border">{pin}</code>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Copy PIN"
        onClick={async () => {
          await navigator.clipboard.writeText(pin);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Hide PIN" onClick={() => setPin(undefined)}>
        <EyeOff />
      </Button>
    </span>
  );
}
