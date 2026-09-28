# EXP-20260927-01 — Scope ceiling: a token without `scope` (E21)

- **Date:** 2026-09-27
- **Operator:** Claude, through People → Sync in the dashboard (super-admin session), plan F3.
- **Risk:** read-only. One token was requested **without** `scope` (documented: grants every permission). It was used for a single `GET /server-health` and then discarded. It was held in memory only and never cached, logged or used for another call.
- **Evidence:** `scope_syncs` row 1; `api_calls` (`serverHealth`, 200); `audit_events` (`scopes.sync`).

## 1. Result

`server-health` listed **20** scopes for our client:

| Scope | In the igloohome scope list (research 03 §3)? |
|---|---|
| `get-devices`, `get-properties`, `get-device-activity`, `get-job-status` | yes |
| `get-battery-level-bridge-proxied-job`, `get-device-status-bridge-proxied-job`, `get-activity-logs-bridge-proxied-job` | yes |
| `algopin-onetime`, `algopin-hourly`, `algopin-daily`, `algopin-permanent` | yes |
| `create-pin-bridge-proxied-job`, `delete-pin-bridge-proxied-job` | yes |
| `lock-bridge-proxied-job`, `unlock-bridge-proxied-job` | yes |
| `get-master-pin`, `create-ekey-access`, `update-device` | yes |
| **`store-device-activity`** | **no**; documented only as required by `POST /devices/{id}/activity` |
| **`edit-pin-bridge-proxied-job`** | **no**; listed only in the iglooworks scope list (job 3 documented as not supported) |

All prefixed `igloohomeapi/`. No `openid`/`profile`. No scope for iglooKey `/pass` or algoPIN passage.

## 2. Findings

| ID | Finding | Evidence |
|---|---|---|
| S1 | Omitting `scope` gives a token with every permission of the client; `server-health` then lists all of them. It is a working way to discover the ceiling. | API |
| S2 | Our client (trial account) is granted all 18 documented igloohome scopes plus 2 more (see table). Research Q4 is closed for this account. | API |
| S3 | The gap noted in research 03 is resolved: `store-device-activity` exists and is granted, although the igloohome scope list omits it. | API (resolves DOC-CONFLICT) |
| S4 | `edit-pin-bridge-proxied-job` is granted on igloohome too, yet job 3 is documented as not supported. Not tested; iot-pms has no feature for it. | API · behavior NF |
| S5 | Unchanged: scopes are per operation, not per device. Device-level limits stay in iot-pms (the device registry). | DOC + API |

## 3. Consequences in iot-pms

- The ceiling (20) is stored; super-admins have all of it. Operators get the 4 read scopes plus what a super-admin assigns (People → Scopes).
- **Tokens only carry scopes that an iot-pms feature uses.** Lock/unlock, master PIN, eKey, update-device, store-activity, edit-PIN and job 15 are never put in a token, even for a super-admin, although igloohome would grant them. Assigning them grants nothing until a feature exists.
- Open: whether requesting a scope the client is **not** entitled to fails (`invalid_scope`) or is silently dropped. It cannot be tested here, because this client is entitled to all of them.
