"use client";

import { BookOpen } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EvidenceBadge } from "@/components/visuals";
import { decode, type CodeKind } from "@/lib/code-meanings";
import { cn } from "@/lib/utils";

// A code that explains itself: hover (mouse), tap (touch) or Enter (keyboard) shows meaning, source and evidence.
// Popover, not tooltip: tooltips do not open on touch screens.

export function Code({
  kind,
  value,
  meaning,
  children,
  className,
}: {
  kind: CodeKind;
  value: string | number;
  meaning?: string; // operation-specific meaning known by the server (e.g. per-endpoint HTTP status)
  children?: React.ReactNode; // how the code is shown; defaults to the raw value
  className?: string;
}) {
  const d = decode(kind, value, { meaning });
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hover = (next: boolean) => (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    clearTimeout(closeTimer.current);
    if (next) setOpen(true);
    else closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${d.title}: ${d.meaning}`}
          onPointerEnter={hover(true)}
          onPointerLeave={hover(false)}
          className={cn(
            "inline-flex cursor-help items-baseline rounded font-mono underline decoration-dotted decoration-from-font underline-offset-2 outline-none hover:decoration-solid focus-visible:ring-3 focus-visible:ring-ring/50",
            className,
          )}
        >
          {children ?? value}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 text-sm" onPointerEnter={hover(true)} onPointerLeave={hover(false)} onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex flex-col gap-1.5">
          <p className="flex items-center justify-between gap-2 font-mono text-xs text-muted-foreground">
            {d.title}
            {d.evidence && <EvidenceBadge level={d.evidence} />}
          </p>
          <p className="font-medium">{d.meaning}</p>
          {d.note && <p className="text-xs text-muted-foreground">{d.note}</p>}
          <p className="flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
            <span className="truncate">{d.source}</span>
            <Link href="/developer?tab=codes" className="inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline">
              <BookOpen className="size-3" aria-hidden /> All codes
            </Link>
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
