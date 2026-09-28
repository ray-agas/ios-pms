import { ChevronRight, ExternalLink } from "lucide-react";

import { JsonView } from "@/components/developer/json-view";
import { RelativeTime } from "@/components/visuals";
import { cn } from "@/lib/utils";
import type { CallRow } from "@/server/application/dashboard";
import { Code } from "@/components/code-hint";

// Request inspector rows. Native <details> gives keyboard + screen-reader expand for free, no client JS.

export function MethodPill({ method }: { method: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-md px-1.5 font-mono text-[10px] font-semibold",
        method === "GET" ? "bg-info/12 text-info" : "bg-warning/15 text-warning",
      )}
    >
      {method}
    </span>
  );
}

export function StatusPill({ status, outcome }: { status?: number; outcome: string }) {
  const tone =
    status === undefined
      ? "bg-muted text-muted-foreground"
      : status < 300
        ? "bg-success/12 text-success"
        : status < 500
          ? "bg-warning/15 text-warning"
          : "bg-destructive/12 text-destructive";
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center rounded-md px-1.5 font-mono text-[11px] font-semibold tabular-nums", tone)}>
      {status ?? outcome}
    </span>
  );
}

export function CallList({ calls, empty = "No calls recorded yet." }: { calls: CallRow[]; empty?: string }) {
  if (calls.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y rounded-xl border bg-card">
      {calls.map((call) => (
        <li key={call.id}>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
              <MethodPill method={call.method} />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {call.pathTemplate}
                {call.deviceRef && <span className="text-muted-foreground"> · {call.deviceRef}</span>}
              </span>
              {call.source === "try-it" && (
                <span className="hidden rounded-md bg-primary/12 px-1.5 text-[10px] font-semibold text-primary uppercase sm:inline">try it</span>
              )}
              <StatusPill status={call.status} outcome={call.outcome} />
              <span className="hidden w-14 text-right text-xs text-muted-foreground tabular-nums sm:inline">{call.latencyMs} ms</span>
              <span className="hidden w-24 text-right text-xs text-muted-foreground md:inline">
                <RelativeTime iso={call.at} />
              </span>
            </summary>
            <div className="flex flex-col gap-3 border-t bg-muted/20 px-3 py-3 text-sm">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                <Field label="Operation" value={`${call.operation}${call.inventoryRef ? ` (${call.inventoryRef})` : ""}`} mono />
                <Field label="Status" value={call.status !== undefined ? <Code kind="http" value={call.status} meaning={call.decoded} /> : "No response"} />
                <Field label="Outcome" value={<Code kind="outcome" value={call.outcome} />} />
                <Field label="Latency" value={`${call.latencyMs} ms`} />
              </dl>
              {call.docUrl && (
                <a href={call.docUrl} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline">
                  Official docs <ExternalLink className="size-3" aria-hidden />
                </a>
              )}
              {call.requestExcerpt && (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-muted-foreground">Request body</p>
                  <JsonView text={call.requestExcerpt} />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">Response (redacted, first 2 000 characters)</p>
                {call.responseExcerpt ? <JsonView text={call.responseExcerpt} /> : <p className="text-xs text-muted-foreground">No body</p>}
              </div>
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("break-words", mono && "font-mono text-xs")}>{value}</dd>
    </div>
  );
}
