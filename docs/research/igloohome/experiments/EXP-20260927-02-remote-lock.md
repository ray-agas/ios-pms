# EXP-20260927-02 — Emergency lock/unlock through the Bridge (E22)

- **Date:** 2026-09-27, 15:35–15:59 Asia/Jakarta (08:35–08:59 UTC)
- **Operator:** the user, from Devices → Cabin-01 → Doorlock → Emergency (super-admin; reason and password each time)
- **Target:** Doorlock `IGB4••••••d0` via Bridge `EB1X••••••32`, bench setup, not mounted on a door. `bridge-lab` and `darderdoor` were excluded.
- **Evidence:** `provider_jobs` #53–#62 (kinds `remote_lock` / `remote_unlock`), `api_calls` (`createLockJob`), `webhook_events` types 3/5/10, `audit_events` (`device.lock` / `device.unlock`, with reasons)

## 1. Runs

| Job | Action | POST | Job-complete webhook | Result |
|---|---|---|---|---|
| #53 | lock | 15:35:47 | +9.9 s | `jobStatus 0` |
| #54 | unlock | 15:38:22 | +37.7 s | 0 |
| #55 | lock | 15:39:43 | +7.9 s | 0 |
| #56 | unlock | 15:41:54 | +10.4 s | 0 |
| #57 | unlock | 15:47:14 | +11.8 s | 0 |
| #59 | lock, **Bridge being unplugged** | 15:52:10 → **200** | none | never ran (see F5) |
| #60 | lock | 15:55:57 | +8.2 s | 0 |
| #61 | lock | 15:58:23 | +7.4 s | 0 |
| #62 | unlock | 15:59:09 | +9.2 s | 0 |

## 2. Findings

| ID | Finding | Evidence |
|---|---|---|
| L1 | Jobs 1 and 2 work as documented with body `{jobType}` only (no `lockTime`). | API + HW |
| L2 | **Latency:** the lock moves about 3–8 s after the click (the user's observation). The job-complete webhook follows 7–12 s after the POST (one outlier: 38 s). | HW + API |
| L3 | **The lock logs remote actions as Bluetooth actions:** unlock = log **11** "Unlocked via Bluetooth", lock = log **37** "Locked via Bluetooth". The Bridge talks to the lock over BLE. Each is followed by log **13** "Clock synced", **even without `lockTime`**. | API (activity logs) |
| L4 | **No auto-relock** after a remote unlock on the bench (lock not mounted, no door sensor fitted). | HW |
| L4b | **User report (2026-09-27):** with the magnetic door sensor (door contact) fitted, the lock re-locks by itself: it reads the door state and re-locks after the door has been closed. Not tested here; ties in with `doorOpen` always reading 1 on the bench (no sensor). | User report · UNVERIFIED |
| L5 | A lock/door status job (10) afterwards reports the new state. | HW + API |
| L6 | Result code on success: webhook `jobStatus 0`. No failure code was seen for an executed job. | API |
| F5 | **Bridge offline:** the Bridge had flapped (connection events offline 15:49:07, online 15:50:39) and dropped again at 15:52:25. The lock POST at 15:52:10 was **accepted with 200**, then never ran: no job webhook and no lock log. The popup the user saw was iot-pms's live toast for the Bridge-offline connection event, not an API error. **A 200 does not mean the lock will move.** The documented 406 "bridge appears to be offline" only comes once igloohome knows the Bridge is gone. Same pattern as EXP-20260926-04 R5. | API + HW |
| F6 | **iot-pms bug found:** job state only moved on a GET /jobs poll, so 8 of 9 emergency jobs stayed "queued" despite their webhooks. The screen, rendered while the job was in flight, kept the buttons disabled until the page was re-rendered. **Fixed:** jobs settle from their job-complete webhook whenever they are read, and a disabled button re-enables itself when its wait ends. | code |

## 3. Consequences

- In an emergency, the operator gets feedback in about 10 s. The UI should say **"sent"** until the webhook arrives, never "done" on the 200. It does: the job page shows the result.
- Without a webhook within about 1 minute, treat the outcome as **unknown**. Check the Bridge status and run a status job before trying again.
- On the bench an unlocked lock stays unlocked (L4). With a door sensor it should re-lock (L4b, to verify once mounted, E8b). The Overview banner with "Lock again" stays useful either way.
- For audits, a remote unlock looks like a Bluetooth unlock (log 11). iot-pms's own audit row (`device.unlock` with reason and person) is what tells them apart.
- **Decision (user):** `IGLOOHOME_ENABLE_REMOTE_LOCK` stays `true` on this lab install, as a showcase of the API. Every guard above still applies.
