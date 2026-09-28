# Research Synthesis and Readiness Review

Review date: 2026-09-25. Reviewed: `README.md`, `01`–`10`, and the source snapshot `sources/2026-09-25/` (SHA-256 checksums re-verified: all three files OK). Evidence labels: see [README](README.md#evidence-labels).

## 1. Executive summary

- **Evidence base is documentation only.** No authenticated API request and no hardware test has been run. Every capability in the inventory is at best `DOC`. The only live evidence is unauthenticated probes showing which base URLs have auth-protected routes (`PROBE`).
- **The documentation is complete in coverage but inconsistent in detail.** All 64 documentation pages were read. There are 22 recorded contradictions (base URL, token endpoint, algoPIN deletion window, webhook envelope, scope names, API version). None of them can be settled without credentials.
- **The core hospitality value is documented and plausible:** time-bounded algoPINs can be issued without a Bridge, and a Bridge can delete PINs, report battery and lock state, and lock or unlock remotely, all asynchronously.
- **The binding constraints are also documented:** algoPINs valid for more than 24 h must be used within 24 h; algoPINs starting more than 256 h ahead cannot be deleted; a lock holds 199 PINs; revoking a PIN needs a Bridge; onboarding (pair, link, Wi-Fi) is not available through REST.
- **Recommended first vertical slice (conditional):** one room, one test lock, one Bridge: *issue a guest stay credential just in time (hourly algoPIN) and revoke it at check-out through a Bridge delete job, with the job result confirmed by polling.* It is the smallest slice that exercises a real PMS business capability end to end with documented operations. It becomes an implementation decision only after the gate experiments in §11 pass.
- **Readiness: not ready to implement.** Four access blockers (product type, credentials, test hardware identity, guest-facing status) stop even the read-only experiments.

## 2. Corrections from this review

| Item | Correction | Applied |
|---|---|---|
| Sitemap / page count | Sitemap has **64** URLs and the corpus has 64 `### FILE:` entries, not 63 | Fixed in `README.md`, `09-sources.md` |
| API version | Supported-devices pages say "API V2"; `llms.txt` base URL uses `/v1`; iglooworks guides use `/v2`. Added as **D22** below | This file |
| algoPIN revocation storage | Bridge job 5 deletes by PIN **value** (`jobData.pin`) for all PINs, including algoPINs, not only custom PINs. Revoking an algoPIN therefore also requires storing the PIN value (encrypted) | This file (§5) |
| One-time semantics | "Valid for 24 hours from start date" is documented for **custom** one-time PINs (Bridge job 4). The validity window of an unused one-time **algoPIN** is not documented. `05` already says this; restated to prevent reuse of the 24 h figure for algoPIN | This file |

No other factual errors were found when the main claims were re-checked against the snapshot (24 h activation, 256 rule, 199 rule, variances, job type support table, job 15 log deletion, Bridge-targeted 1/5 min rate limit, 406 offline, scopes).

## 3. Confirmed capabilities (DOC — confirmed by official documentation only)

"Confirmed" here means the official docs describe the operation with a method, path and at least a partial schema. **None are confirmed by API request or hardware.**

### 3.1 igloohome API

| Area | Capability | Endpoint | Schema completeness |
|---|---|---|---|
| Auth | Client-credentials token, scoped | `POST auth.igloohome.co/oauth2/token` | Good |
| Auth | Partner auth-code flow (iglooconnect), refresh 365 days | same host | Good |
| Status | Token/account health: flow, scopes, tier, end date | `GET /server-health` | Partial (enums missing) |
| Inventory | Properties list/detail, devices per property | `GET /properties…` | Good |
| Inventory | Devices list/detail, algoPIN-capable list | `GET /devices`, `/devices/support-pins`, `/devices/{id}` | Partial (filter values missing) |
| History | Translated activity log history | `GET /devices/{id}/activity` | Partial (`activityType` values missing) |
| Credential | algoPIN one-time, permanent, hourly, daily | `POST /devices/{id}/algopin/{type}` | Good (fields, errors) |
| Credential | algoPIN passage (newer firmware) | `POST …/algopin/passage` | Partial (no scope) |
| Credential | Bluetooth guest key | `POST /devices/{id}/ekey` | Partial (`permissions` format missing) |
| Credential | iglooKey token create / update / revoke | `/pass`, `/pass/offline`, `/pass/online`, `PATCH`/`DELETE /pass/{id}` | Partial (no scope, UX missing) |
| Secret | Read master PIN | `GET /devices/{id}/masterpin` | Good |
| Bridge | Proxied jobs 1, 2, 4, 5, 9, 10, 15 | `POST /devices/{deviceId}/jobs/bridges/{bridgeId}` | Good for job data; result via webhook |
| Bridge | Bridge-targeted diagnostic job 10 | `POST /devices/{bridgeId}/jobs` | Good |
| Jobs | Job status polling | `GET /jobs/{jobId}` | Partial (`opResult` meaning missing) |
| Events | Webhooks: Job Complete (3), Activity Log (5), Bridge Connection (10); signed | Portal-registered | Partial (envelope conflicts, no retry policy) |

### 3.2 iglooworks-only (separate product; only relevant if we are on iglooworks)

Account, users, departments, access-record listing, ekey grant/revoke with audit trail, async custom-PIN jobs executed by phone sync, job list, G2 admin key. See `02` §B.

### 3.3 Documented as not supported

Edit custom PIN (job 3), set wrong-PIN lockout (14), set master PIN (16), revoke/re-enable Bluetooth guest key via Bridge (18/19), delete RFID card (24) or fingerprint (29) via Bridge, algoPIN on OE1X/SP3X/SW1X, reading G3 admin keys.

## 4. Unverified capabilities

### 4.1 Nothing is `API` or `HW` confirmed

| Evidence level | Count |
|---|---|
| Confirmed by actual API request | 0 |
| Confirmed by hardware test | 0 |
| PROBE (unauthenticated route existence) | 5 base-URL observations |

### 4.2 Mentioned but schema or semantics unavailable (DOC-PARTIAL)

- `GET /devices` query values for `type`, `sort`, `search`, `expand`.
- `GET /devices/{id}` query params `admin_key`, `lock_id` (possible secret exposure; not to be tested).
- `PUT /devices/{id}` (only `batteryLevel`; self-contradictory error).
- `POST /devices/{id}/activity` (`logsPayload` item schema; scope missing from list).
- `POST /token`, `POST /token/revoke` (relationship to OAuth endpoint).
- `ekey.permissions` value format.
- iglooKey device support, guest UX, Bridge dependency, `activationWindowSeconds` semantics.
- Job `expiryDate` TTL, `opResult` meaning.
- `server-health` `tier` and `status` values.
- Webhook delivery semantics (retries, ordering, duplicates, timeout).

### 4.3 Hypotheses currently embedded in the artifacts (HYP) — must not be relied on

| Hypothesis | Where used | Risk if wrong |
|---|---|---|
| `api.igloodeveloper.co/igloohome` is the production base (based on PROBE + third-party library) | Inventory | Low — E2 resolves |
| igloohome algoPIN is idempotent (same inputs → same PIN) like iglooworks | 05, 06 | Duplicate-credential assumptions in retries |
| `batteryLevel` in device list is cached and refreshed by sync / job 9 | 04, 08 | Misleading battery dashboard |
| Job TTL ~2 min (from one example) | 04 | Wrong timeout handling |
| Out-of-range lock behind online Bridge returns `jobStatus: 1` or expires | 04 | Unknown-state handling |
| Deleting a PIN consumes a blacklist slot (199 rule) | 05 | Capacity planning |
| iglooKey `shareableUrl` opens the igloohome app | 05, 08 | Guest UX design |
| Lock clock drift breaks algoPIN validity | 06 | Clock-sync policy |
| Token scopes cannot be restricted per device | 03 | RBAC design (we assume the worst case, which is safe) |

## 5. Important limitations and blockers

### 5.1 Access blockers (from `07` §1, still open)

| # | Blocker | Blocks |
|---|---|---|
| B1 | Product/account type unknown (igloohome User / Partner / iglooworks) | All experiments; endpoint set |
| B2 | No credentials | All experiments |
| B3 | Test lock and Bridge models/IDs unknown | Hardware-testability assessment |
| B4 | Guest-facing status of test lock unknown | Any mutating experiment |
| B5 | Trial/subscription state unknown | Continuity (402 after 30 days) |
| B6 | Webhook public key not obtained | Webhook verification |
| B7 | No public HTTPS webhook endpoint | Push results (polling avoids this) |
| B8 | No BLE SDK access | Onboarding, keycard, fingerprint, phone-based flows |

### 5.2 Documented limitations that shape any PMS design

| Limitation | Business effect |
|---|---|
| algoPIN > 24 h must be used within its first 24 h | Late or no-show first entry → PIN never activates. Guests must be told to use the code on arrival day |
| algoPIN starting > 256 h ahead cannot be deleted; "unactivated algoPINs … deleted within one week of their start time" | Issuing at booking time can make cancellations unrevocable. Issue just in time |
| Revocation of any PIN requires a Bridge job and the PIN value | Check-out revocation depends on Bridge uptime and on us storing an encrypted PIN |
| 199 PIN whitelist + blacklist per lock | High-turnover rooms need capacity tracking |
| 3–5 variances per identical window | Multiple staff/guests with identical windows on the same lock exhaust unique PINs |
| No PIN edit | Date changes = new credential + revoke old |
| Scopes are per operation, not per device | Room/role-level permission must be enforced by our app |
| Onboarding not in REST | Pair/link/Wi-Fi remain manual (app) steps |
| No push events without a Bridge | Real-time entry awareness needs a Bridge |
| Bridge job 15 deletes lock-side logs | Must not be used casually |
| Only documented rate limit: Bridge-targeted 1 per 5 min | Other limits unknown; no load testing |

## 6. Contradictions and findings requiring verification

All D1–D21 from `07` §2 remain open. Added in this review:

| # | Topic | Conflict | Resolution |
|---|---|---|---|
| D22 | API version | "API V2" (supported-devices pages, iglooworks) vs `/v1` in `llms.txt` base URL; igloohome reference paths carry no version | E2: observe which base answers; record version header if any |

Ranked by impact on the first slice:

1. **D1 base URL** — blocks everything. Resolved by E2.
2. **D6 algoPIN deletion window** (256 h vs one week) — decides how early a stay credential can be issued. Resolved by E14 + support question.
3. **D9/D10/D12 webhook and job result shape** — decides how job completion is parsed. The slice avoids webhooks; still need `GET /jobs/{jobId}` real shape (E7).
4. **D3 token endpoint / `expires_in`** — decides token cache behaviour. Resolved by E1.
5. **D15 required fields** — decides validation. Resolved by E10 (`400` messages).

**Update after Stoplight comparison (`12-stoplight-comparison.md`):** D1 narrowed (official OpenAPI names `api.igloodeveloper.co/igloohome`); D15/U7 resolved at DOC level (required fields; hour-aligned dates). New **D23** is now the top slice risk: `GET /jobs/{jobId}` `jobStatus` is defined as 0 completed / 1 pending / 2 expired in Stoplight but 0 success / 1 failure / 2 in progress in webhook docs. Slice polling must not interpret `jobStatus` until E7 records real values. D24–D28 added (lower impact).

## 7. Hardware-testing readiness

We do not yet know the lock model, the Bridge link state, or whether a keypad is present. Readiness is therefore conditional.

| Experiment group | Needs | Ready? | Conditions that must be true |
|---|---|---|---|
| Phase A read-only (E1–E4, E4b) | Credentials only | **Blocked** (B1, B2) | Credentials in local `.env` |
| E5 webhook receiver | Public HTTPS URL, public key | **Blocked** (B6, B7) | Optional for slice 1 |
| E6 Bridge diagnostics | Bridge paired to account, online | Blocked (B3) | Bridge `EB1X…` appears in `GET /devices` |
| E7–E8 battery/status jobs | Lock **linked** to Bridge | Blocked (B3) | Lock shows Bridge in `linkedDevices`/`linkedAccessories` |
| E9 Bridge offline | Test Bridge can be unplugged | Blocked (B3, B4) | Bridge serves no guest rooms |
| E10 algoPIN generation | algoPIN-capable model (not OE1X/SP3X/SW1X) | Blocked (B3) | Prefix in supported list; property has timezone |
| E11 algoPIN on hardware | Physical access; keypad on lock or linked EK1X | Blocked (B3, B4) | Person at lock |
| E12, E14 PIN create/delete via Bridge | Linked Bridge; test lock | Blocked (B3, B4) | As E7 + E10 |
| E13 iglooKey | Test phone; supported model | Blocked (B3) | 422 check first |
| E15 remote unlock/lock | Linked Bridge; person present | Blocked (B3, B4) + explicit approval | Last |

**Most likely testable set once B1–B4 are answered** (assuming a typical algoPIN-capable lock linked to an EB1X Bridge): E1–E4b, E6–E8, E10–E12, E14. E13 depends on model support; E15 depends on approval.

## 8. Candidate workflows

### 8.1 API exploration features (tools for us, not PMS capabilities)

These help validate the integration. They are not business capabilities and should not be presented as such.

- Connection/token/scope/tier status (`server-health`).
- Raw device and property explorer.
- Request/response inspector with redaction.
- Job tracker (jobId → status).
- Webhook event viewer and signature check.
- Experiment log.
- Capability/evidence view of these research docs.

### 8.2 PMS business capabilities (vendor-neutral names)

| Business capability | Vendor operations | Evidence | Bridge | Feasibility now |
|---|---|---|---|---|
| **Room–lock assignment** | device list (read) + our mapping | DOC + App-side | No | High (read-only) |
| **Issue guest stay access** | hourly/daily algoPIN | DOC | No | High, subject to 24 h activation |
| **Revoke guest stay access** | Bridge job 5 (by PIN value); poll job | DOC | **Yes** | Medium — depends on D6 and Bridge link |
| **Change stay dates** | new algoPIN + revoke old | DOC | Yes (revoke) | Medium |
| **Grant staff visit access** (housekeeping, maintenance, vendor) | one-time or hourly algoPIN | DOC | No | High; variance limits |
| **Lock health monitoring** (battery, last sync, Bridge online) | device list; job 9; webhook 10 | DOC / DOC-PARTIAL | Live data: yes | Medium |
| **Access troubleshooting** | activity history; wrong-PIN logs | DOC-PARTIAL | For freshness | Medium |
| **Security alerting** (break-in 53, wrong PIN 16) | webhook 5 | DOC | Yes | Low now (needs B6, B7) |
| **Emergency remote unlock** | Bridge job 2 | DOC | Yes | Low (R3, approval, audit) |
| **Mobile key** | iglooKey / ekey | DOC-PARTIAL | NF / No | Low (UX unknown) |
| **Partner/franchise accounts** | iglooconnect | DOC | — | Low (partnership) |

## 9. Recommended first vertical slice

### 9.1 Slice: "Guest stay access for one room"

For **one mapped room** on the **test lock** with its **Bridge**:

1. Operator enters a stay (check-in time, check-out time, guest label) for a mapped room.
2. At issue time (just in time, well inside the 256 h window), the system requests an **hourly algoPIN** covering the stay, with a scoped token (`algopin-hourly` only). Start and end are rounded to the hour (Stoplight rule); a one-night 14:00→12:00 stay is 22 h, so the 24 h activation rule does not apply.
3. The PIN is shown once to the operator; stored encrypted with the stay record; never logged.
4. Guest (tester) enters the PIN on the lock; the system shows the matching activity entry when it appears in `GET /devices/{id}/activity`.
5. At check-out (or early check-out), the system creates **Bridge job 5** (delete PIN) with a separately scoped token (`delete-pin-bridge-proxied-job`, `get-job-status`) and tracks it by **polling `GET /jobs/{jobId}`** until success, failure, or expiry.
6. The stay shows a truthful credential state: `issued`, `revocation requested`, `revoked` (only on `jobStatus: 0`), `revocation failed`, `unknown`.
7. Every action is written to our own audit record.

Prerequisite read-only pieces (thin, not a separate project): token handling, `server-health` check, device list to pick and map the test lock and its Bridge.

### 9.2 Reasons, from evidence

| Reason | Evidence |
|---|---|
| Delivers the central hospitality capability (issue + revoke guest access), not just exploration | Business need; `08` §2 |
| Issuance works without a Bridge, so the guest can enter even if the Bridge is down | DOC (algoPIN) |
| Hourly type covers 1–672 h, i.e. every realistic Bobobox stay up to 28 days | DOC |
| Revocation through job 5 is the only documented way to cut algoPIN access early | DOC |
| Polling `GET /jobs/{jobId}` is documented, so the slice does not depend on the public webhook endpoint or public key (B6, B7) | DOC |
| Exercises least-privilege tokens (separate issue vs revoke scopes) | DOC (scopes) |
| Low physical risk: no remote unlock/lock; one test lock | Safety (CLAUDE.md §6) |
| Tests the hardest constraints early (24 h activation, deletion window, async job states) | DOC limitations |

### 9.3 Alternatives considered

| Alternative | Why not first |
|---|---|
| Read-only console only | Low risk but does not prove a business capability; kept as thin prerequisite |
| Custom PIN via Bridge (job 4) as the stay credential | Needs Bridge online at issuance, consumes storage, create is not idempotent; better as fallback if algoPIN deletion proves unworkable |
| iglooKey token | Editable and revocable without Bridge, but guest UX and device support are unknown (DOC-PARTIAL) |
| Remote unlock | R3 physical risk; no business need for it in the first slice |
| Webhook-driven alerts | Blocked by B6, B7 |

### 9.4 Conditions that would change the recommendation

- E14 shows algoPINs cannot be deleted in practice → switch the credential to **custom PIN via Bridge (job 4/5)** or evaluate **iglooKey**.
- The test lock is not algoPIN-capable (E3/H11) → custom PIN via Bridge.
- The test lock is not linked to the Bridge → slice reduces to "issue only"; revocation cannot be demonstrated, and the slice should not proceed as a PMS workflow until linking is done in the app.
- Account is iglooworks → re-evaluate: iglooworks offers access listing and `DELETE …/access/{accessId}` (delete by ID, no stored PIN needed).

> **Update 2026-09-25 (implementation plan):** the plan makes "Connect, discover, and health-check" the first implemented slice (M1–M4), because it resolves D1/D3/D22/D23 and the keypad/switch representation that every credential workflow depends on. The stay-access workflow above becomes Slice 2, after credential experiments (M5). See `docs/plans/igloohome-implementation-plan.md`.

## 10. Out of scope for the first slice

- Remote lock/unlock (jobs 1/2), passage algoPIN, master PIN read, ekey, iglooKey.
- Webhooks (receiver, signature verification) — planned for slice 2.
- Custom PINs (unless §9.4 triggers the fallback).
- Bridge job 15 (destructive log pull), `PUT /devices/{id}`, `POST /devices/{id}/activity`.
- Onboarding, pairing, linking, firmware, keycards, fingerprints (not in REST).
- Multiple rooms, multiple properties, bulk operations, partner accounts, departments.
- Role-based admin beyond a single operator role.
- Automatic retries of mutating operations.
- Any advanced architecture (queues, sagas, event sourcing) — CLAUDE.md §3.4.

## 11. Required follow-up experiments (gate for the slice)

Minimum set, in order. Each needs the preconditions in `10` §1 and records per `10` §7.

| Order | Experiment | Answers | Gate |
|---|---|---|---|
| 1 | **E1** token with read scopes | Token endpoint, `expires_in`, JWT scope claim (D3) | Must pass |
| 2 | **E2** `server-health` on both base URLs | Base URL (D1, D22), tier, end date | Must pass |
| 3 | **E3** devices, `support-pins`, test lock detail | Lock model algoPIN-capable? Bridge linked? real schema | Must show algoPIN-capable lock linked to Bridge |
| 4 | **E4** property + activity | Timezone present (avoids 409); activity schema | Must pass |
| 5 | **E4b** masterpin with read token → 403 | Scope enforcement works | Must return 403 |
| 6 | **E7** job 9 + poll `GET /jobs/{jobId}` | Job lifecycle, real status shape (D12), **`jobStatus` meaning (D23)**, TTL; 406 "Lock is not linked to bridge" check | Must reach a terminal state and D23 must be resolved |
| 7 | **E10** hourly algoPIN generation (not entered) | Required fields, date format, idempotency (U6, U7, D15) | Must return PIN |
| 8 | **E11** enter algoPIN on test lock | Activation works; activity log latency | Must unlock and appear in history |
| 9 | **E14** delete algoPIN via job 5 (short-lead and ~8-day-lead) | Real deletion window (D6); `jobStatus` 0/3 | Short-lead delete must succeed |
| 10 | Re-enter deleted PIN on lock | Revocation is effective on hardware | Must be rejected |

Questions to send to igloohome support in parallel: D6 (deletion window), U8 (blacklist slot consumption), U12 (billable "active lock"), job TTL.

## 12. Implementation-readiness assessment

| Dimension | Status | Notes |
|---|---|---|
| Documentation coverage | **Ready** | All 64 pages read; snapshot with checksums |
| Capability inventory | **Ready for review** | DOC-level; evidence labels applied |
| Account / product decision | **Not ready** | B1 |
| Credentials and secret handling | **Not ready** | B2; `.env` pattern defined |
| Hardware identification | **Not ready** | B3, B4 |
| Base URL / token behaviour | **Not ready** | D1, D3, D22 — E1/E2 |
| Slice-critical behaviour (algoPIN issue, activation, delete, job polling) | **Not ready** | E7, E10, E11, E14 |
| Security design | **Partially ready** | Redaction, scoped tokens, encrypted PIN storage identified; no design written |
| Implementation plan | **Not started (correctly)** | Draft only after gate experiments 1–10 pass |

**Overall: not ready for implementation.** Ready to start Phase A experiments as soon as B1–B4 are answered. After experiments 1–10 in §11 pass, the evidence will be sufficient to write an implementation plan for the §9 slice via `/ecc:plan`.

### Information needed from the user

1. Product and account type (igloohome User, Partner, or iglooworks).
2. API credentials (local `.env` only).
3. Test lock model prefix and Bridge ID (redacted in docs), and whether the lock is linked to the Bridge in the igloohome app.
4. Confirmation that the test lock and Bridge serve no guests, and who will be physically present for E11/E14.
5. Whether the lock has a built-in keypad or a linked EK1X keypad.
