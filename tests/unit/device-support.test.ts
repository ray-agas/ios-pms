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
