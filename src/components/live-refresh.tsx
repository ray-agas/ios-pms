"use client";

import { RadioTower } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { FeedItem } from "@/server/application/dashboard";

// Makes a server-rendered screen follow the lock. Every 4 s it asks the LOCAL event store for new webhook events
// (no igloohome call); the cost is the same for 6 devices or 6,000. With `watchRefs` (Devices page, plan F7b) an event
// from a watched device re-renders at once; other events only refresh the compact rows, at most every 30 s.

const POLL_MS = 4000;
const QUIET_REFRESH_MS = 30_000;

export function LiveRefresh({
  lastRowId,
  names,
  watchRefs,
}: {
  lastRowId: number;
  names: Record<string, string | { name?: string }>;
  watchRefs?: string[];
}) {
  const router = useRouter();
  const after = useRef(lastRowId);
  const lastRefresh = useRef(0);
  const nameOf = (ref: string) => {
    const n = names[ref];
    return typeof n === "string" ? n : (n?.name ?? ref);
  };
  const [toast, setToast] = useState<{ id: number; text: string } | undefined>();

  useEffect(() => {
    const timer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const res = await fetch(`/api/activity?after=${after.current}`, { cache: "no-store" });
        if (!res.ok) return;
        const feed: { items: FeedItem[]; lastRowId: number } = await res.json();
        after.current = feed.lastRowId;
        if (feed.items.length === 0) return; // clock syncs only
        const hot = watchRefs ? feed.items.find((i) => watchRefs.includes(i.deviceDisplay)) : feed.items[0];
        if (hot) setToast({ id: Date.now(), text: `${nameOf(hot.deviceDisplay)}: ${hot.label}` });
        if (hot || Date.now() - lastRefresh.current > QUIET_REFRESH_MS) {
          lastRefresh.current = Date.now();
          router.refresh();
        }
      } catch {
        // offline for a moment: try again next tick
      }
    }, POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nameOf only reads names
  }, [names, router, watchRefs?.join(",")]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 md:bottom-6">
      <AnimatePresence>
        {toast && (
          <motion.p
            key={toast.id}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            className="flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg"
          >
            <RadioTower className="size-4" aria-hidden /> Live update · {toast.text}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
