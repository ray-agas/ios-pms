"use client";

import { BedSingle, ChevronDown, DoorClosed, LoaderCircle, PackagePlus, Plus, Power, RadioTower, Search, ShieldCheck, TriangleAlert, Unplug, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

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
import { RevealId, type RevealIdAction } from "@/components/reveal-id";
import { DeviceGlyph, RelativeTime } from "@/components/visuals";
import { DEVICE_ROLES, defaultRole, type DeviceRole, type SpaceKind } from "@/lib/device-roles";
import { KIND_LABEL } from "@/lib/device-kinds";
import { cn } from "@/lib/utils";
import type { DeviceKind } from "@/server/domain/models";

// Devices → Manage (plans F7, F7b): cabins and rooms; adding a Bridge together with everything linked to it; moving,
// disabling and removing devices. Built for hundreds of devices: collapsed groups, search and filters, "show more".
// Everything here arrives as display IDs; the server resolves full IDs.

export interface SpaceItem {
  id: number;
  name: string;
  kind: SpaceKind;
  timeZone?: string;
  propertyName?: string;
  devices: number;
  bridges: number;
}
export interface ManagedItem {
  id: number;
  ref: string;
  name?: string;
  kind: DeviceKind;
  model?: string;
  spaceId?: number;
  role?: DeviceRole;
  status: "enabled" | "disabled";
  onAccount: boolean;
  addedBy: string;
  addedAt: string;
}
export interface CandidateItem {
  ref: string;
  name?: string;
  kind: DeviceKind;
  model?: string;
  linked?: number; // Bridges: linked devices reported by igloohome
}
export interface PreviewItem {
  ref: string;
  name?: string;
  kind: string;
  model?: string;
  role: DeviceRole;
  managed: boolean;
  managedIn?: string;
}
type Result = { ok: true; warning?: string } | { ok: false; reason: string };
type BundleResult = { ok: true; added: number; moved: number; warning?: string } | { ok: false; reason: string };
type Preview = { ok: true; bridge: PreviewItem; items: PreviewItem[] } | { ok: false; reason: string };

interface Props {
  spaces: SpaceItem[];
  managed: ManagedItem[];
  candidates: CandidateItem[];
  properties: { id: string; name: string; timezone?: string }[];
  events: { id: number; at: string; actor: string; action: string; target?: string; detail?: string }[];
  liveError?: string;
  createSpace: (input: { name: string; kind: SpaceKind; timeZone?: string; propertyId?: string }) => Promise<Result>;
  deleteSpace: (id: number) => Promise<Result>;
  adopt: (input: { ref: string; spaceId?: number; role?: DeviceRole }) => Promise<Result>;
  preview: (ref: string) => Promise<Preview>;
  adoptBridge: (input: { ref: string; spaceId: number; include: string[]; roles?: Record<string, DeviceRole> }) => Promise<BundleResult>;
  update: (id: number, change: { spaceId?: number | null; role?: DeviceRole; status?: "enabled" | "disabled" }) => Promise<Result>;
  remove: (id: number) => Promise<Result>;
  revealId: RevealIdAction;
}

type Message = { tone: "ok" | "warn" | "error"; text: string };

const SPACE_ICON = { cabin: BedSingle, room: DoorClosed } as const;
const ROLES = Object.entries(DEVICE_ROLES) as [DeviceRole, string][];
const ease = [0.22, 1, 0.36, 1] as const;
const field =
  "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-shadow focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-60";
const ZONES = ["Asia/Jakarta", "Australia/Sydney", "Australia/Melbourne", "Australia/Brisbane", "Australia/Adelaide", "Australia/Perth"];
const CANDIDATES_SHOWN = 12;
const GROUPS_SHOWN = 20;

const label = (d: { name?: string; kind: string }) => d.name ?? `Unnamed ${KIND_LABEL[d.kind]?.toLowerCase() ?? "device"}`;
const spaceLabel = (s: SpaceItem) => `${s.kind === "cabin" ? "Cabin" : "Room"} · ${s.name}`;

export function DeviceRegistryConsole(props: Props) {
  const { spaces, managed, candidates, events } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<Message | undefined>();
  const [removing, setRemoving] = useState<ManagedItem | undefined>();
  const [bundleFor, setBundleFor] = useState<CandidateItem | undefined>();
  const [bundlePreview, setBundlePreview] = useState<Preview | undefined>();

  const openBundle = (c: CandidateItem) => {
    setBundleFor(c);
    setBundlePreview(undefined);
    void props.preview(c.ref).then(
      (p) => setBundlePreview(p),
      () => setBundlePreview({ ok: false, reason: "Could not read the Bridge's links" }),
    );
  };

  const run: Run = (fn, success, after) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) return setMessage({ tone: "error", text: r.reason });
      setMessage(r.warning ? { tone: "warn", text: `${success(r as never)}. ${r.warning}.` } : { tone: "ok", text: success(r as never) });
      after?.();
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-5">
      <ul className="flex flex-wrap gap-2" aria-label="Summary">
        <Stat value={managed.filter((m) => m.status === "enabled").length} label="enabled" tone="bg-success/12 text-success" />
        <Stat value={managed.filter((m) => m.status === "disabled").length} label="disabled" tone="bg-muted text-muted-foreground" />
        <Stat value={candidates.length} label="ready to add" tone="bg-primary/12 text-primary" />
        <Stat value={spaces.filter((s) => s.kind === "cabin").length} label="cabins" tone="bg-accent text-accent-foreground" />
        <Stat value={spaces.filter((s) => s.kind === "room").length} label="rooms" tone="bg-accent text-accent-foreground" />
      </ul>

      <div aria-live="polite">
        <AnimatePresence>
          {message && (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={cn(
                "flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm font-medium",
                message.tone === "ok" && "border-success/40 bg-success/5 text-success",
                message.tone === "warn" && "border-warning/40 bg-warning/5 text-warning",
                message.tone === "error" && "border-destructive/30 bg-destructive/5 text-destructive",
              )}
            >
              <span className="flex items-center gap-2">
                {message.tone === "warn" && <TriangleAlert className="size-4 shrink-0" aria-hidden />}
                {message.text}
              </span>
              <button type="button" aria-label="Dismiss" onClick={() => setMessage(undefined)} className="rounded p-0.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <X className="size-4" />
              </button>
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <Candidates {...props} pending={pending} onBundle={openBundle} run={run} />
          <Managed {...props} pending={pending} run={run} onRemove={setRemoving} />
        </div>

        <aside className="flex flex-col gap-5 self-start">
          <SpacesPanel {...props} pending={pending} run={run} />
          <section aria-labelledby="registry-audit" className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
            <h2 id="registry-audit" className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="size-4 text-primary" aria-hidden /> Registry activity
            </h2>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ol className="flex flex-col divide-y text-sm">
                {events.map((e) => (
                  <li key={e.id} className="flex flex-col gap-0.5 py-2">
                    <span>
                      <span className="font-medium">{e.actor}</span> · <span className="font-mono text-xs">{e.action}</span>
                      {e.target ? <> → <span className="font-mono text-xs">{e.target}</span></> : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      <RelativeTime iso={e.at} />
                      {e.detail ? ` · ${e.detail}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>

      <BundleDialog
        key={`${bundleFor?.ref}-${bundlePreview ? "loaded" : "loading"}`} // fresh ticks and roles for each preview
        bridge={bundleFor}
        data={bundlePreview}
        spaces={spaces}
        pending={pending}
        onClose={() => setBundleFor(undefined)}
        onConfirm={(input, name) =>
          run(
            () => props.adoptBridge(input),
            (r) => `${name}: ${(r as { added: number }).added} added${(r as { moved: number }).moved ? `, ${(r as { moved: number }).moved} moved` : ""}`,
            () => setBundleFor(undefined),
          )
        }
      />

      <AlertDialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop managing {removing ? label(removing) : "this device"}?</AlertDialogTitle>
            <AlertDialogDescription>
              Nothing changes on the lock or in igloohome, and existing PINs keep working. iot-pms will refuse jobs on it until it is added again. To pause it
              instead, use Disable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                const m = removing!;
                setRemoving(undefined);
                run(() => props.remove(m.id), () => `${label(m)} is no longer managed`);
              }}
            >
              Remove
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type Run = (fn: () => Promise<Result | BundleResult>, success: (r: Extract<Result | BundleResult, { ok: true }>) => string, after?: () => void) => void;

function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <li className="flex items-center gap-2 rounded-full border bg-card py-1 pr-3 pl-1 text-sm">
      <span className={cn("flex h-7 min-w-7 items-center justify-center rounded-full px-2 font-semibold tabular-nums", tone)}>{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </li>
  );
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="relative min-w-40 flex-1 sm:max-w-64">
      <span className="sr-only">{placeholder}</span>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cn(field, "pl-8")} />
    </label>
  );
}

const matches = (q: string, ...parts: (string | undefined)[]) => !q || parts.some((p) => p?.toLowerCase().includes(q.toLowerCase()));

// --- Ready to add -------------------------------------------------------------------------------

function Candidates({ candidates, spaces, liveError, adopt, pending, run, onBundle }: Props & { pending: boolean; run: Run; onBundle: (c: CandidateItem) => void }) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  // Bridges first: adding a Bridge brings the whole cabin along.
  const sorted = useMemo(() => [...candidates].sort((a, b) => Number(b.kind === "bridge") - Number(a.kind === "bridge")), [candidates]);
  const found = sorted.filter((c) => matches(q, c.name, c.ref, c.model, KIND_LABEL[c.kind]));
  const shown = all ? found : found.slice(0, CANDIDATES_SHOWN);

  return (
    <section aria-labelledby="candidates" className="flex flex-col gap-3 rounded-2xl border bg-card p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="candidates" className="flex items-center gap-2 font-semibold">
            <PackagePlus className="size-4 text-primary" aria-hidden /> Ready to add <span className="text-sm font-normal text-muted-foreground">({candidates.length})</span>
          </h2>
          <p className="text-sm text-muted-foreground">Add a cabin&apos;s Bridge to bring everything linked to it. Pair new hardware in the igloohome app first.</p>
        </div>
        {candidates.length > CANDIDATES_SHOWN && <SearchInput value={q} onChange={setQ} placeholder="Search devices" />}
      </div>
      {liveError && <p className="text-sm text-destructive">Live device list unavailable: {liveError}</p>}
      {candidates.length === 0 && !liveError ? (
        <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">Every device on the account is managed.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {shown.map((c, i) => (
              <motion.li
                key={c.ref}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 8) * 0.04, duration: 0.35, ease } }}
                exit={{ opacity: 0, x: 24, transition: { duration: 0.2 } }}
              >
                {c.kind === "bridge" ? (
                  <BridgeCandidate candidate={c} pending={pending} onBundle={() => onBundle(c)} />
                ) : (
                  <CandidateRow
                    candidate={c}
                    spaces={spaces}
                    pending={pending}
                    onAdd={(spaceId, role) => run(() => adopt({ ref: c.ref, spaceId, role }), () => `${label(c)} is now managed`)}
                  />
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {found.length > shown.length && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setAll(true)}>
          Show {found.length - shown.length} more
        </Button>
      )}
    </section>
  );
}

function BridgeCandidate({ candidate, pending, onBundle }: { candidate: CandidateItem; pending: boolean; onBundle: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-linear-to-br from-warning/10 via-card to-card p-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <DeviceGlyph kind="bridge" />
        <div className="min-w-0">
          <p className="truncate font-medium">{label(candidate)}</p>
          <p className="truncate text-xs text-muted-foreground">
            Bridge · <span className="font-mono">{candidate.ref}</span> · {candidate.linked ?? 0} linked device{candidate.linked === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      <Button size="sm" disabled={pending} onClick={onBundle}>
        <RadioTower /> Add with linked devices
      </Button>
    </div>
  );
}

function CandidateRow({
  candidate,
  spaces,
  pending,
  onAdd,
}: {
  candidate: CandidateItem;
  spaces: SpaceItem[];
  pending: boolean;
  onAdd: (spaceId: number | undefined, role: DeviceRole) => void;
}) {
  const [spaceId, setSpaceId] = useState<string>("");
  const [role, setRole] = useState<DeviceRole>(defaultRole(candidate.kind));
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-background/60 p-3 transition-colors hover:border-primary/30 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <DeviceGlyph kind={candidate.kind} />
        <div className="min-w-0">
          <p className="truncate font-medium">{label(candidate)}</p>
          <p className="truncate text-xs text-muted-foreground">
            {KIND_LABEL[candidate.kind]} · <span className="font-mono">{candidate.ref}</span>
            {candidate.model ? ` · ${candidate.model}` : ""}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SpaceSelect spaces={spaces} value={spaceId} onChange={setSpaceId} aria-label={`Cabin or room for ${label(candidate)}`} empty="No cabin or room yet" />
        <select aria-label={`Role of ${label(candidate)}`} value={role} onChange={(e) => setRole(e.target.value as DeviceRole)} className={cn(field, "w-auto")}>
          {ROLES.map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => onAdd(spaceId ? Number(spaceId) : undefined, role)}>
          {pending ? <LoaderCircle className="animate-spin" /> : <Plus />} Add
        </Button>
      </div>
    </div>
  );
}

function SpaceSelect({
  spaces,
  value,
  onChange,
  empty,
  disabled,
  ...rest
}: { spaces: SpaceItem[]; value: string; onChange: (v: string) => void; empty: string; disabled?: boolean; "aria-label": string }) {
  return (
    <select {...rest} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cn(field, "w-auto max-w-56")}>
      <option value="">{empty}</option>
      {spaces.map((s) => (
        <option key={s.id} value={s.id}>
          {spaceLabel(s)}
        </option>
      ))}
    </select>
  );
}

// --- Add a Bridge with its linked devices ---------------------------------------------------------

function BundleDialog({
  bridge,
  data,
  spaces,
  pending,
  onClose,
  onConfirm,
}: {
  bridge?: CandidateItem;
  data?: Preview;
  spaces: SpaceItem[];
  pending: boolean;
  onClose: () => void;
  onConfirm: (input: { ref: string; spaceId: number; include: string[]; roles: Record<string, DeviceRole> }, name: string) => void;
}) {
  const [spaceId, setSpaceId] = useState("");
  // Devices already placed in another cabin or room start unticked.
  const [include, setInclude] = useState<Set<string>>(() => new Set(data?.ok ? data.items.filter((i) => !i.managed).map((i) => i.ref) : []));
  const [roles, setRoles] = useState<Record<string, DeviceRole>>(() => (data?.ok ? Object.fromEntries(data.items.map((i) => [i.ref, i.role])) : {}));

  const target = spaces.find((s) => String(s.id) === spaceId);
  const toggle = (ref: string) =>
    setInclude((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });

  return (
    <AlertDialog open={Boolean(bridge)} onOpenChange={(open) => !open && !pending && onClose()}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Add {bridge ? label(bridge) : "Bridge"} with its devices</AlertDialogTitle>
          <AlertDialogDescription>
            Links as igloohome reports them: devices on this Bridge, and what a linked keypad reports. Untick anything that belongs elsewhere.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <SpaceSelect spaces={spaces} value={spaceId} onChange={setSpaceId} disabled={!data} aria-label="Cabin or room" empty="Choose a cabin or room…" />
        {spaces.length === 0 && <p className="text-sm text-muted-foreground">Create a cabin or room first (right-hand panel).</p>}
        {target && target.bridges > 0 && (
          <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-2 text-sm text-warning">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {target.name} already has {target.bridges} Bridge{target.bridges === 1 ? "" : "s"}. You can continue; it will then have {target.bridges + 1}.
          </p>
        )}

        {!data ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden /> Reading links from igloohome…
          </p>
        ) : !data.ok ? (
          <p className="text-sm text-destructive">{data.reason}</p>
        ) : data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">igloohome reports no linked devices for this Bridge; only the Bridge will be added.</p>
        ) : (
          <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            {data.items.map((i) => (
              <li key={i.ref} className="flex items-center gap-3 rounded-lg border p-2">
                <input type="checkbox" checked={include.has(i.ref)} onChange={() => toggle(i.ref)} aria-label={`Include ${label(i)}`} className="size-4 accent-primary" />
                <DeviceGlyph kind={i.kind} className="size-8 [&_svg]:size-4" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{label(i)}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    <span className="font-mono">{i.ref}</span>
                    {i.managed && <span className="text-warning"> · in {i.managedIn ?? "no cabin"}, moves here</span>}
                  </span>
                </span>
                <select
                  aria-label={`Role of ${label(i)}`}
                  value={roles[i.ref] ?? i.role}
                  onChange={(e) => setRoles({ ...roles, [i.ref]: e.target.value as DeviceRole })}
                  className={cn(field, "h-8 w-auto")}
                >
                  {ROLES.map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            disabled={pending || !target || !data?.ok}
            onClick={() => bridge && target && onConfirm({ ref: bridge.ref, spaceId: target.id, include: [...include], roles }, target.name)}
          >
            {pending && <LoaderCircle className="animate-spin" />} Add Bridge{data?.ok ? ` + ${include.size}` : ""}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// --- Managed devices ---------------------------------------------------------------------------

function Managed({ managed, spaces, update, revealId, pending, run, onRemove }: Props & { pending: boolean; run: Run; onRemove: (m: ManagedItem) => void }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);

  const filtering = Boolean(q || status || kind);
  const groups = [
    ...spaces.map((s) => ({ key: `s${s.id}`, space: s as SpaceItem | undefined })),
    { key: "none", space: undefined as SpaceItem | undefined },
  ]
    .map((g) => {
      const members = managed.filter((m) => m.spaceId === g.space?.id);
      const items = members.filter(
        (m) =>
          (!status || m.status === status || (status === "missing" && !m.onAccount)) &&
          (!kind || m.kind === kind) &&
          matches(q, m.name, m.ref, m.model, g.space?.name),
      );
      return { ...g, members, items };
    })
    .filter((g) => g.items.length > 0);
  const shown = all ? groups : groups.slice(0, GROUPS_SHOWN);
  const kinds = [...new Set(managed.map((m) => m.kind))];

  return (
    <section aria-labelledby="managed" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="managed" className="font-semibold">
          Managed devices <span className="text-sm font-normal text-muted-foreground">({managed.length})</span>
        </h2>
        {managed.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={q} onChange={setQ} placeholder="Search managed" />
            <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={cn(field, "w-auto")}>
              <option value="">Status: all</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
              <option value="missing">Not on the account</option>
            </select>
            <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} className={cn(field, "w-auto")}>
              <option value="">Kind: all</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k] ?? k}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {managed.length === 0 && <p className="text-sm text-muted-foreground">None yet. Add devices above; only managed, enabled devices can receive jobs.</p>}
      {managed.length > 0 && groups.length === 0 && <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">Nothing matches these filters.</p>}

      <ul className="flex flex-col gap-2">
        {shown.map((g) => {
          const Icon = g.space ? SPACE_ICON[g.space.kind] : Unplug;
          const expanded = filtering || open.has(g.key);
          const bridges = g.members.filter((m) => m.kind === "bridge");
          const disabled = g.members.filter((m) => m.status === "disabled").length;
          return (
            <li key={g.key} className="overflow-hidden rounded-xl border bg-card">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(g.key)) next.delete(g.key);
                    else next.add(g.key);
                    return next;
                  })
                }
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{g.space ? g.space.name : "No cabin or room yet"}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {bridges.length ? bridges.map((b) => label(b)).join(", ") : "No Bridge"} · {g.members.length} device{g.members.length === 1 ? "" : "s"}
                    {disabled ? ` · ${disabled} disabled` : ""}
                  </span>
                </span>
                {bridges.length > 1 && (
                  <span className="hidden items-center gap-1 rounded-full bg-warning/12 px-2 py-0.5 text-[11px] font-medium text-warning sm:inline-flex">
                    <TriangleAlert className="size-3" aria-hidden /> {bridges.length} Bridges
                  </span>
                )}
                <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} aria-hidden />
              </button>
              <AnimatePresence initial={false}>
                {expanded && (
                  <motion.ul
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease }}
                    className="flex flex-col divide-y border-t"
                  >
                    {g.items.map((m) => (
                      <ManagedRow key={m.id} m={m} spaces={spaces} pending={pending} run={run} update={update} onRemove={onRemove} revealId={revealId} />
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>
      {groups.length > shown.length && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setAll(true)}>
          Show {groups.length - shown.length} more
        </Button>
      )}
    </section>
  );
}

function ManagedRow({
  m,
  spaces,
  pending,
  run,
  update,
  onRemove,
  revealId,
}: {
  m: ManagedItem;
  spaces: SpaceItem[];
  pending: boolean;
  run: Run;
  update: Props["update"];
  onRemove: (m: ManagedItem) => void;
  revealId: RevealIdAction;
}) {
  return (
    <li className={cn("flex flex-col gap-2.5 px-3 py-2.5 2xl:flex-row 2xl:items-center", m.status === "disabled" && "bg-muted/40")}>
      <div className={cn("flex min-w-0 flex-1 items-center gap-3", m.status === "disabled" && "opacity-60")}>
        <DeviceGlyph kind={m.kind} className="size-8 [&_svg]:size-4" />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {label(m)}
            {m.status === "disabled" && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Disabled</span>}
            {!m.onAccount && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] text-warning">Not on the account</span>}
          </p>
          <p className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
            <span className="font-mono">{m.ref}</span>
            {m.onAccount && <RevealId deviceRef={m.ref} reveal={revealId} />}
            <span className="truncate">
              {m.model ? `${m.model} · ` : ""}added by {m.addedBy} <RelativeTime iso={m.addedAt} />
            </span>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SpaceSelect
          spaces={spaces}
          value={m.spaceId ? String(m.spaceId) : ""}
          disabled={pending}
          aria-label={`Cabin or room of ${label(m)}`}
          empty="No cabin or room"
          onChange={(v) => run(() => update(m.id, { spaceId: v ? Number(v) : null }), () => `${label(m)} moved`)}
        />
        <select
          aria-label={`Role of ${label(m)}`}
          value={m.role ?? ""}
          disabled={pending}
          onChange={(e) => run(() => update(m.id, { role: e.target.value as DeviceRole }), () => `${label(m)} is now a ${DEVICE_ROLES[e.target.value as DeviceRole].toLowerCase()}`)}
          className={cn(field, "w-auto")}
        >
          {!m.role && <option value="">Role…</option>}
          {ROLES.map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(
              () => update(m.id, { status: m.status === "enabled" ? "disabled" : "enabled" }),
              () => `${label(m)} ${m.status === "enabled" ? "disabled: guards refuse it now" : "enabled"}`,
            )
          }
        >
          <Power /> {m.status === "enabled" ? "Disable" : "Enable"}
        </Button>
        <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={pending} onClick={() => onRemove(m)}>
          <X /> Remove
        </Button>
      </div>
    </li>
  );
}

// --- Cabins & rooms ------------------------------------------------------------------------------

function SpacesPanel({ spaces, properties, createSpace, deleteSpace, pending, run }: Props & { pending: boolean; run: Run }) {
  const [draft, setDraft] = useState({ name: "", kind: "cabin" as SpaceKind, timeZone: "", propertyId: "" });
  const [q, setQ] = useState("");
  const property = properties.find((p) => p.id === draft.propertyId);
  const listed = spaces.filter((s) => matches(q, s.name, s.propertyName));
  return (
    <section aria-labelledby="spaces" className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 id="spaces" className="font-semibold">
        Cabins &amp; rooms <span className="text-sm font-normal text-muted-foreground">({spaces.length})</span>
      </h2>
      <form
        className="flex flex-col gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          const name = draft.name.trim();
          run(() => createSpace({ ...draft, name }), () => `${draft.kind === "cabin" ? "Cabin" : "Room"} ${name} added`);
          setDraft({ name: "", kind: draft.kind, timeZone: "", propertyId: "" });
        }}
      >
        <div role="radiogroup" aria-label="Kind" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          {(["cabin", "room"] as const).map((kind) => {
            const Icon = SPACE_ICON[kind];
            const active = draft.kind === kind;
            return (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setDraft({ ...draft, kind })}
                className={cn(
                  "relative flex h-8 items-center justify-center gap-1.5 rounded-md text-sm font-medium capitalize outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {active && <motion.span layoutId="space-kind" className="absolute inset-0 rounded-md bg-background shadow-sm" transition={{ duration: 0.25, ease }} />}
                <Icon className="relative size-4" aria-hidden />
                <span className="relative">{kind}</span>
              </button>
            );
          })}
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Name
          <input required maxLength={60} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={draft.kind === "cabin" ? "e.g. Cabin A-01" : "e.g. Room 101"} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          igloohome property (optional)
          <select value={draft.propertyId} onChange={(e) => setDraft({ ...draft, propertyId: e.target.value })} className={field}>
            <option value="">None</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Time zone (optional)
          <input list="zones" value={draft.timeZone} onChange={(e) => setDraft({ ...draft, timeZone: e.target.value })} placeholder={property?.timezone ?? "Uses the property's zone"} className={field} />
          <datalist id="zones">
            {ZONES.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </label>
        <Button type="submit" size="sm" disabled={pending || !draft.name.trim()}>
          <Plus /> Add {draft.kind}
        </Button>
      </form>

      {spaces.length > 8 && <SearchInput value={q} onChange={setQ} placeholder="Search cabins and rooms" />}
      {spaces.length > 0 && (
        <ul className="flex max-h-96 flex-col divide-y overflow-y-auto border-t pt-1 text-sm">
          {listed.map((s) => {
            const Icon = SPACE_ICON[s.kind];
            return (
              <li key={s.id} className="flex items-center gap-2 py-2">
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {s.devices} device{s.devices === 1 ? "" : "s"}
                    {s.bridges > 1 ? ` · ${s.bridges} Bridges` : ""}
                    {s.propertyName ? ` · ${s.propertyName}` : ""}
                    {s.timeZone ? ` · ${s.timeZone}` : ""}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${s.name}`}
                  title={s.devices ? "Move or remove its devices first" : `Delete ${s.name}`}
                  disabled={pending || s.devices > 0}
                  onClick={() => run(() => deleteSpace(s.id), () => `${s.name} deleted`)}
                >
                  <X />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
