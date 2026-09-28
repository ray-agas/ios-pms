"use client";

import { useEffect, useState } from "react";

import { CallList } from "@/components/developer/call-list";
import type { CallRow } from "@/server/application/dashboard";

// Keeps "Latest calls" current while a screen polls igloohome (e.g. a job page). Reads the local call log only.
const POLL_MS = 3000;

export function LiveCallList({ initial, operations, refresh }: { initial: CallRow[]; operations: string[]; refresh: (ops: string[]) => Promise<CallRow[]> }) {
  const [calls, setCalls] = useState(initial);
  useEffect(() => {
    const timer = setInterval(async () => {
      if (document.hidden) return;
      try {
        setCalls(await refresh(operations));
      } catch {
        // keep the last list; the panel is a debugging aid
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [operations, refresh]);
  return <CallList calls={calls} />;
}
