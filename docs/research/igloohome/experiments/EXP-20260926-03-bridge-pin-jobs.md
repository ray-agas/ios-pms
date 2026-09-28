# EXP-20260926-03 — Custom PIN and Delete PIN via Bridge (E12, E14 part 1)

- **Date:** 2026-09-26, 12:49–13:08 UTC (19:49–20:08 Asia/Jakarta)
- **Operator:** dashboard operator login (user), Access page → Custom PIN / Delete PIN tabs (M5)
- **Account:** igloohome User account, TRIAL; scopes `igloohomeapi/create-pin-bridge-proxied-job`, `igloohomeapi/delete-pin-bridge-proxied-job` added; `IGLOOHOME_ENABLE_PIN_JOBS=true`
- **Target:** `Doorlock` `IGB4••••••d0` via Bridge `bridge` `EB1X••••••32`, bench setup, test device
- **Risk:** R2 (writes to / removes from lock PIN storage). Approved by the user as part of M5 ("you may continue", 2026-09-26)
- **Evidence source:** `provider_jobs`, `api_calls`, `webhook_events` in `var/iot-pms.db`. PINs never stored; matched by fingerprint (shown as `A`, `B` below)

## 1. Runs

| Job | Request | Result | Lock logs (webhook type 5) |
|---|---|---|---|
| #24 job 4 | duration PIN `A`, "Agas Custom PMS", 19:51 → 30 Sep 23:00 | 200 → webhook `jobStatus 0` (8 s) | **27 "PIN created via Bluetooth"** (PIN A), then **19 "Unlocked with PIN"** (A) at 19:51:25 |
| #25 job 10 | lock status | `pinsCurrentActive: 6` (was 5) | — |
| #26 job 10 | lock status, after algoPIN #5 (hourly, ended 19:00) had expired | `pinsCurrentActive: 5` | — |
| #27 job 4 | duration PIN `B`, start 19:58 | 200 → `jobStatus 0` | 27 (B); **16 "Wrong PIN" at 19:57:59** (1 s before its start); 19 at 19:58:06 |
| #28 job 5 | delete PIN `B` | 200 → `jobStatus 0` (6 s) | **31 "PIN deleted via Bluetooth"** (B); then **16** at 19:58:36 when B was typed again |
| #29 job 4 | PIN `A` again (duplicate) | **HTTP 406 `PIN (••••) is already taken. Please try a different pin`**, no job created | — |
| #30 job 5 | delete `B` again | 200 → **`jobStatus 3` (PIN not found)** | — |

Side observation 19:59:25–27: Bridge connection events `isOnline: false` then `true` 2 s later. Right after, the log "19 at 19:58:40 (A)" was delivered **twice** with different event ids.

## 2. Findings

| ID | Finding | Evidence |
|---|---|---|
| P1 | Job 4 with `jobData {accessName, pin, pinType: 4, startDate, endDate}` (minute resolution) writes the PIN; the lock logs type 27 and the webhook reports `jobStatus 0` | API + HW |
| P2 | The lock enforces `startDate` to the second: a custom PIN typed 1 s before its start is refused (log 16) | HW |
| P3 | Job 5 deletes the PIN (log 31, `jobStatus 0`); the PIN is refused afterwards (16). Deleting a missing PIN gives `jobStatus 3` | API + HW |
| P4 | **DOC-CONFLICT:** a duplicate custom PIN is refused **synchronously with HTTP 406** ("PIN … is already taken"), not by webhook `jobStatus 9` as `webhook-job-specific-data` says. Stoplight lists this 406 message; now confirmed | API |
| P5 | `pinsCurrentActive` counts custom PINs too (5 → 6), and an expired algoPIN releases its slot (A7 follow-up: 6 → 5 after #5 ended) | HW |
| P6 | Webhook **re-delivery after a Bridge reconnect** with a new `event.id`: our dedupe by event id does not catch it. The Activity feed now de-duplicates logs by device + type + time + PIN fingerprint | API |
| P7 | Bridge connection events do arrive (type 10), including a 2-second offline blip | API |

## 3. Not done

- E14 part 2: delete an **algoPIN** before activation (one-week rule) and confirm it no longer works.
- E13 iglooKey.

## 4. Cleanup

PIN `A` (duration, until 30 Sep 23:00) is still on the lock: delete it with job 5 when the test is done, or let it expire.
