import { Braces, ExternalLink } from "lucide-react";
import Link from "next/link";

import { recentCallsAction } from "@/app/(dashboard)/developer/actions";
import { MethodPill } from "@/components/developer/call-list";
import { LiveCallList } from "@/components/developer/live-call-list";
import { EvidenceBadge } from "@/components/visuals";
import { recentApiCalls } from "@/server/application/dashboard";
import { isDeveloperMode } from "@/server/dev-mode";
import { CATALOG_BY_ID } from "@/server/igloohome/catalog";

// "Behind this screen" panel (integration-architecture.md §8a). Renders nothing unless Developer panels are on.

export async function DevPanel({ operations, note }: { operations: string[]; note?: string }) {
  if (!(await isDeveloperMode())) return null;
  const entries = operations.map((id) => CATALOG_BY_ID.get(id)).filter((e) => e !== undefined);
  const calls = operations.length ? await recentApiCalls({ operations, limit: 8 }) : [];

  return (
    <section aria-labelledby="dev-panel-title" className="flex flex-col gap-4 rounded-2xl border border-dashed border-primary/40 bg-primary/3 p-4 md:p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="dev-panel-title" className="flex items-center gap-2 font-semibold">
          <Braces className="size-4 text-primary" aria-hidden /> Behind this screen
        </h2>
        <Link href="/developer" className="text-sm font-medium text-primary hover:underline">
          Open Developer
        </Link>
      </header>
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
      {entries.length > 0 && (
        <ul className="grid gap-2 md:grid-cols-2">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-1.5 rounded-xl border bg-card p-3">
              <p className="flex items-center gap-2 font-mono text-xs">
                <MethodPill method={entry.method} />
                <span className="truncate">{entry.pathTemplate}</span>
              </p>
              <p className="flex flex-wrap items-center gap-2 text-sm">
                {entry.title} <span className="font-mono text-xs text-muted-foreground">{entry.inventoryRef}</span>
                <EvidenceBadge level={entry.evidence} />
              </p>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span className="font-mono">{entry.scope}</span>
                <a href={entry.docUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
                  docs <ExternalLink className="size-3" aria-hidden />
                </a>
              </p>
            </li>
          ))}
        </ul>
      )}
      {operations.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Latest calls</p>
          <LiveCallList initial={calls} operations={operations} refresh={recentCallsAction} />
        </div>
      )}
    </section>
  );
}
