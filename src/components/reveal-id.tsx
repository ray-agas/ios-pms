"use client";

import { Check, Copy, EyeOff, IdCard, LoaderCircle } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

// Plan G1: a super-admin can see a device's full igloohome ID on request. Audited on the server; hidden again after
// 30 s. Keep full IDs out of docs, tickets and screenshots (CLAUDE.md §11).

export type RevealIdAction = (ref: string) => Promise<{ ok: true; id: string } | { ok: false; reason: string }>;
const SHOW_MS = 30_000;

export function RevealId({ deviceRef, reveal }: { deviceRef: string; reveal: RevealIdAction }) {
  const [id, setId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!id) return;
    const t = setTimeout(() => setId(undefined), SHOW_MS);
    return () => clearTimeout(t);
  }, [id]);

  if (error) return <span className="text-xs text-destructive">{error}</span>;
  if (!id) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await reveal(deviceRef);
            if (r.ok) setId(r.id);
            else setError(r.reason);
          })
        }
      >
        {pending ? <LoaderCircle className="animate-spin" /> : <IdCard />} Reveal ID
      </Button>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <code className="truncate rounded-md bg-background px-1.5 py-0.5 font-mono text-xs ring-1 ring-border">{id}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Copy device ID"
        onClick={async () => {
          await navigator.clipboard.writeText(id);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Hide device ID" onClick={() => setId(undefined)}>
        <EyeOff />
      </Button>
    </span>
  );
}
