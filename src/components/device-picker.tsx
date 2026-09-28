"use client";

import { Check, ChevronsUpDown, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DeviceGlyph } from "@/components/visuals";
import { KIND_LABEL } from "@/lib/device-kinds";
import { cn } from "@/lib/utils";

// Searchable device picker for the PIN forms (built for many devices): search by name, cabin/room or ID; filter by
// kind; grouped by cabin/room; unavailable devices stay visible with their reason. Arrow keys move, Enter picks.

export interface PickerItem {
  ref: string;
  name: string;
  kind: string;
  place?: string;
  /** Can this form act on it now? If not, `reason` says why (shown on hover and under the field). */
  allowed: boolean;
  reason?: string;
  hint?: string; // e.g. model or Bridge
}

const NO_PLACE = "No cabin or room";

export function DevicePicker({ items, value, onChange, label = "Device" }: { items: PickerItem[]; value: string; onChange: (ref: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [onlyAllowed, setOnlyAllowed] = useState(false);
  const [active, setActive] = useState(0);
  const selected = items.find((i) => i.ref === value);
  const kinds = [...new Set(items.map((i) => i.kind))];

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items
      .filter((i) => (!kind || i.kind === kind) && (!onlyAllowed || i.allowed))
      .filter((i) => !needle || [i.name, i.place, i.ref, KIND_LABEL[i.kind]].some((x) => x?.toLowerCase().includes(needle)))
      .sort((a, b) => (a.place ?? "~").localeCompare(b.place ?? "~") || Number(b.allowed) - Number(a.allowed) || a.name.localeCompare(b.name));
  }, [items, q, kind, onlyAllowed]);

  const pick = (ref: string) => {
    onChange(ref);
    setOpen(false);
    setQ("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${selected ? selected.name : "choose"}`}
          className="flex h-12 w-full items-center gap-3 rounded-lg border border-input bg-background px-2.5 text-left text-sm outline-none transition-shadow focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          {selected ? (
            <>
              <DeviceGlyph kind={selected.kind} className="size-8 [&_svg]:size-4" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{selected.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {selected.place ?? NO_PLACE} · <span className="font-mono">{selected.ref}</span>
                  {selected.allowed ? "" : " · not available"}
                </span>
              </span>
            </>
          ) : (
            <span className="flex-1 text-muted-foreground">Choose a device…</span>
          )}
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-80 p-0">
        <div className="flex flex-col gap-2 border-b p-2">
          <label className="relative">
            <span className="sr-only">Search devices</span>
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, shown.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter" && shown[active]) {
                  e.preventDefault();
                  pick(shown[active].ref);
                }
              }}
              placeholder="Name, cabin/room or ID"
              className="h-9 w-full rounded-md border border-input bg-background pr-2 pl-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
            />
          </label>
          <div className="flex flex-wrap items-center gap-1">
            {["", ...kinds].map((k) => (
              <button
                key={k || "all"}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                  kind === k ? "border-primary/50 bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {k ? `${KIND_LABEL[k] ?? k}s` : "All"}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={onlyAllowed}
              onClick={() => setOnlyAllowed(!onlyAllowed)}
              className={cn(
                "ml-auto rounded-full border px-2 py-0.5 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                onlyAllowed ? "border-success/50 bg-success/10 text-success" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Available only
            </button>
          </div>
        </div>
        <div role="listbox" aria-label={label} className="max-h-72 overflow-y-auto p-1">
          {shown.length === 0 && <p className="p-3 text-sm text-muted-foreground">No device matches.</p>}
          {shown.map((item, i) => {
            const group = item.place ?? NO_PLACE;
            const newGroup = i === 0 || (shown[i - 1].place ?? NO_PLACE) !== group;
            return (
              <div key={item.ref}>
                {newGroup && <p className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{group}</p>}
                <button
                  type="button"
                  role="option"
                  aria-selected={item.ref === value}
                  title={item.allowed ? undefined : item.reason}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(item.ref)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm outline-none",
                    i === active && "bg-accent",
                    !item.allowed && "opacity-60",
                  )}
                >
                  <DeviceGlyph kind={item.kind} className="size-7 [&_svg]:size-3.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <span className="font-mono">{item.ref}</span>
                      {item.hint ? ` · ${item.hint}` : ""}
                      {!item.allowed && item.reason ? ` · ${item.reason}` : ""}
                    </span>
                  </span>
                  {item.ref === value && <Check className="size-4 text-primary" aria-hidden />}
                </button>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
