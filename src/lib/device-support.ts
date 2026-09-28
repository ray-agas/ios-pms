import type { DeviceKind, JobKind } from "@/server/domain/models";

// What the switch (SW1X) and keypad (EK2X) really do with each Bridge job, proven on hardware in G1
// (EXP-20260928-01). igloohome documents Bridge proxied jobs for locks only. "works" combinations are regular
// features now; the rest are refused with the reason below (a super-admin can still re-test them as an experiment).

export type Support = "works" | "no_effect" | "no_result";

export interface SupportEntry {
  support: Support;
  /** Plain-words reason, shown on hover. */
  note: string;
}

const HW = "EXP-20260928-01";

export const DEVICE_JOB_SUPPORT: Partial<Record<DeviceKind, Partial<Record<JobKind, SupportEntry>>>> = {
  switch: {
    lock_battery: { support: "works", note: `Battery level via the Bridge (result 0, ${HW})` },
    lock_status: { support: "works", note: `Lock state via the Bridge (result 0, ${HW})` },
    remote_unlock: { support: "works", note: `The bedlock opens; it re-locks by itself 4–6 s later (log 48, ${HW})` },
    remote_lock: { support: "works", note: `The bedlock locks (${HW}); usually not needed, it re-locks by itself within 6 s` },
    pull_logs: { support: "works", note: `Activity logs handed over and deleted from the switch (${HW})` },
    pin_create: { support: "no_result", note: `The switch cannot hold PINs. Put the PIN on its keypad (Keypad-Bedlock) instead (${HW})` },
    pin_delete: { support: "no_result", note: `The switch holds no PINs; delete the PIN from its keypad instead (${HW})` },
  },
  keypad: {
    lock_battery: { support: "works", note: `Battery level via the Bridge (result 0, ${HW})` },
    pin_create: { support: "works", note: `The keypad stores the PIN; typing it opens the linked switch (log 19 on the keypad, 11 then 48 on the switch, ${HW})` },
    pin_delete: { support: "works", note: `The keypad removes the PIN (result 0, log 31, ${HW})` },
    remote_unlock: { support: "no_effect", note: `The keypad accepts it and logs "Unlocked via Bluetooth", but it has no motor: nothing opens. Unlock the switch instead (${HW})` },
    remote_lock: { support: "no_effect", note: `The keypad accepts it and logs "Locked via Bluetooth", but it has no motor: nothing moves. Lock the switch instead (${HW})` },
    lock_status: { support: "no_result", note: `No result from the keypad: it has no lock state (${HW})` },
    pull_logs: { support: "no_result", note: `No result from the keypad; its logs still arrive through the webhook (${HW})` },
  },
};

export const supportOf = (kind: DeviceKind, job: JobKind): SupportEntry | undefined => DEVICE_JOB_SUPPORT[kind]?.[job];
