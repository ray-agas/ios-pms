import type { Metadata } from "next";

import { ActivityFeed } from "@/components/activity-feed";
import { DevPanel } from "@/components/developer/dev-panel";
import { FadeIn } from "@/components/motion";
import { EvidenceBadge } from "@/components/visuals";
import { deviceNames, getActivityFeed, getSite } from "@/server/application/dashboard";

export const metadata: Metadata = { title: "Activity · iot-pms" };

export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  const [feed, names, site, params] = await Promise.all([getActivityFeed({ limit: 300 }), deviceNames(), getSite(), searchParams]);
  const bridges = (site.data?.bridges ?? []).map((b) => ({ id: b.id, name: b.name ?? b.id, online: b.status?.online }));
  const requested = typeof params.bridge === "string" ? params.bridge : "all";
  const requestedDevice = typeof params.device === "string" ? params.device : "all";

  return (
    <div className="flex flex-col gap-6">
      <FadeIn>
        <p className="text-sm font-medium text-primary">Webhook events</p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Activity</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Lock logs, remote jobs and Bridge connectivity, as igloohome pushes them.
          <EvidenceBadge level="UNVERIFIED" />
        </p>
      </FadeIn>
      <ActivityFeed initial={feed} names={names} bridges={bridges} initialBridge={requested} initialDevice={requestedDevice} />
      <DevPanel operations={[]} note="This screen makes no igloohome call. It reads webhook events stored by POST /api/webhooks/igloohome (types 3, 5, 10; see Developer → Codes). GET /devices/{id}/activity is blocked for our account (U18)." />
    </div>
  );
}
