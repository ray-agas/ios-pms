"use client";

import { Check, KeySquare, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/visuals";
import { GROUP_LABEL, READ_SCOPES, SCOPES, shortScope, type ScopeGroup } from "@/lib/scopes";
import { cn } from "@/lib/utils";

// Plan F3: the ceiling (what igloohome grants our client) and per-user scope assignment on the People screen.

type Sync = { ok: true; count: number; added: string[]; removed: string[] } | { ok: false; reason: string };
type Save = { ok: true; scopes: string[] } | { ok: false; reason: string };

export interface CeilingView {
  scopes: string[];
  source: "sync" | "env";
  syncedAt?: string;
  syncedBy?: string;
}

const GROUPS: ScopeGroup[] = ["read", "bridge_jobs", "credentials", "physical", "other"];
const ease = [0.22, 1, 0.36, 1] as const;

export function CeilingCard({ ceiling, sync }: { ceiling: CeilingView; sync: () => Promise<Sync> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Sync | undefined>();
  const known = SCOPES.filter((s) => ceiling.scopes.includes(s.scope)).length;
  const extra = ceiling.scopes.filter((s) => !SCOPES.some((x) => x.scope === s));

  return (
    <section aria-labelledby="ceiling" className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="ceiling" className="flex items-center gap-2 font-semibold">
            <KeySquare className="size-4 text-primary" aria-hidden /> igloohome scopes
          </h2>
          <p className="text-xs text-muted-foreground">
            {ceiling.source === "sync" ? (
              <>
                {ceiling.scopes.length} granted to our client · synced <RelativeTime iso={ceiling.syncedAt} /> by {ceiling.syncedBy}
              </>
            ) : (
              <>Not synced yet: using IGLOOHOME_SCOPES ({ceiling.scopes.length}).</>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await sync();
              setResult(r);
              if (r.ok) router.refresh();
            })
          }
        >
          {pending ? <LoaderCircle className="animate-spin" /> : <RefreshCw />} Sync
        </Button>
      </div>
      {result && (
        <p className={cn("rounded-lg px-2 py-1.5 text-xs", result.ok ? "bg-success/8 text-success" : "bg-destructive/8 text-destructive")}>
          {result.ok
            ? `${result.count} scopes granted${result.added.length ? ` · new: ${result.added.map(shortScope).join(", ")}` : ""}${result.removed.length ? ` · gone: ${result.removed.map(shortScope).join(", ")}` : ""}`
            : result.reason}
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        {SCOPES.map((s) => {
          const granted = ceiling.scopes.includes(s.scope);
          return (
            <span
              key={s.scope}
              title={`${s.scope}${granted ? "" : " (not granted to our client)"}`}
              className={cn("rounded-full px-2 py-0.5 font-mono text-[10px]", granted ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground line-through")}
            >
              {shortScope(s.scope)}
            </span>
          );
        })}
        {extra.map((s) => (
          <span key={s} title="Granted, but not in our catalog" className="rounded-full bg-info/10 px-2 py-0.5 font-mono text-[10px] text-info">
            {shortScope(s)}
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Sync requests one token without a scope list (igloohome then grants everything our client may use), reads server-health with it, and discards
        it. {known} of the {SCOPES.length} documented scopes are granted.
      </p>
    </section>
  );
}

export function ScopeEditor({
  userId,
  username,
  assigned,
  ceiling,
  save,
  onDone,
}: {
  userId: number;
  username: string;
  assigned: string[];
  ceiling: string[];
  save: (id: number, scopes: string[]) => Promise<Save>;
  onDone: (message: { tone: "ok" | "error"; text: string }) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState(() => new Set(assigned));
  const changed = picked.size !== assigned.length || assigned.some((s) => !picked.has(s));

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.25, ease }}
      className="overflow-hidden"
    >
      <div className="flex flex-col gap-3 border-t pt-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <fieldset key={group} className="flex flex-col gap-1">
              <legend className="mb-1 flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {group === "physical" && <TriangleAlert className="size-3 text-warning" aria-hidden />} {GROUP_LABEL[group]}
              </legend>
              {SCOPES.filter((s) => s.group === group).map((s) => {
                const read = READ_SCOPES.includes(s.scope);
                const granted = ceiling.includes(s.scope);
                const on = read || picked.has(s.scope);
                return (
                  <label
                    key={s.scope}
                    title={s.scope}
                    className={cn("flex items-start gap-2 rounded-md px-1 py-0.5 text-sm", (read || !granted) && "opacity-60", !read && granted && "cursor-pointer hover:bg-accent/50")}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-primary"
                      checked={on && granted}
                      disabled={read || !granted || pending}
                      onChange={() =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (next.has(s.scope)) next.delete(s.scope);
                          else next.add(s.scope);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0">
                      <span className="block leading-tight">{s.label}</span>
                      <span className="block text-[11px] leading-tight text-muted-foreground">
                        {!granted ? "Not granted to our client" : read ? "Everyone has this" : (s.usedFor ?? "No iot-pms feature uses this yet")}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={pending || !changed}
            onClick={() =>
              start(async () => {
                const r = await save(userId, [...picked]);
                onDone(r.ok ? { tone: "ok", text: `Scopes saved for ${username} (${r.scopes.length} assigned)` } : { tone: "error", text: r.reason });
                if (r.ok) router.refresh();
              })
            }
          >
            {pending ? <LoaderCircle className="animate-spin" /> : <Check />} Save scopes
          </Button>
          <p className="text-xs text-muted-foreground">Takes effect on their next action; their igloohome token carries only these scopes.</p>
        </div>
      </div>
    </motion.div>
  );
}
