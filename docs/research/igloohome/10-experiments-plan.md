# Recommended API and Hardware Experiments

Research date: 2026-09-25. Nothing in this plan has been executed. Every experiment needs the preconditions in §1. Risk levels as in [02-endpoint-inventory.md](02-endpoint-inventory.md#read-this-first).

## 1. Preconditions (all experiments)

- [ ] Product/account type confirmed (blocker B1).
- [ ] Client ID/Secret stored only in a local, git-ignored `.env`; never pasted into docs, logs, or chat.
- [ ] Target **test lock** and **Bridge** identified by `deviceId`, recorded redacted (e.g. `IGM4••••••a1`), and confirmed **not guest-facing** (B4).
- [ ] Physical access to the test lock during any R2/R3 experiment, and a fallback way in (master PIN known to the operator, or physical key).
- [ ] For webhook experiments: HTTPS receiver reachable from the internet, URL registered in portal, public key obtained (B6, B7).
- [ ] Every request goes through a script that redacts `Authorization`, `client_secret`, `pin`, `bluetoothGuestKey`, `admin_key` before printing.

## 2. Phase A — read-only, no device contact (R0)

| ID | Goal | Request | Expected (from docs) | Resolves |
|---|---|---|---|---|
| E1 | Obtain token with **explicit read-only scopes** | `POST auth.igloohome.co/oauth2/token`, `scope=igloohomeapi/get-devices igloohomeapi/get-properties igloohomeapi/get-device-activity igloohomeapi/get-job-status` | `access_token` JWT, `expires_in: 86400` | D3, token claims |
| E2 | Resolve base URL; read account state | `GET /server-health` on `api.igloodeveloper.co/igloohome` and on `api.igloohome.co/home` | 200 with `flow`, `scopes`, `tier`, `endsAt` on at least one | D1, B5 |
| E3 | Device inventory and real schema | `GET /devices` (default), then `?type=Bridge`, `?type=Lock`, `?limit=1`, pagination; `GET /devices/support-pins`; `GET /devices/{testLock}` without extra query params | Lock, Bridge present; `linkedDevices` shows relationship | U1–U3, U9 baseline |
| E4 | Properties and history | `GET /properties`, `/properties/{id}`, `/properties/{id}/devices`, `GET /devices/{testLock}/activity?limit=20` | Timezone present; activity entries | U1, 409 risk |
| E4b | Scope enforcement | Call `GET /devices/{testLock}/masterpin` **with the E1 token** (no master-PIN scope) | `403` — proves least-privilege works, no secret returned | Scope model |

Stop condition: any `402` → stop, record, report subscription state.

## 3. Phase B — Bridge read jobs and webhooks (R1)

| ID | Goal | Request | Expected | Side effect | Resolves |
|---|---|---|---|---|---|
| E5 | Webhook receiver + signature check | Passive; wait for any event | Signature verifies with vendor algorithm | none | D9–D12, D19 |
| E6 | Bridge diagnostics | Once: `POST /devices/{bridgeId}/jobs {"jobType":10}`; second call within 5 min to observe `429` + `Retry-After` | `jobId`; webhook with Wi-Fi fields, `locksCurrentAdded` | Bridge contact | Rate limit, capacity |
| E7 | Live battery | `POST /devices/{testLock}/jobs/bridges/{bridgeId} {"jobType":9}`; poll `GET /jobs/{jobId}`; then `GET /devices/{testLock}` | Webhook `batteryLevel`; check whether device list value changes | Wakes lock | U4, U9, job TTL |
| E8 | Live lock/door status; out-of-range behaviour | Job 10 normally; then repeat with lock moved out of Bridge BLE range (or batteries removed from a **test** lock) | Normal: `lockOpen`/`doorOpen`. Out of range: record exact failure mode | Wakes lock | U4 |
| E9 | Bridge offline behaviour | Unplug Bridge; observe webhook type 10 `isOnline:false`; send job 9 → expect `406`; replug → `isOnline:true` | As documented | Bridge downtime (test Bridge only) | U16 |

Needed scopes for Phase B: add `get-battery-level-bridge-proxied-job`, `get-device-status-bridge-proxied-job`.

## 4. Phase C — credential creation on the test lock (R2)

Explicit approval required before each experiment. Record the expected effect first (CLAUDE.md §6).

| ID | Goal | Request | Expected | Rollback |
|---|---|---|---|---|
| E10 | algoPIN generation behaviour (**do not enter PINs yet**) | `POST algopin/hourly` for tomorrow 10:00–12:00, variance 1; repeat identical request; repeat with variance 2; try a `startDate` with minutes `:30`; try a past `startDate` | PIN + `pinId`; identical request returns same PIN (HYP); record granularity errors | Unused algoPINs expire; delete via E14 if needed. **Keep start < 256 h ahead.** |
| E11 | algoPIN activation on hardware | Generate one-time algoPIN valid now; enter on keypad; then check `GET /devices/{testLock}/activity` and webhook type 5 | Lock opens; log type 20; record delay until server log appears | Lock re-locks (auto-relock) — confirm manually |
| E12 | Custom PIN via Bridge | Job 4 duration PIN (4–6 digits) 1 h window; webhook result; enter PIN on lock; repeat same PIN → expect status 9; job 5 delete → status 0; delete again → status 3 | As documented | Delete job 5 |
| E13 | iglooKey token | `POST /pass/online` for test lock, 1 h window; open `shareableUrl` on a test phone; `PATCH` window; `DELETE` | 201 / 422 if unsupported; record guest UX | `DELETE /pass/{id}` |
| E14 | algoPIN deletion limits | Generate hourly algoPIN starting in 2 h, delete via job 5; generate one starting ~8 days ahead, delete; (optional) ~11 days ahead | Determine real limit (one week vs 256 h) | None if delete fails → PIN stays valid until expiry; choose short windows |

Scopes for Phase C: `algopin-onetime`, `algopin-hourly`, `create-pin-bridge-proxied-job`, `delete-pin-bridge-proxied-job`, `get-job-status`.

## 5. Phase D — physical actuation (R3) — last, explicit approval, person at the door

| ID | Goal | Request | Safety |
|---|---|---|---|
| E15 | Remote unlock and lock | Job 2 then job 1 on test lock, one at a time, with a person present; measure latency from POST to webhook to physical movement | No automation, no retry; abort if webhook not received in 60 s and check the door physically |

## 6. Explicitly not planned (need separate approval and justification)

| Operation | Reason |
|---|---|
| `GET /devices/{id}/masterpin` with real scope | Returns top-secret value; only if a feature requires it |
| `POST /devices/{id}/ekey` | Returns BLE key material; needs a BLE client to be useful |
| Bridge job 15 (pull activity logs) | **Deletes logs from the lock** after retrieval |
| Passage algoPIN | Leaves the lock open |
| `PUT /devices/{id}` | Semantics unclear; overwrites server data |
| `POST /devices/{id}/activity` | Writes audit data; SDK-internal |
| Any bulk or multi-device operation | CLAUDE.md §6 |
| Any operation on a guest-facing lock | CLAUDE.md §6 |

## 7. Experiment record template (CLAUDE.md §12)

Store records under `docs/research/igloohome/experiments/EXP-YYYYMMDD-NN.md`.

```markdown
# EXP-20260926-01 — <short title>

- Date/time (with timezone):
- Environment / base URL:
- Account type / tier (from server-health):
- Target: lock `IGM4••••••a1`, bridge `EB1X••••••7c`   (redacted)
- Purpose:
- Preconditions checked:
- Operation (endpoint ID, e.g. H28 job 9):
- Sanitized request:
- Expected result (written before running):
- Actual result:
- HTTP status:
- Sanitized response:
- Webhook(s) received (sanitized, with arrival time):
- Changed physical device state? yes/no — describe
- Errors / limitations:
- Evidence upgrade: which inventory entries move from DOC to API/HW:
- Follow-up questions:
```

## 8. Monitoring recommendation

The vendor docs change (supported-devices "last updated" dates; iglooworks reference contains 2026 examples). Re-download `llms-full.txt` periodically and diff against `sources/2026-09-25/` using the stored SHA-256 as a quick changed/unchanged check. A monthly manual check is enough at this stage; automate only if the integration goes to production.

---

## 9. Execution procedure for the test site (added 2026-09-25 with the implementation plan)

Context: igloohome **User** account; test site = one Bridge, one door lock with built-in keypad (Bridge-linked in app), a linked keypad configuration, one switch with keypad readers for an internal bedlock ([device-topology.md](../../architecture/device-topology.md)). No guests depend on these devices. Being a test device does **not** waive the rules below.

### 9.1 New / refined experiments

| ID | Goal | Milestone | Risk |
|---|---|---|---|
| E3 | Discover every device; record `type`, prefix, `linkedDevices`, `homeId`, `batteryLevel`, `lastSync`, `lockStatus` for each (answers T1–T8 in device-topology §4) | M2 | R0 |
| **E3b** | Record the mobile-app view of the same devices (names, what is linked to what, which keypad drives what) in `docs/architecture/test-site-topology.yaml`, then diff with E3 | M2 | none (manual) |
| E6–E8 | As §3, on the door lock and Bridge only. **Not on the switch** (no documented Bridge operation for it) | M4 | R1 |
| **E10b** | Keypad representation for PINs: generate an hourly algoPIN against the **door lock** and, separately, against the **linked keypad** ID (if `support-pins` lists it). Do not enter yet | M5 | R2 |
| **E11b** | Enter the E10b PINs on the built-in keypad and on the linked keypad; record which combination opens the door | M5 | R2 + physical |
| **E-SW** | Switch/bedlock: **no API experiment planned.** First get igloohome support's answer on SW1X API support. If support confirms an operation, write a separate experiment with its own approval | — | — |

### 9.2 Pre-flight checklist (every experiment that contacts a device)

1. Target device ID confirmed from E3 output and present in `IGLOOHOME_ALLOWED_DEVICE_IDS`.
2. Expected result and side effects written in the record **before** running.
3. Lock battery ≥ 30 % (from E3/E7) — low battery makes BLE jobs fail and makes lockout recovery harder.
4. Bridge online (targeted job or app shows online).
5. Recovery path ready (§9.4).
6. Only one experiment in flight per device.

### 9.3 Roles and physical presence

| Experiment | People | Physical conditions |
|---|---|---|
| E1–E4b, E3 | 1 operator (terminal) | None |
| E3b | 1 person with the igloohome app | App logged in to the same account |
| E6, E7 | 1 operator | Bridge powered; lock within the Bridge's BLE range as installed |
| E8 | 2: operator + person at the door | Door can be opened/closed; run once door closed, once door open |
| E9 | 2: operator + person at the Bridge | Can unplug/replug the Bridge |
| **E11, E11b, E14** | **2: operator (terminal) + door tester** | Door tester stands at the door with: phone with the igloohome app logged in, the lock's **master PIN obtained from the app/portal (never via our API in these experiments)**, and physical key if the model has one. Door must be one that can be left open or re-secured by hand |
| E10, E10b, E12 | 1 operator (+ door tester if PIN will be entered) | PIN windows ≤ 2 h, starting within the next hour |

### 9.4 Safe procedure for E11 / E14 (credential on hardware)

1. **Before:** operator writes the record (target, PIN type, window, expected log type, cleanup). Door tester confirms presence and recovery tools (app, master PIN, key).
2. **Window:** hourly algoPIN, start = current hour, end = start + 1 h or 2 h (hour-aligned, per Stoplight rule). Short windows mean a failed deletion expires by itself soon.
3. **E11:** door tester enters the PIN once on the built-in keypad → door opens → tester lets the lock auto-relock (or relocks by hand) and confirms it is locked. Operator notes the time; checks activity (`GET /devices/{id}/activity`) until the entry appears; records latency.
4. **E14:** operator creates Bridge job 5 with the PIN value; polls job status; door tester re-enters the PIN → it must be rejected.
5. **Cleanup:** confirm lock is locked; confirm no test PIN is still valid (either deleted or its window has ended); record both.
6. **Failure recovery:**
   - Door will not relock → door tester relocks via app or by hand; stop the experiment.
   - Lock does not respond → door tester uses the app over Bluetooth, then master PIN, then key; operator stops sending jobs.
   - Delete job fails or outcome unknown → treat the PIN as **still valid** until its window ends; record it; do not retry the delete automatically.
   - Wrong-PIN lockout triggered → wait the lockout period; record it (log type 16).
7. **Never** during these experiments: lock/unlock jobs, master PIN via API, permanent PINs, windows longer than 2 h.
