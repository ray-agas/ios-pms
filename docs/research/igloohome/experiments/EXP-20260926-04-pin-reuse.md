# EXP-20260926-04 — Reusing a one-time custom PIN; algoPIN delete (E14 part 2)

- **Date:** 2026-09-26, 13:30–15:31 UTC (20:30–22:31 Asia/Jakarta)
- **Operator:** user, dashboard Access page (Custom PIN / Delete PIN), Doorlock `IGB4••••••d0` via Bridge `EB1X••••••32`, bench setup
- **Evidence:** `provider_jobs` #31–#49, `api_calls`, `webhook_events` in `var/iot-pms.db`. PIN X = fingerprint `90b4d3…` (never stored in clear)

## 1. The cycle (repeated 3 times, identical result)

| Step | Example (first cycle) | Result |
|---|---|---|
| Create one-time custom PIN X (job 4, `pinType 1`, start = now + ~1 min) | #34 15:06:29 | 200 → `jobStatus 0`; lock log **27** (PIN created) |
| Type X before its start minute | 15:06:49, 15:06:59 | log **16** (refused) |
| Type X after the start | 15:08:15 | log **19** (unlocked) |
| Type X again | 15:12:05 | log **16**: consumed on first use |
| Create X again | #35–#37 | **HTTP 406 "PIN (••••) is already taken"**, synchronous, no job |
| Delete X (job 5) | #38 15:11:12 | 200 → **`jobStatus 3` (PIN not found)** |
| Create X again | #39 15:12:11 | 200 → `jobStatus 0`; log 27; `pinsCurrentActive` 5 → 6 (#40) |

Cycles 2 and 3: #41 → #42 (3) → #43 (0) and #44–#46 → #47 (3) → #48 (0); #49 406 again after X was used.

## 2. Findings

| ID | Finding | Evidence |
|---|---|---|
| R1 | A one-time custom PIN is valid from its start **to the second**, and is **consumed by its first use** on the lock | HW (3/3) |
| R2 | **igloohome keeps its own reservation of a PIN per lock**, separate from what is on the lock. After the lock consumed X, igloohome still refused X with 406 (the check is synchronous, with no Bridge round trip) | API (3/3) |
| R3 | Delete (job 5) of a consumed PIN: the lock answers **`jobStatus 3`**, but igloohome **releases the reservation anyway**: the next create succeeds | API + HW (3/3) · cause HYP |
| R4 | Docs: job 4 one-time is "valid for 24 hours from start date"; duplicates are described as webhook `jobStatus 9`. Neither the reservation nor "3 still releases" is documented. Whether the reservation also ends after 24 h is **untested** | DOC-CONFLICT / NF |
| R5 | A delete job (#32, 13:36) **expired without any result** (no webhook, `completed: false` until expiry). A second delete (#33) returned 0, so the first one had **not** run on the lock | API (1 sample) |
| R6 | **E14 part 2 (algoPIN delete before activation):** confirmed working by the user (fingerprint `6b663c…`: job #33 → 0, lock log **31**, then log 16 when typed at 14:56) | API + HW |

## 3. Consequences for a PMS

- To reuse a PIN value on a lock (e.g. a fixed housekeeping code), **delete first**, and treat delete `jobStatus 3` as "cleared", not as an error.
- Better: issue a **new PIN per stay**; never depend on reusing values.
- An expired job means "outcome unknown" and, in the one sample, "not executed": re-check (lock-status job or re-send the delete) before assuming it ran.

The UI now explains this: the job page shows delete + 3 as "Not on the lock any more · igloohome released the PIN"; a 406 on create shows how to release it.
