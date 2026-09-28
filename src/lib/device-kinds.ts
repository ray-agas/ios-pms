// Plain module (no "use client") so server components get the values, not client references.
export const KIND_LABEL: Record<string, string> = {
  lock: "Lock",
  keypad: "Keypad",
  bridge: "Bridge",
  switch: "Switch",
  fob: "Key fob",
  unknown: "Device",
};

/**
 * What a keypad opens: the devices on its record's links (EK2X → SW1X; a PIN typed on the keypad unlocks the switch,
 * EXP-20260928-01). Empty for anything else.
 */
export function opensOf(view: { kind: string; linked?: string[] } | undefined, nameOf: (ref: string) => string | undefined): string[] {
  if (view?.kind !== "keypad") return [];
  return (view.linked ?? []).map(nameOf).filter((n): n is string => Boolean(n));
}

