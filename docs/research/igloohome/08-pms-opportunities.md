# PMS Feature Opportunities

Research date: 2026-09-25. Evidence labels: see [README](README.md#evidence-labels).

These are **product ideas**, not confirmed capabilities. Each row states which vendor capability it depends on and how strong that evidence is. Nothing below is `API`- or `HW`-confirmed yet.

Scope column:
- **MVP** — fits the first research dashboard: read-only or low-risk, testable with one lock + one Bridge.
- **Next** — needs confirmed mutating operations or webhooks first.
- **Later** — needs extra hardware, account type, mobile app, or business decisions.
- **App-side** — mostly our own logic; vendor API only supplies data.

## 1. Inventory, mapping, health

| Feature | Vendor capability | Evidence | Bridge | Extra hardware | Extra permissions | Risks | Scope |
|---|---|---|---|---|---|---|---|
| API connection status panel (flow, scopes, tier, subscription end) | `GET /server-health` | DOC-PARTIAL | No | — | none | Low | **MVP** |
| Device inventory (locks, keypads, Bridges, fobs) | `GET /devices`, `/devices/{id}` | DOC | No | — | `get-devices` | Low | **MVP** |
| Property list and per-property devices | `GET /properties`, `/properties/{id}/devices` | DOC | No | — | `get-properties` | Low | **MVP** |
| Room ↔ lock mapping (Bobobox room/cabin → `deviceId`) | none (app-side) + device list | App-side | No | — | — | Mapping drift if device re-paired | **MVP** (App-side) |
| Bridge ↔ lock topology view | `linkedDevices` / `linkedAccessories` | DOC-PARTIAL | No | — | `get-devices` | Field may be missing on igloohome API | **MVP** |
| Capability badges per device (algoPIN yes/no, Bridge-linked, keycard-capable) | `/devices/support-pins` + prefix table | DOC | No | — | `get-devices` | Prefix table last updated 2025-07-16 | **MVP** |
| Battery dashboard (cached) + low-battery alerts | `batteryLevel`, `lastSync` | DOC-PARTIAL (freshness HYP) | No | — | `get-devices` | Stale values look current — must show `lastSync` | **MVP** |
| Live battery check | Bridge job 9 | DOC | **Yes** | Bridge | `get-battery-level-bridge-proxied-job` | Wakes lock, battery cost | Next |
| Live lock/door state | Bridge job 10 | DOC | **Yes** | Door sensor for `doorOpen` (model NF) | `get-device-status-bridge-proxied-job` | Rate/collision | Next |
| Bridge connectivity monitor (online/offline, Wi-Fi diagnostics) | webhook type 10 + targeted job 10 | DOC | **Yes** | — | status scope; webhook URL | 1 req / 5 min limit | Next |
| Stale-device detector (no sync for N days) | `lastSync` | DOC-PARTIAL | No | — | `get-devices` | — | MVP (App-side) |
| Onboarding status tracker (paired? linked to Bridge? property timezone set?) | device list + `409 timezone` signal | DOC | No | — | — | Cannot *perform* onboarding | Next |
| Guided field onboarding (pair, calibrate, link, Wi-Fi) | BLE SDK | DOC (SDK) | For link | Phone | Private SDK access | High: mis-pairing, credential wipe on unpair | **Later** |
| Firmware status / updates | BLE SDK only | DOC (SDK) | EB1 via cloud job | Phone | SDK | Bricking risk, battery ≥ 20% | Later |

## 2. Guest access lifecycle

| Feature | Vendor capability | Evidence | Bridge | Extra hardware | Extra permissions | Risks | Scope |
|---|---|---|---|---|---|---|---|
| Issue stay PIN (offline, no Bridge) | algoPIN hourly (≤ 672 h) / daily | DOC | No | — | `algopin-hourly`/`-daily` | **24 h activation** (late arrival lockout); cannot revoke without Bridge; 256 h delete rule | **Next** (first mutating test) |
| One-time entry PIN (e.g. luggage drop, viewing) | algoPIN one-time | DOC | No | — | `algopin-onetime` | Validity window NF | Next |
| Pre-arrival provisioning scheduler | algoPIN at T-minus X; custom PIN job | DOC + App-side | algoPIN no / custom yes | — | as above | Issue too early → undeletable (256 h) | Next |
| Check-in activation | algoPIN activates on first use; custom PIN `startDate` | DOC | Depends | — | — | Guest confusion about "first use within 24 h" | Next |
| Check-out revocation | Bridge job 5 (delete PIN by value); iglooKey `DELETE /pass/{id}` | DOC | **Yes** (PIN) | Bridge | `delete-pin-bridge-proxied-job` | algoPIN delete limits; must store PIN value encrypted | Next |
| Stay extension / date change | New algoPIN (+ delete old) or iglooKey `PATCH` | DOC | Optional | — | as above | Two valid PINs overlap | Next |
| Guest-chosen or memorable PIN | Bridge job 4 custom PIN (4–6 digits) | DOC | **Yes** | Bridge | `create-pin-bridge-proxied-job` | Duplicate (status 9), storage full (12), 199 limit | Next |
| Mobile key via link (no app build on our side) | iglooKey token `shareableUrl` | DOC-PARTIAL | NF | Guest phone | none listed | UX unknown; device support unknown (422) | Later (research E13) |
| Bluetooth guest key inside our own app | ekey + private BLE SDK | DOC | No | Guest phone + our app | `create-ekey-access`, SDK | igloohome has no ekey revoke | Later |
| Credential expiration monitor | our records of issued credentials | App-side | No | — | — | Must reconcile with lock logs | MVP (App-side) |
| Access troubleshooting console ("guest says PIN fails") | activity logs (wrong PIN type 16), algoPIN rules, lock time | DOC | Logs via Bridge/phone | — | `get-device-activity` | Raw logs contain PIN values — redact | Next |
| Passage mode for events / group check-in | passage algoPIN | DOC (newer firmware) | No | Compatible firmware | none listed | **Door left open** — security | Later, gated |

## 3. Staff, vendor and emergency access

| Feature | Vendor capability | Evidence | Bridge | Risks | Scope |
|---|---|---|---|---|---|
| Housekeeping access (per shift / per room) | one-time or hourly algoPIN per staff per room | DOC | No | Variance limits (3–5 per identical window); many PINs per lock vs 199 rule | Next |
| Maintenance / vendor temporary access with reason | one-time algoPIN + our audit record | DOC + App-side | No | Cannot revoke early without Bridge | Next |
| Permanent staff PIN | permanent algoPIN or permanent custom PIN | DOC | Custom: yes | Hard to revoke; staff turnover | Later (policy needed) |
| Emergency remote unlock | Bridge job 2 | DOC | **Yes** | **Physical; must require confirmation + second person + reason**; never auto-retry | Later, gated |
| Emergency master PIN reveal | `GET /devices/{id}/masterpin` | DOC | No | Top-secret; log reveal, show once | Later, gated |
| Remote lock (forgot to lock) | Bridge job 1 | DOC | **Yes** | Could lock a guest in/out | Later, gated |

## 4. Audit, monitoring, operations

| Feature | Vendor capability | Evidence | Bridge | Risks | Scope |
|---|---|---|---|---|---|
| Our-app audit trail (who issued/revoked what, why) | none (App-side) | App-side | — | Must not store raw PINs in plain text | **MVP** (App-side) |
| Lock activity timeline per room | `GET /devices/{id}/activity` | DOC | Data arrives via sync/Bridge | Freshness depends on Bridge/phone | **MVP** (read-only) |
| Security alerts: break-in attempt (53), repeated wrong PIN (16), invalid card (57) | webhook type 5 / activity log | DOC | **Yes** for push | False positives | Next |
| Failed-operation monitor (jobs FAILED/EXPIRED, 406 offline) | job status + webhooks | DOC | Yes | — | Next |
| Request/response inspector with redaction | our proxy | App-side | — | Must redact tokens, PINs, keys, master PIN | **MVP** (required by CLAUDE.md §7) |
| Experiment log | our records | App-side | — | — | **MVP** |
| Capability documentation view (this research, in-app) | — | App-side | — | — | MVP |
| Billing/usage estimate (active locks × USD 2) | device count | DOC-PARTIAL | — | "Active lock" definition NF | Later |

## 5. Multi-property, roles, partners

| Feature | Vendor capability | Evidence | Risks | Scope |
|---|---|---|---|---|
| Multi-property view | properties endpoint | DOC | — | MVP |
| Role-based admin (front desk vs ops vs admin) | **none** — vendor scopes are per-operation, not per-device | NF (vendor) → App-side | Must be enforced by us | Next (App-side) |
| Least-privilege service tokens (read-only token for dashboard, separate token for mutations) | scoped client-credentials tokens | DOC | — | **MVP** (design choice) |
| Partner / franchise accounts (manage other owners' locks) | iglooconnect auth code flow | DOC | Needs partnership; 365-day refresh expiry | Later |
| Department-based segregation | iglooworks departments | DOC (iglooworks only) | Different product | Later |
| Bulk operations (issue PINs for a whole floor) | loop over single-device endpoints | App-side | CLAUDE.md §6 forbids bulk on real devices during experiments | Later |
| Access policy templates (e.g. "standard stay: daily algoPIN, check-in 14:00, check-out 12:00") | algoPIN params | App-side | 24 h activation, 256 h rule baked into policy | Next |

## 6. Most promising (recommendation, HYP)

1. **Read-only operations console** (MVP): connection status, inventory, topology, battery with freshness, activity timeline, redacted request inspector. All DOC-backed, zero device risk.
2. **algoPIN stay credentials** (Next): the core hospitality value, no Bridge needed for issuance. Must encode the 24 h activation and 256 h deletion rules into policy.
3. **Bridge-backed revocation and status** (Next): the only documented way to revoke algoPINs and custom PINs and to get live status; required for a credible check-out flow.
4. **Security and failure alerts via webhooks** (Next): break-in, wrong-PIN bursts, Bridge offline, failed jobs.
5. **iglooKey evaluation** (research): potentially the cleanest editable/revocable guest credential, but guest UX is unknown.
