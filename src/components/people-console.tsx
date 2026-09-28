"use client";

import { Check, Copy, KeyRound, KeySquare, LoaderCircle, ShieldCheck, UserPlus, UserRoundX, UserRoundCheck } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { ScopeEditor } from "@/components/user-scopes";
import { RelativeTime } from "@/components/visuals";
import { cn } from "@/lib/utils";
import { ROLE_LABEL, type Role } from "@/server/domain/models";
import type { AccountResult, User } from "@/server/users";

// People (plan F2): super-admin creates accounts, changes roles, disables, resets passwords.

const ROLES: Role[] = ["operator", "viewer", "super_admin"];
const ROLE_TONE: Record<Role, string> = {
  super_admin: "bg-destructive/12 text-destructive",
  operator: "bg-primary/12 text-primary",
  viewer: "bg-muted text-muted-foreground",
};
const input =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-shadow focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40";

interface Props {
  users: User[];
  events: { id: number; at: string; actor: string; action: string; target?: string; detail?: string }[];
  selfId?: number;
  create: (input: { username: string; displayName: string; role: Role; email?: string }) => Promise<AccountResult>;
  update: (id: number, change: { role?: Role; status?: "active" | "disabled" }) => Promise<AccountResult>;
  reset: (id: number) => Promise<AccountResult>;
  /** Plan F3: assigned scopes per user id, the ceiling, and the save action. */
  scopes: Record<number, string[]>;
  ceiling: string[];
  saveScopes: (id: number, scopes: string[]) => Promise<{ ok: true; scopes: string[] } | { ok: false; reason: string }>;
  aside?: React.ReactNode;
}

export function PeopleConsole({ users, events, selfId, create, update, reset, scopes, ceiling, saveScopes, aside }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string; password?: string; username?: string } | undefined>();
  const [draft, setDraft] = useState({ username: "", displayName: "", role: "operator" as Role, email: "" });
  const [editing, setEditing] = useState<number | undefined>();

  const run = (fn: () => Promise<AccountResult>, success: (r: Extract<AccountResult, { ok: true }>) => string) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        setMessage({ tone: "ok", text: success(r), password: r.temporaryPassword, username: r.user.username });
        router.refresh();
      } else setMessage({ tone: "error", text: r.reason });
    });

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-5">
        {/* Create */}
        <form
          className="flex flex-col gap-4 rounded-2xl border bg-card p-4 md:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => create(draft), (r) => `Account ${r.user.username} created`);
            setDraft({ username: "", displayName: "", role: "operator", email: "" });
          }}
        >
          <h2 className="flex items-center gap-2 font-semibold">
            <UserPlus className="size-4 text-primary" aria-hidden /> New account
          </h2>
          <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Username
              <input required value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} autoComplete="off" className={input} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Display name
              <input value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} className={input} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Role
              <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })} className={input}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              <span>
                E-mail <span className="font-normal text-muted-foreground">(optional)</span>
              </span>
              <input
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                placeholder="for Google sign-in"
                className={input}
              />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending || !draft.username.trim()}>
              {pending ? <LoaderCircle className="animate-spin" /> : <UserPlus />} Create account
            </Button>
            <p className="text-xs text-muted-foreground">A temporary password is generated and shown once.</p>
          </div>
        </form>

        {/* Result */}
        <div aria-live="polite">
          <AnimatePresence>
            {message && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={cn("flex flex-col gap-2 rounded-2xl border p-4", message.tone === "ok" ? "border-success/40 bg-success/5" : "border-destructive/30 bg-destructive/5")}
              >
                <p className={cn("text-sm font-medium", message.tone === "ok" ? "text-success" : "text-destructive")}>{message.text}</p>
                {message.password && <TemporaryPassword username={message.username!} password={message.password} />}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Accounts */}
        <section aria-labelledby="accounts" className="flex flex-col gap-2">
          <h2 id="accounts" className="font-semibold">
            Accounts <span className="text-sm font-normal text-muted-foreground">({users.length})</span>
          </h2>
          <ul className="flex flex-col gap-2">
            {users.map((u) => {
              const self = u.id === selfId;
              return (
                <li key={u.id} className={cn("flex flex-col gap-3 rounded-xl border bg-card p-3", u.status === "disabled" && "opacity-60")}>
                  <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
                      {u.displayName.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {u.displayName}
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", ROLE_TONE[u.role])}>{ROLE_LABEL[u.role]}</span>
                        {u.status === "disabled" && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Disabled</span>}
                        {u.mustChangePassword && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] text-warning">Temporary password</span>}
                        {self && <span className="text-xs text-muted-foreground">(you)</span>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        @{u.username}
                        {u.email ? ` · ${u.email}` : ""} · last sign-in {u.lastLoginAt ? <RelativeTime iso={u.lastLoginAt} /> : "never"} · by {u.createdBy ?? "—"}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label={`Role of ${u.username}`}
                      value={u.role}
                      disabled={self || pending}
                      onChange={(e) => run(() => update(u.id, { role: e.target.value as Role }), (r) => `${r.user.username} is now ${ROLE_LABEL[r.user.role]}`)}
                      className={cn(input, "h-8 w-auto")}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                    {u.role === "super_admin" ? (
                      <span className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground" title="A super-admin always has every scope igloohome grants us">
                        <KeySquare className="size-3.5" aria-hidden /> All {ceiling.length} scopes
                      </span>
                    ) : (
                      <Button variant={editing === u.id ? "secondary" : "outline"} size="sm" aria-expanded={editing === u.id} onClick={() => setEditing(editing === u.id ? undefined : u.id)}>
                        <KeySquare /> Scopes · {scopes[u.id]?.length ?? 0}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={self || pending}
                      onClick={() => run(() => reset(u.id), (r) => `New temporary password for ${r.user.username}`)}
                    >
                      <KeyRound /> Reset password
                    </Button>
                    <Button
                      variant={u.status === "active" ? "destructive" : "outline"}
                      size="sm"
                      disabled={self || pending}
                      onClick={() =>
                        run(
                          () => update(u.id, { status: u.status === "active" ? "disabled" : "active" }),
                          (r) => `${r.user.username} ${r.user.status === "active" ? "enabled" : "disabled"}`,
                        )
                      }
                    >
                      {u.status === "active" ? <UserRoundX /> : <UserRoundCheck />} {u.status === "active" ? "Disable" : "Enable"}
                    </Button>
                  </div>
                  </div>
                  <AnimatePresence initial={false}>
                    {editing === u.id && u.role !== "super_admin" && (
                      <ScopeEditor
                        key={u.id}
                        userId={u.id}
                        username={u.username}
                        assigned={scopes[u.id] ?? []}
                        ceiling={ceiling}
                        save={saveScopes}
                        onDone={(m) => setMessage(m)}
                      />
                    )}
                  </AnimatePresence>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div className="flex flex-col gap-5 self-start">
      {aside}
      <AuditPanel events={events} />
      </div>
    </div>
  );
}

// --- Recent account activity (filterable; built for long histories) --------------------------------------------

type AuditEvent = Props["events"][number];
const AUDIT_GROUPS: { id: string; label: string; test: (action: string) => boolean }[] = [
  { id: "sign_in", label: "Sign-ins", test: (a) => a.startsWith("sign_in") },
  { id: "accounts", label: "Accounts", test: (a) => a.startsWith("user.") && a !== "user.scopes" },
  { id: "scopes", label: "Scopes", test: (a) => a.startsWith("scopes.") || a === "user.scopes" },
  { id: "pins", label: "PINs", test: (a) => a.startsWith("pin.") },
  { id: "devices", label: "Devices and jobs", test: (a) => /^(device|space|registry)\./.test(a) },
];
const AUDIT_PAGE = 10;
const auditDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

function AuditPanel({ events }: { events: AuditEvent[] }) {
  const [person, setPerson] = useState("");
  const [group, setGroup] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(AUDIT_PAGE);
  // A person appears as the one who acted, or as the account something was done to.
  const people = [...new Set(events.flatMap((e) => [e.actor, ...(e.target && !e.target.includes("•") && !e.target.startsWith("vault") ? [e.target] : [])]))].sort();
  const test = AUDIT_GROUPS.find((g) => g.id === group)?.test;
  const shown = events.filter((e) => {
    const day = auditDay(e.at);
    return (!person || e.actor === person || e.target === person) && (!test || test(e.action)) && (!from || day >= from) && (!to || day <= to);
  });
  const filtering = Boolean(person || group || from || to);
  const field = cn(input, "h-9");

  return (
    <section aria-labelledby="audit" className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
      <h2 id="audit" className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="size-4 text-primary" aria-hidden /> Recent account activity{" "}
        <span className="text-sm font-normal text-muted-foreground">({filtering ? `${shown.length} of ${events.length}` : events.length})</span>
      </h2>
      {events.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <select aria-label="Person" value={person} onChange={(e) => setPerson(e.target.value)} className={field}>
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select aria-label="Type" value={group} onChange={(e) => setGroup(e.target.value)} className={field}>
            <option value="">All types</option>
            {AUDIT_GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
          <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            From
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={field} />
          </label>
          <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            to
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={field} />
          </label>
        </div>
      )}
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing matches these filters.</p>
      ) : (
        <ol className="flex flex-col divide-y text-sm">
          {shown.slice(0, limit).map((e) => (
            <li key={e.id} className="flex flex-col gap-0.5 py-1.5">
              <span className="truncate">
                <span className="font-medium">{e.actor}</span> · <span className="font-mono text-xs">{e.action}</span>
                {e.target && e.target !== e.actor ? <> → {e.target}</> : null}
              </span>
              <span className="truncate text-xs text-muted-foreground" title={e.detail}>
                <RelativeTime iso={e.at} />
                {e.detail ? ` · ${e.detail}` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
      {shown.length > limit && (
        <button type="button" onClick={() => setLimit(limit + AUDIT_PAGE * 2)} className="w-fit text-sm font-medium text-primary hover:underline">
          Show {Math.min(AUDIT_PAGE * 2, shown.length - limit)} more
        </button>
      )}
    </section>
  );
}

function TemporaryPassword({ username, password }: { username: string; password: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm">
        Temporary password for <span className="font-medium">{username}</span>:
      </span>
      <code className="rounded-lg bg-background px-2 py-1 font-mono text-sm tracking-wider ring-1 ring-border">{password}</code>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Copy temporary password"
        onClick={async () => {
          await navigator.clipboard.writeText(password);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
      <span className="w-full text-xs text-muted-foreground">Shown once. Give it to the person privately; they must change it at first sign-in.</span>
    </div>
  );
}
