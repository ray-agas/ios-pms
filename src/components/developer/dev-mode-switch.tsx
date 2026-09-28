"use client";

import { Braces } from "lucide-react";
import { motion } from "motion/react";
import { useOptimistic, useTransition } from "react";

import { cn } from "@/lib/utils";

export function DevModeSwitch({ on, action, className }: { on: boolean; action: (on: boolean) => Promise<void>; className?: string }) {
  const [optimistic, setOptimistic] = useOptimistic(on);
  const [, startTransition] = useTransition();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={optimistic}
      onClick={() =>
        startTransition(async () => {
          setOptimistic(!optimistic);
          await action(!optimistic);
        })
      }
      className={cn(
        "flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50",
        optimistic ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      <Braces className="size-4" aria-hidden />
      <span className="flex-1 text-left">Developer panels</span>
      <span className={cn("relative h-5 w-9 rounded-full transition-colors", optimistic ? "bg-primary" : "bg-input")} aria-hidden>
        <motion.span
          className="absolute top-0.5 left-0.5 size-4 rounded-full bg-background shadow-sm"
          animate={{ x: optimistic ? 16 : 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 32 }}
        />
      </span>
    </button>
  );
}
