"use client";

import { CircleCheck, CircleHelp, CircleMinus, CircleX, LoaderCircle } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

// Result of a super-admin experiment (plan G1): what happened last time, with the detailed reason on hover.

export interface ExperimentFinding {
  kind: string;
  label: string;
  status: "works" | "no_effect" | "failed" | "no_result" | "pending";
  detail: string;
  at: string;
  jobId: number;
}

const LOOK = {
  works: { text: "Works", icon: CircleCheck, tone: "bg-success/12 text-success" },
  no_effect: { text: "No effect", icon: CircleMinus, tone: "bg-muted text-muted-foreground" },
  failed: { text: "Failed", icon: CircleX, tone: "bg-destructive/12 text-destructive" },
  no_result: { text: "No result", icon: CircleHelp, tone: "bg-warning/15 text-warning" },
  pending: { text: "Waiting", icon: LoaderCircle, tone: "bg-info/12 text-info" },
} as const;

export function FindingBadge({ finding, withLabel = false }: { finding: ExperimentFinding; withLabel?: boolean }) {
  const look = LOOK[finding.status];
  const Icon = look.icon;
  const when = new Date(finding.at).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" });
  return (
    <Link
      href={`/jobs/${finding.jobId}`}
      title={`${finding.label} · tried ${when}\n${finding.detail}`}
      className={cn("inline-flex cursor-help items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", look.tone)}
    >
      <Icon className={cn("size-3", finding.status === "pending" && "animate-spin")} aria-hidden />
      {withLabel ? `${finding.label}: ${look.text}` : `Tried: ${look.text}`}
      <span className="sr-only"> ({finding.detail})</span>
    </Link>
  );
}
