"use client";

import { ArrowRight, ExternalLink, LoaderCircle, Lock, Play, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useState, useTransition } from "react";

import { JsonView } from "@/components/developer/json-view";
import { Button } from "@/components/ui/button";
import { EvidenceBadge } from "@/components/visuals";
import { cn } from "@/lib/utils";
import type { TryItResult } from "@/server/application/dashboard";
import type { TryItField } from "@/server/application/try-it";

import { MethodPill, StatusPill } from "./call-list";
import { Code } from "@/components/code-hint";
import { FindingBadge, type ExperimentFinding } from "@/components/experiment-finding";

export interface ConsoleOperation {
  id: string;
  title: string;
  method: string;
  pathTemplate: string;
  scope: string;
  docUrl: string;
  evidence: string;
  inventoryRef: string;
  risk: string;
  fields: TryItField[];
  deviceKinds?: string[]; // limit the device picker (Bridge jobs)
  locked?: string; // why it cannot run yet
}

interface Props {
  operations: ConsoleOperation[];
  devices: { id: string; kind: string; label: string }[];
  properties: { id: string; label: string }[];
  canRun: boolean;
  run: (operation: string, params: Record<string, string>) => Promise<TryItResult>;
  /** Job types offered for createProxiedJob (operators: 9/10; super-admins: every supported one, plan G1). */
  jobTypes?: { value: string; label: string }[];
  /** Experiment results so far, shown under the form. */
  findings?: { device: string; items: ExperimentFinding[] }[];
}

const inputClass =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-shadow focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40";

const DEFAULT_JOB_TYPES = [
  { value: "9", label: "9 · Get battery level" },
  { value: "10", label: "10 · Get device status (lock / door)" },
];

export function TryItConsole({ operations, devices, properties, canRun, run, jobTypes = DEFAULT_JOB_TYPES, findings = [] }: Props) {
  const [selectedId, setSelectedId] = useState(operations.find((o) => !o.locked)?.id ?? operations[0]?.id);
  const [result, setResult] = useState<TryItResult | undefined>();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<FormData | undefined>();
  const selected = operations.find((o) => o.id === selectedId);

  const submit = (form: FormData) => {
    if (!selected || selected.locked) return;
    // R1 contacts a device: one extra, explicit click (first-slice-workflow §5).
    if (selected.risk === "R1" && confirming !== form) {
      setConfirming(form);
      return;
    }
    setConfirming(undefined);
    const params: Record<string, string> = {};
    for (const field of selected.fields) {
      const value = String(form.get(field) ?? "").trim();
      if (value) params[field] = value;
    }
    startTransition(async () => setResult(await run(selected.id, params)));
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <div role="radiogroup" aria-label="Operation" className="flex flex-col gap-1.5">
        {operations.map((op) => {
          const active = op.id === selectedId;
          return (
            <button
              key={op.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                setSelectedId(op.id);
                setResult(undefined);
                setConfirming(undefined);
              }}
              className={cn(
                "relative flex items-center gap-2 rounded-xl px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                active ? "text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              {active && (
                <motion.span layoutId="try-op" className="absolute inset-0 rounded-xl bg-accent ring-1 ring-primary/30" transition={{ type: "spring", stiffness: 420, damping: 34 }} />
              )}
              <span className="relative">
                <MethodPill method={op.method} />
              </span>
              <span className="relative min-w-0 flex-1 truncate text-sm font-medium">{op.title}</span>
              {op.locked && <Lock className="relative size-3.5 shrink-0" aria-label="Not available yet" />}
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="flex min-w-0 flex-col gap-4">
          <section aria-labelledby="try-title" className="flex flex-col gap-4 rounded-2xl border bg-card p-4 md:p-5">
            <header className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 id="try-title" className="font-semibold">
                  {selected.title}
                </h3>
                <span className="font-mono text-xs text-muted-foreground">{selected.inventoryRef}</span>
                <EvidenceBadge level={selected.evidence} />
              </div>
              <p className="flex flex-wrap items-center gap-2 font-mono text-xs">
                <MethodPill method={selected.method} /> {selected.pathTemplate}
              </p>
              <p className="text-xs text-muted-foreground">
                Scope <span className="font-mono">{selected.scope}</span> ·{" "}
                <a href={selected.docUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
                  docs <ExternalLink className="size-3" aria-hidden />
                </a>
              </p>
            </header>

            {selected.locked ? (
              <p className="flex items-start gap-2 rounded-xl bg-warning/10 p-3 text-sm">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /> {selected.locked}
              </p>
            ) : (
              <form action={submit} key={selected.id} className="flex flex-col gap-3">
                {selected.fields.length === 0 && <p className="text-sm text-muted-foreground">No parameters.</p>}
                <div className="grid gap-3 sm:grid-cols-2">
                  {selected.fields.map((field) => (
                    <label key={field} className="flex flex-col gap-1.5 text-sm font-medium">
                      {FIELD_LABEL[field]}
                      {field === "deviceId" ? (
                        <select name="deviceId" required className={inputClass}>
                          {devices.filter((d) => !selected.deviceKinds || selected.deviceKinds.includes(d.kind)).map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.label}
                            </option>
                          ))}
                        </select>
                      ) : field === "propertyId" ? (
                        <select name="propertyId" required className={inputClass}>
                          {properties.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      ) : field === "jobType" ? (
                        <select name="jobType" required className={inputClass}>
                          {jobTypes.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      ) : field === "pin" ? (
                        <input name="pin" inputMode="numeric" pattern="[0-9]{4,10}" autoComplete="off" placeholder="only for job 5 (delete PIN)" className={cn(inputClass, "font-mono")} />
                      ) : field === "reason" ? (
                        <input name="reason" minLength={10} maxLength={200} placeholder="needed for 1, 2, 15 and experiments" className={inputClass} />
                      ) : field === "password" ? (
                        <input name="password" type="password" autoComplete="current-password" placeholder="your password (same cases)" className={inputClass} />
                      ) : field === "limit" ? (
                        <input name="limit" type="number" min={1} max={300} placeholder="default" inputMode="numeric" className={inputClass} />
                      ) : (
                        <input name="jobId" required pattern="[0-9a-fA-F]{24}" placeholder="24 hex characters" className={cn(inputClass, "font-mono")} />
                      )}
                    </label>
                  ))}
                </div>
                {confirming && (
                  <div role="alert" className="flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
                    <p>
                      {jobTypes.length > DEFAULT_JOB_TYPES.length
                        ? "This sends a Bridge job. Depending on the type it can move the lock (1, 2), remove a PIN (5) or delete logs from the lock (15). On a switch or keypad it is an experiment. Sent once, never retried; every guard is checked on the server."
                        : "This wakes the device through its Bridge. No lock movement and no credential change. It is sent once and never retried; allowlist, feature flag and rate limits are checked on the server."}
                    </p>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" onClick={() => submit(confirming)} disabled={pending}>
                        Confirm and send
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(undefined)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit" size="lg" disabled={!canRun || pending || confirming !== undefined} className="px-4">
                    {pending ? <LoaderCircle className="animate-spin" /> : <Play />} {pending ? "Running…" : "Run request"}
                  </Button>
                  {!canRun && <p className="text-xs text-muted-foreground">Operator role required to run requests.</p>}
                </div>
              </form>
            )}
          </section>

          <div aria-live="polite">
            <AnimatePresence mode="wait">
              {result && result.operation === selected.id && (
                <motion.section
                  key={`${result.operation}-${result.latencyMs}-${result.outcome}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  aria-label="Result"
                  className={cn("flex flex-col gap-3 rounded-2xl border p-4 md:p-5", result.ok ? "border-success/30 bg-success/5" : "border-warning/40 bg-warning/5")}
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {result.status !== undefined ? (
                      <Code kind="http" value={result.status} meaning={result.decoded}>
                        <StatusPill status={result.status} outcome={result.outcome} />
                      </Code>
                    ) : (
                      <StatusPill status={result.status} outcome={result.outcome} />
                    )}
                    <span className="font-medium">{result.decoded ?? (result.ok ? "Success" : "Failed")}</span>
                    {result.latencyMs !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{result.latencyMs} ms</span>}
                    <Code kind="outcome" value={result.outcome} className="text-xs text-muted-foreground" />
                  </div>
                  {result.outcome === "contract" && (
                    <p className="text-sm text-warning">The response did not match the documented shape. Record this as evidence against the DOC entry.</p>
                  )}
                  {result.message && !result.ok && <p className="text-sm text-muted-foreground">{result.message}</p>}
                  {result.jobUrl && (
                    <Link href={result.jobUrl} className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline">
                      Open the job <ArrowRight className="size-3.5" aria-hidden />
                    </Link>
                  )}
                  {result.body ? <JsonView text={result.body} /> : <p className="text-xs text-muted-foreground">No body</p>}
                </motion.section>
              )}
            </AnimatePresence>
          </div>

          {findings.length > 0 && (
            <section aria-labelledby="findings" className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
              <h3 id="findings" className="text-sm font-semibold">
                Experiment results <span className="font-normal text-muted-foreground">· hover a badge for the reason</span>
              </h3>
              <ul className="flex flex-col gap-2 text-sm">
                {findings.map((f) => (
                  <li key={f.device} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{f.device}</span>
                    {f.items.map((i) => (
                      <FindingBadge key={i.kind} finding={i} withLabel />
                    ))}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

const FIELD_LABEL: Record<TryItField, string> = {
  deviceId: "Device",
  propertyId: "Property",
  limit: "limit (1–300)",
  jobId: "jobId",
  jobType: "jobType",
  pin: "pin (job 5)",
  reason: "Reason",
  password: "Your password",
};
