import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DevPanel } from "@/components/developer/dev-panel";
import { JobMonitor } from "@/components/job-monitor";
import { FadeIn } from "@/components/motion";
import { deviceNames } from "@/server/application/dashboard";
import { getJob } from "@/server/application/health-check";

import { refreshJobAction } from "../actions";

export const metadata: Metadata = { title: "Health check · iot-pms" };

export default async function JobPage({ params }: PageProps<"/jobs/[id]">) {
  const id = Number((await params).id);
  const [job, names] = await Promise.all([Number.isSafeInteger(id) ? getJob(id) : undefined, deviceNames()]);
  if (!job) notFound();

  return (
    <div className="flex flex-col gap-6">
      <FadeIn>
        <p className="text-sm font-medium text-primary">Health check #{job.id}</p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{job.kindLabel}</h1>
      </FadeIn>
      <JobMonitor initial={job} names={names} refresh={refreshJobAction} />
      <DevPanel operations={[job.kind === "bridge_diagnostics" ? "createBridgeDiagnosticsJob" : "createProxiedJob", "getJob"]} />
    </div>
  );
}
