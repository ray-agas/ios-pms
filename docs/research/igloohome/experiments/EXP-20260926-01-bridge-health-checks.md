# EXP-20260926-01 — Bridge health checks (E6, E7, E8)

- **Date:** 2026-09-26, 04:09–04:23 UTC (11:09–11:23 Asia/Jakarta)
- **Operator:** dashboard operator login (user); run from the iot-pms dashboard (M4 health-check flow)
- **Account:** igloohome User account (client credentials), TRIAL tier
- **Targets (test devices, allowlisted; no guests):** Bridge `bridge` `EB1X••••••32`; lock `Doorlock` `IGB4••••••d0` (Deadbolt 2S, built-in keypad), room `oc-bbx`
- **Not targeted:** `bridge-lab` / `darderdoor` (reported offline by the user), `Keypad-Bedlock` `EK2X••••••81`, `switch-bedlock` `SW1X••••••30` (see §5)
- **Risk:** R1. Jobs 9 and 10 wake the lock over Bluetooth; no lock movement, no credential change
- **Preconditions:** `IGLOOHOME_ENABLE_BRIDGE_JOBS=true`; all 6 devices in `IGLOOHOME_ALLOWED_DEVICE_IDS`; Doorlock battery 100 %; webhook receiver live (signature `no_key`, public key still pending)
- **Evidence source:** `provider_jobs`, `api_calls` and `webhook_events` in `var/iot-pms.db` (local, not committed). Values below are copied from there; device IDs masked. Wi-Fi SSID, IP and DNS are shown: the user judged them harmless for this lab network (2026-09-26).

## 1. Runs

| # | Experiment | Request | Created (UTC) | POST | Polls | Polled `completed` / `jobStatus` | Webhook `jobStatus` (received) | Result fields |
|---|---|---|---|---|---|---|---|---|
| 1 | E6 Bridge diagnostics | `POST /devices/{bridgeId}/jobs {"jobType":10}` | 04:09:57 | 200 `{jobId}` | 1 | `true` / `0` | `0` (04:10:06) | see §2 |
| 2 | E7 lock battery | `POST /devices/{lockId}/jobs/bridges/{bridgeId} {"jobType":9}` | 04:12:54 | 200 | 1 | `true` / `0` | `0` (04:13:01) | `batteryLevel: 100` |
| 3 | E8 lock status | job 10 (proxied) | 04:13:55 | 200 | 1 (+1 timed out, 15 s, vendor) | `true` / `0` | `0` (04:14:04) | `lockOpen: true`, `doorOpen: 1`, `pinsMaxCapacity: 199`, `pinsCurrentActive: 4` |
| 4 | E8 lock status | job 10 (proxied), after the user toggled the lock by hand | 04:15:42 | 200 | 1 | `true` / `0` | `0` (04:15:48) | `lockOpen: false`, `doorOpen: 1`, same PIN counts |
| 5 | E8 lock status | job 10 (proxied), toggled back | 04:20:27 | 200 | 5 | `false`/`1` ×4, then `true`/`0` | `0` (04:20:47) | `lockOpen: true`, `doorOpen: 1` |
| 6 | E6 rate limit | job 10 (targeted), 2 min 18 s after run 5 | 04:22:45 | **429** `Too many requests. Please try again after 163 seconds.` | — | — | — | Not retried (client + app); `Retry-After` stored and honoured by the app guard |

Timing: POST → job completed in igloohome ≈ 7–20 s; webhook arrived ≈ 1–2 s after the event's own `date` and 0–1 s before or after the completing poll.

## 2. Bridge diagnostics payload (run 1)

`GET /jobs` `jobResponse.opResult` and the webhook `data` carry the same fields (webhook: flat; poll: under `opResult`):

| Field | Value | Notes |
|---|---|---|
| `result` | 0 | Only in `opResult` |
| `wifiNetworkStatus` | 0 | = "Connected" (WIFI_STATUS table, now API) |
| `wifiNetworkSsid`, `wifiNetworkIpaddr`, `wifiNetworkDns` | `HOUSE.IN`, `192.168.100.12`, `192.168.100.1` | Lab network; private (RFC 1918) addresses |
| `wifiNetworkChannel`, `wifiNetworkBand` | 6, 0 | Band enum undocumented (HYP 0 = 2.4 GHz) |
| `wifiNetworkRssi` | −35 dBm | |
| `lastHeartbeatAttempt` | Unix seconds | |
| `lockRssiList[]` | `{bluetoothName, rssi}` ×4: IGB4 −80, EK2X −78, SW1X −72, IGB4 −80 | **`bluetoothName` is the full device ID.** The Doorlock appears twice |
| `locksMaxCapacity` / `locksLinkCount` | 10 / 4 | 4 links for 3 distinct devices (matches the duplicate IGB4 entry) |
| `hasLogs` | 0 | |

## 3. Findings

| ID | Finding | Evidence |
|---|---|---|
| **D23 resolved** | Polled `GET /jobs` `jobResponse.jobStatus` is the job **state**: `1` while `completed: false`, `0` when `completed: true` (run 5, 4 polls). This matches the Stoplight table (0 completed / 1 pending). Read with the webhook table, 1 would have meant "generic failure", which is wrong. The webhook `data.jobStatus` is the job **result**: `0` = success in all 5 completed runs. `2` (expired) not observed | API |
| F1 | Job-complete webhook shape for jobs 9/10: `{jobId, jobStatus, …result fields}` flat in `data`; `proxyId` = Bridge, `product.id` = lock | API |
| F2 | Result fields are also returned by `GET /jobs` under `jobResponse.opResult`, so a missed webhook loses nothing | API |
| F3 | `jobType` in `GET /jobs` is a string: `GET_STATUS` (job 10, both proxied and targeted), `GET_BATTERY_LEVEL` (job 9) | API |
| F4 | `expiryDate` ≈ POST time + 2 min | API |
| F5 | Job 10 (proxied) returns `lockOpen` as a boolean (changed with the manual toggle) and `doorOpen` as the **number `1`** in all 3 runs. **DOC-CONFLICT (D24):** the docs define both as booleans. `webhook-job-specific-data` and `webhooks-bridge-event` (same example on the iglooworks page) say `lockOpen` false = locking mechanism not open, true = open; `doorOpen` false = door closed, true = door open. Their only example is `lockOpen: false, doorOpen: true`. Stoplight does not define either field. Physical door state during the runs was not recorded, so `1` = open cannot be confirmed yet (see E8b) | HW (lockOpen) · DOC-CONFLICT (doorOpen type) |
| F6 | Job 10 (proxied) also returns `pinsMaxCapacity: 199` (matches the documented 199-slot limit) and `pinsCurrentActive: 4` | API |
| F7 | The 429 `Retry-After` (163 s) ends exactly 5 min after **run 5**, a proxied job 10 on the same Bridge, not after run 1. HYP: the documented 1-per-5-min limit counts every job 10 through the Bridge. The app guard now counts proxied lock-status jobs too | API (429) · HYP (cause) |
| F8 | Bridge Bluetooth scan sees the keypad and the switch (`lockRssiList`), so both are linked to the Bridge at radio level | API |
| F9 | Vendor latency was high during the session: 1–6.5 s per call, one 15 s `GET /jobs` timeout (retried, then succeeded). No 429 on GETs | API |

## 4. Side effects and cleanup

- The lock was woken 4 times. No movement from the jobs; the user moved the lock by hand between runs 3–5. No PIN, credential or setting changed.
- Cleanup: none needed.

## 5. Why the keypad and the switch were not targeted

- **Keypad-Bedlock (EK2X):** the docs describe proxied jobs as targeting a **lock** via the Bridge; job 10 returns lock fields (`lockOpen`, `doorOpen`). No documented job targets a keypad, and the EK2X model is not in the supported-devices table.
- **switch-bedlock (SW1X):** the API types it `Lock` and reports `lockStatus`, but the docs have **no Bridge or REST operation for the switch**. The experiment plan excluded it (§3: "Not on the switch").
- F8 shows the Bridge reaches both over Bluetooth, so jobs 9/10 on them are **plausible but undocumented** (HYP). Candidate follow-up: E15 (switch) and E16 (keypad), job 9 first (E10–E14 are taken by the M5 credential experiments), only with explicit approval.

## 6. Follow-up questions

1. **E8b (blocked by hardware, 2026-09-26):** the user ran job 10 again, locked and unlocked; `lockOpen` followed (false = locked, matches "Lock: closed"), `doorOpen` stayed `1`. The lock is **not mounted on a door yet** (bench setup), so the door state cannot change. Repeat after installation: door shut vs open.
2. Why `locksLinkCount` is 4 with 3 distinct devices (built-in keypad counted as a link?).
3. Is the 5-minute limit per Bridge for all job 10s (F7)? Confirm with support.
4. `wifiNetworkBand` enum.
5. Jobs 9/10 on SW1X and EK2X (E15/E16).
