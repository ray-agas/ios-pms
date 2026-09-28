import { describe, expect, test } from "bun:test";

import { provenUnsupported, supportOf } from "@/lib/device-support";

// Pickers leave out device kinds proven unable to do a job (EXP-20260928-01); proven ones stay.

describe("proven device support", () => {
  test("the switch is not a PIN target; the keypad is", () => {
    expect(provenUnsupported("switch", ["pin_create", "pin_delete"])).toBe(true);
    expect(provenUnsupported("keypad", ["pin_create", "pin_delete"])).toBe(false);
  });

  test("the keypad is not a lock/unlock target (no motor); the switch is", () => {
    expect(provenUnsupported("keypad", ["remote_lock", "remote_unlock"])).toBe(true);
    expect(provenUnsupported("switch", ["remote_lock", "remote_unlock"])).toBe(false);
    expect(supportOf("keypad", "remote_unlock")?.note).toContain("no motor");
  });

  test("locks have no entry (documented by igloohome), so they are never hidden", () => {
    expect(provenUnsupported("lock", ["pin_create", "pin_delete"])).toBe(false);
    expect(provenUnsupported("lock", ["remote_lock", "remote_unlock"])).toBe(false);
  });
});

describe("what a keypad opens", () => {
  test("a keypad lists the devices on its links; other kinds list nothing", async () => {
    const { opensOf } = await import("@/lib/device-kinds");
    const names: Record<string, string> = { "SW1X••••••30": "switch-bedlock" };
    expect(opensOf({ kind: "keypad", linked: ["SW1X••••••30", "EB1X••••••32"] }, (r) => names[r])).toEqual(["switch-bedlock"]);
    expect(opensOf({ kind: "lock", linked: ["SW1X••••••30"] }, (r) => names[r])).toEqual([]);
    expect(opensOf(undefined, (r) => names[r])).toEqual([]);
  });
});
