import { BookOpen, Binary, ExternalLink, ListTree, ScrollText, SquareTerminal, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";

import { auth } from "@/auth";
import { experimentFindings } from "@/server/application/health-check";
import { atLeast } from "@/server/domain/models";
import { CallList, MethodPill } from "@/components/developer/call-list";
import { DevModeSwitch } from "@/components/developer/dev-mode-switch";
import { TryItConsole, type ConsoleOperation } from "@/components/developer/try-it-console";
import { FadeIn } from "@/components/motion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EvidenceBadge } from "@/components/visuals";
import { cn } from "@/lib/utils";
import { getSite, recentApiCalls } from "@/server/application/dashboard";
import { isTryItOperation, TRY_IT_FIELDS, type TryItField } from "@/server/application/try-it";
import { getIgloohomeConfig } from "@/server/config";
import { isDeveloperMode } from "@/server/dev-mode";
import { CATALOG, type CatalogEntry } from "@/server/igloohome/catalog";
import {
  JOB_STATUS_POLLED,
  JOB_STATUS_WEBHOOK,
  LOG_TYPES,
  MODELS,
  PROXIED_JOB_TYPES,
  WEBHOOK_EVENT_TYPES,
  WIFI_STATUS,
} from "@/server/igloohome/codes";

import { runTryIt, setDeveloperMode } from "./actions";

export const metadata: Metadata = { title: "Developer · iot-pms" };

// R1 operations run as guarded health checks (jobs/actions.ts); these are their console fields.
const R1_FIELDS: Record<string, TryItField[]> = {
  createProxiedJob: ["deviceId", "jobType"],
  createBridgeDiagnosticsJob: ["deviceId"],
};

const TABS = ["try", "inspector", "catalog", "codes"];

// Supported proxied job types (docs: bridge-jobs-proxied). "Not supported" ones (3, 14, 16, 18, 19, 24, 29) are
// not offered. 4 needs dates: Access → Custom PIN.
const SUPER_ADMIN_JOB_TYPES = [
  { value: "9", label: "9 · Get battery level" },
  { value: "10", label: "10 · Get device status (lock / door)" },
  { value: "2", label: "2 · Unlock (physical; reason + password)" },
  { value: "1", label: "1 · Lock (physical; reason + password)" },
  { value: "5", label: "5 · Delete PIN (needs the PIN)" },
  { value: "15", label: "15 · Get activity logs (deletes them from the lock; reason + password)" },
];

export default async function DeveloperPage({ searchParams }: PageProps<"/developer">) {
  const requested = (await searchParams).tab;
  const tab = typeof requested === "string" && TABS.includes(requested) ? requested : "try";
  const [session, calls, site, devMode] = await Promise.all([auth(), recentApiCalls({ limit: 100 }), getSite(), isDeveloperMode()]);
  // Plan G1: super-admins may send every supported proxied job to any managed lock, switch or keypad.
  const superAdmin = atLeast(session?.user?.role, "super_admin");
  const findings = superAdmin ? await experimentFindings() : {};

  const operations: ConsoleOperation[] = CATALOG.map((entry) => ({
    id: entry.id,
    title: entry.title,
    method: entry.method,
    pathTemplate: entry.pathTemplate,
    scope: entry.scope,
    docUrl: entry.docUrl,
    evidence: entry.evidence,
    inventoryRef: entry.inventoryRef,
    risk: entry.risk,
    fields: isTryItOperation(entry.id)
      ? TRY_IT_FIELDS[entry.id]
      : entry.id === "createProxiedJob" && superAdmin
        ? [...R1_FIELDS.createProxiedJob, "pin", "reason", "password"]
        : (R1_FIELDS[entry.id] ?? []),
    deviceKinds:
      entry.id === "createBridgeDiagnosticsJob" ? ["bridge"] : entry.id === "createProxiedJob" ? (superAdmin ? ["lock", "switch", "keypad"] : ["lock"]) : undefined,
    locked:
      entry.tryIt === "R1" && !getIgloohomeConfig()?.enableBridgeJobs
        ? "Bridge jobs are off. Set IGLOOHOME_ENABLE_BRIDGE_JOBS=true in .env and restart to enable health checks."
        : undefined,
  }));
  const devices = [...(site.data?.devices ?? []), ...(site.data?.bridges ?? [])].map((d) => ({ id: d.id, kind: d.kind, label: `${d.name ?? "Unnamed"} · ${d.id}` }));
  const properties = (site.data?.rooms ?? []).map((r) => ({ id: r.id, label: r.name }));

  return (
    <div className="flex flex-col gap-6">
      <FadeIn className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-primary">Developer mode</p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Developer</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Every igloohome call this app can make, what the docs say about it, and what really came back. Values are redacted.
          </p>
        </div>
        <DevModeSwitch on={devMode} action={setDeveloperMode} className="rounded-xl border bg-card" />
      </FadeIn>

      <Tabs defaultValue={tab} className="gap-5">
        <div className="-mx-4 overflow-x-auto px-4 py-1 [scrollbar-width:none] md:mx-0 md:px-1">
          <TabsList className="h-10! w-max">
            <Tab value="try" icon={SquareTerminal} label="Try it" />
            <Tab value="inspector" icon={ScrollText} label="Inspector" count={calls.length} />
            <Tab value="catalog" icon={ListTree} label="Catalog" count={CATALOG.length} />
            <Tab value="codes" icon={Binary} label="Codes" />
          </TabsList>
        </div>

        <TabsContent value="try">
          <TryItConsole
            operations={operations}
            devices={devices}
            properties={properties}
            canRun={atLeast(session?.user?.role, "operator")}
            run={runTryIt}
            jobTypes={superAdmin ? SUPER_ADMIN_JOB_TYPES : undefined}
            findings={Object.entries(findings).map(([ref, items]) => ({ device: devices.find((d) => d.id === ref)?.label ?? ref, items }))}
          />
        </TabsContent>

        <TabsContent value="inspector" className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Latest 100 calls to igloohome, newest first. Bodies are redacted and device IDs masked before they are stored.</p>
          <CallList calls={calls} empty="No calls yet. Open Overview or Devices, or run something in Try it." />
        </TabsContent>

        <TabsContent value="catalog">
          <ul className="grid gap-3 md:grid-cols-2">
            {CATALOG.map((entry) => (
              <CatalogCard key={entry.id} entry={entry} />
            ))}
          </ul>
        </TabsContent>

        <TabsContent value="codes" className="flex flex-col gap-4">
          <CodesReference />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Tab({ value, icon: Icon, label, count }: { value: string; icon: React.ComponentType<{ className?: string }>; label: string; count?: number }) {
  return (
    <TabsTrigger value={value} className="h-8 gap-1.5 px-3">
      <Icon className="size-4" aria-hidden />
      {label}
      {count !== undefined && <span className="text-xs tabular-nums opacity-60">{count}</span>}
    </TabsTrigger>
  );
}

function CatalogCard({ entry }: { entry: CatalogEntry }) {
  return (
    <li className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-col gap-1.5">
        <p className="flex items-center gap-2 font-mono text-xs">
          <MethodPill method={entry.method} />
          <span className="min-w-0 truncate">{entry.pathTemplate}</span>
        </p>
        <h3 className="flex flex-wrap items-center gap-2 font-semibold">
          {entry.title}
          <span className="font-mono text-xs font-normal text-muted-foreground">
            {entry.id} · {entry.inventoryRef}
          </span>
        </h3>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <EvidenceBadge level={entry.evidence} />
        <span
          className={cn(
            "rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
            entry.risk === "R0" ? "bg-success/12 text-success" : entry.risk === "R1" ? "bg-warning/15 text-warning" : "bg-destructive/12 text-destructive",
          )}
        >
          {entry.risk} {entry.risk === "R0" ? "read-only" : entry.risk === "R1" ? "wakes device" : "creates a working PIN"}
        </span>
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          Try it: {entry.tryIt === "R0" ? "operator" : entry.tryIt === "R1" ? "operator, guarded" : "no"}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{entry.evidenceNote}</p>
      <p className="font-mono text-xs break-all text-muted-foreground">{entry.scope}</p>
      <details className="group rounded-xl bg-muted/40 text-sm">
        <summary className="cursor-pointer rounded-xl px-3 py-2 font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          Parameters ({entry.params.length}) and documented errors ({entry.errors.length})
        </summary>
        <div className="flex flex-col gap-3 px-3 pb-3">
          {entry.params.length > 0 && (
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Name</th>
                  <th className="py-1 font-medium">In</th>
                  <th className="py-1 font-medium">Rule</th>
                </tr>
              </thead>
              <tbody>
                {entry.params.map((p) => (
                  <tr key={p.name} className="border-t align-top">
                    <td className="py-1.5 pr-2 font-mono">
                      {p.name}
                      {p.required && <span className="text-destructive">*</span>}
                    </td>
                    <td className="py-1.5 pr-2">{p.in}</td>
                    <td className="py-1.5 text-muted-foreground">{p.rule ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <ul className="flex flex-col gap-1.5">
            {entry.errors.map((e) => (
              <li key={`${e.status}-${e.meaning}`} className="flex items-start gap-2 text-xs">
                <span className="rounded-md bg-warning/15 px-1.5 font-mono font-semibold text-warning">{e.status}</span>
                <span className="flex-1">{e.meaning}</span>
                <EvidenceBadge level={e.evidence} />
              </li>
            ))}
          </ul>
        </div>
      </details>
      <a href={entry.docUrl} target="_blank" rel="noreferrer" className="mt-auto inline-flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline">
        <BookOpen className="size-3.5" aria-hidden /> Official docs <ExternalLink className="size-3" aria-hidden />
      </a>
    </li>
  );
}

function CodeTable({ title, source, rows }: { title: string; source: string; rows: { code: string | number; meaning: string; evidence: string; extra?: string }[] }) {
  return (
    <section className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        <p className="font-mono text-[11px] text-muted-foreground">{source}</p>
      </header>
      <ul className="flex flex-col divide-y">
        {rows.map((row) => (
          <li key={row.code} className="flex items-center gap-3 py-1.5 text-sm">
            <span className="w-12 shrink-0 font-mono text-xs font-semibold text-primary tabular-nums">{row.code}</span>
            <span className="min-w-0 flex-1">
              {row.meaning}
              {row.extra && <span className="block text-xs text-muted-foreground">{row.extra}</span>}
            </span>
            <EvidenceBadge level={row.evidence} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const TONE_DOT: Record<string, string> = {
  access: "bg-success",
  denied: "bg-warning",
  alert: "bg-destructive",
  config: "bg-info",
  system: "bg-muted-foreground",
};

function CodesReference() {
  const meaningRows = (dict: Record<number, { meaning: string; evidence: string }>) =>
    Object.entries(dict).map(([code, m]) => ({ code, meaning: m.meaning, evidence: m.evidence }));
  return (
    <>
      <div className="flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <p>
          <span className="font-medium">D23:</span> the docs disagree on what <span className="font-mono">jobStatus</span> means. The webhook table and the polled
          table are shown side by side until M4 records real values from both.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <CodeTable title="jobStatus · job-complete webhook" source="webhook-job-specific-data" rows={meaningRows(JOB_STATUS_WEBHOOK)} />
        <CodeTable title="jobStatus · GET /jobs (polled)" source="Stoplight get-job-status" rows={meaningRows(JOB_STATUS_POLLED)} />
        <CodeTable title="Webhook event types" source="webhooks-bridge-event" rows={meaningRows(WEBHOOK_EVENT_TYPES)} />
        <CodeTable title="Bridge Wi-Fi status" source="webhooks-bridge-event" rows={meaningRows(WIFI_STATUS)} />
      </div>
      <CodeTable
        title="Proxied job types"
        source="bridge-jobs-proxied"
        rows={Object.entries(PROXIED_JOB_TYPES).map(([code, j]) => ({
          code,
          meaning: `${j.name}${j.supported ? "" : " (not supported)"}${code === "9" || code === "10" ? " · allowed in this app" : ""}`,
          extra: j.supported ? `${j.risk}${j.sideEffect ? ` · ${j.sideEffect}` : ""}` : undefined,
          evidence: "DOC",
        }))}
      />
      <section className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold">Activity log types</h3>
          <p className="font-mono text-[11px] text-muted-foreground">webhooks-bridge-event · DOC</p>
        </header>
        <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(LOG_TYPES).map(([code, log]) => (
            <li key={code} className="flex items-center gap-2 py-1 text-sm">
              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", TONE_DOT[log.tone])} />
              <span className="w-7 shrink-0 font-mono text-xs font-semibold text-primary">{code}</span>
              <span className="min-w-0 truncate">{log.label}</span>
              <span className="sr-only">({log.tone})</span>
            </li>
          ))}
        </ul>
      </section>
      <CodeTable
        title="Device models (ID prefix)"
        source="supported-devices"
        rows={Object.entries(MODELS).map(([prefix, m]) => ({
          code: prefix,
          meaning: m.name,
          extra: `${m.kind}${m.algoPin ? " · algoPIN" : ""}`,
          evidence: "DOC",
        }))}
      />
    </>
  );
}
