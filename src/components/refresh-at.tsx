"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Re-renders the page once a server-side wait ends (a job window, a rate limit), so buttons disabled "until T"
// come back by themselves instead of waiting for the next event.
export function RefreshAt({ at }: { at?: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!at) return;
    const ms = Date.parse(at) - Date.now() + 1000;
    if (!(ms > 0) || ms > 30 * 60_000) return;
    const t = setTimeout(() => router.refresh(), ms);
    return () => clearTimeout(t);
  }, [at, router]);
  return null;
}
