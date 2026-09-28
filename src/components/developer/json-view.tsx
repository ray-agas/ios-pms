import { cn } from "@/lib/utils";

// Tiny JSON highlighter (no dependency). Works in server and client components. Input is already redacted.

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function pretty(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text; // truncated excerpt or plain-text vendor error
  }
}

export function JsonView({ text, className }: { text: string; className?: string }) {
  const source = pretty(text);
  const nodes: React.ReactNode[] = [];
  let last = 0;
  for (const match of source.matchAll(TOKEN)) {
    if (match.index > last) nodes.push(source.slice(last, match.index));
    const [whole, str, colon, literal, num] = match;
    const cls = str
      ? colon
        ? "text-info"
        : str.includes("[REDACTED]") || str.includes("••")
          ? "text-warning"
          : "text-success"
      : literal
        ? "text-primary"
        : num
          ? "text-chart-3"
          : "";
    nodes.push(
      <span key={match.index} className={cls}>
        {str ?? whole}
      </span>,
    );
    if (colon) nodes.push(colon);
    last = match.index + whole.length;
  }
  nodes.push(source.slice(last));
  return (
    <pre className={cn("max-h-96 overflow-auto rounded-xl bg-muted/60 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all ring-1 ring-border", className)}>
      {nodes}
    </pre>
  );
}
