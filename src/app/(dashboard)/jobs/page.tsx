import { ArrowRight, Activity } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { FadeIn, Stagger, StaggerItem } from "@/components/motion";
import { RelativeTime } from "@/components/visuals";
import { cn } from "@/lib/utils";
import { deviceNames } from "@/server/application/dashboard";
import { listJobs, type JobState } from "@/server/application/health-check";

export const metadata: Metadata = { title: "Health checks · iot-pms" };

const TONE: Record<JobState, string> = {
  requested: "bg-info/12 text-info",
  queued: "bg-primary/12 text-primary",
  unknown: "bg-warning/15 text-warning",
  completed: "bg-success/12 text-success",
  expired: "bg-warning/15 text-warning",
  rejected: "bg-destructive/12 text-destructive",
};

export default async function JobsPage() {
  const [jobs, names] = await Promise.all([listJobs(50), deviceNames()]);
  return (
    <div className="flex flex-col gap-6">
      <FadeIn>
        <p className="text-sm font-medium text-primary">Bridge jobs</p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Health checks</h1>
        <p className="mt-1 text-sm text-muted-foreground">Start one from a lock or Bridge on the Devices screen.</p>
      </FadeIn>
      {jobs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center">
          <Activity className="size-8 text-primary" aria-hidden />
          <p className="font-medium">No health checks yet</p>
          <Link href="/devices" className="text-sm font-medium text-primary hover:underline">
            Go to Devices
          </Link>
        </div>
      ) : (
        <Stagger className="flex flex-col gap-2">
          {jobs.map((job) => (
            <StaggerItem key={job.id}>
              <Link
                href={`/jobs/${job.id}`}
                className="group flex items-center gap-3 rounded-xl border bg-card p-3 outline-none transition-colors hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="w-10 font-mono text-xs text-muted-foreground">#{job.id}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {job.kindLabel} · {names[job.deviceRef]?.name ?? job.deviceRef}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    <RelativeTime iso={job.createdAt} /> · {job.actor}
                    {job.webhook?.jobStatus !== undefined && ` · result: ${job.webhook.meaning ?? job.webhook.jobStatus}`}
                    {job.errorMessage && job.state === "rejected" && ` · ${job.httpStatus ?? ""} ${job.errorMessage}`}
                  </span>
                </span>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium capitalize", TONE[job.state])}>{job.state}</span>
                <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
}
