// Plain module (no "use client") so server components get the values, not client references.
export const KIND_LABEL: Record<string, string> = {
  lock: "Lock",
  keypad: "Keypad",
  bridge: "Bridge",
  switch: "Switch",
  fob: "Key fob",
  unknown: "Device",
};

/** "Keypad-Bedlock · keypad for switch-bedlock": a keypad opens what it is linked to (EK2X → SW1X, device-topology.md). */
export function targetName(view: { name?: string; kind: string; linked?: string[] } | undefined, ref: string, nameOf: (ref: string) => string | undefined): string {
  const name = view?.name ?? ref;
  if (view?.kind !== "keypad" || !view.linked?.length) return name;
  const opens = view.linked.map(nameOf).filter(Boolean);
  return opens.length ? `${name} · keypad for ${opens.join(", ")}` : name;
}

