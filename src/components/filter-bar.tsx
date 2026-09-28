"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { cn } from "@/lib/utils";

// URL-backed filters (plan F7b): every change replaces the query string, so filtered views are shareable and the
// server does the filtering. Changing a filter resets the page number; `watch` is kept.

export interface FilterSelect {
  name: string;
  label: string;
  options: { value: string; label: string }[];
}

const field =
  "h-9 rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-shadow focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40";

export function FilterBar({ placeholder, selects, toggles = [] }: { placeholder: string; selects: FilterSelect[]; toggles?: { name: string; label: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  const set = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page");
    startTransition(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  };

  // Search waits for a pause in typing.
  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    const t = setTimeout(() => set({ q: q.trim() || undefined }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `set` reads the latest params itself
  }, [q]);

  const keys = ["q", ...selects.map((s) => s.name), ...toggles.map((t) => t.name)];
  const active = keys.some((key) => params.get(key));

  return (
    <div role="search" className={cn("flex flex-wrap items-center gap-2 transition-opacity", pending && "opacity-70")}>
      <label className="relative min-w-48 flex-1 sm:max-w-72">
        <span className="sr-only">Search</span>
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className={cn(field, "w-full pl-8")} />
      </label>
      {selects.map((s) => (
        <select key={s.name} aria-label={s.label} value={params.get(s.name) ?? ""} onChange={(e) => set({ [s.name]: e.target.value || undefined })} className={field}>
          <option value="">{s.label}: all</option>
          {s.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}
      {toggles.map((t) => {
        const on = params.get(t.name) === "1";
        return (
          <button
            key={t.name}
            type="button"
            aria-pressed={on}
            onClick={() => set({ [t.name]: on ? undefined : "1" })}
            className={cn(
              "h-9 rounded-lg border px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40",
              on ? "border-warning/50 bg-warning/10 text-warning" : "bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        );
      })}
      {active && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            set(Object.fromEntries(keys.map((key) => [key, undefined])));
          }}
          className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          <X className="size-3.5" aria-hidden /> Clear
        </button>
      )}
    </div>
  );
}
