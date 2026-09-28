# Credentials and PIN Lifecycle

Research date: 2026-09-25. Evidence labels: see [README](README.md#evidence-labels).

## 1. Credential types

| Credential | Created via | Needs Bridge | Needs phone at lock | Revocable via API | Evidence |
|---|---|---|---|---|---|
| **algoPIN** (one-time, permanent, hourly, daily, passage) | REST, server computes | No | No | Only via Bridge delete job, with time limits | DOC |
| **Custom PIN** (chosen digits) | Bridge job 4 (4–6 digits); iglooworks async job + SDK `syncJob`; SDK `createPin` (1–12 digits) | Bridge path: yes | SDK path: yes | Bridge job 5 / iglooworks `DELETE …/access/{accessId}` | DOC |
| **Bluetooth guest key (ekey)** | REST `POST /devices/{id}/ekey` | No | Guest's phone must use igloohome app or SDK | igloohome: **NF** (job 18 unsupported). iglooworks: `POST …/access/revoke` | DOC |
| **iglooKey token (smart link)** | REST `POST /pass[/offline|/online]` | NF | Guest phone | Yes: `DELETE /pass/{id}`; validity editable `PATCH /pass/{id}` | DOC-PARTIAL |
| **Master PIN** | Set on pairing (app); readable via REST | No | — | Cannot be set via API (job 16 unsupported) | DOC |
| **RFID keycard** | SDK only, card tapped at lock | No | Yes | SDK only | DOC (SDK) |
| **Fingerprint** | SDK only | No | Yes | SDK only | DOC (SDK) |

## 2. algoPIN

### What it is (DOC)

"generate valid PIN codes even when you don't have WiFi, cellular, or remote access to your lock." The server derives the PIN from the lock's secret and the validity window; the lock validates it offline.

### Types and ranges (DOC)

| Type | Endpoint | Window | Variances per identical window |
|---|---|---|---|
| One-time (OTP) | `algopin/onetime` | Single use from `startDate`; exact validity window of an unused OTP algoPIN is NF | 5 |
| Permanent | `algopin/permanent` | From `startDate`, no end | 5 |
| Duration hourly | `algopin/hourly` | **1–672 hours** | 3 |
| Duration daily | `algopin/daily` | **29–367 days** | 3 |
| Passage | `algopin/passage` | `durationHours`; lock stays unlocked for duration; newer firmware only | NF |

Hourly covers up to 672 h (28 days); daily starts at 29 days. Nothing longer than 367 days except permanent.

### Rules and limits (DOC)

| Rule | Detail | PMS consequence (HYP) |
|---|---|---|
| Supported devices only | `418` on unsupported SKU (OE1X, SP3X, SW1X, Bridge, Fob) | Validate device before offering algoPIN |
| Paired via igloohome app | Lock must have been paired with the igloohome app | Onboarding dependency |
| **24-hour activation** | PINs valid > 24 h must be **used on the lock within the first 24 h** of validity or they will not work | A 3-night stay PIN must be entered once within 24 h of start. Guests arriving late may be locked out. Critical. |
| **256 rule** | If `startDate` > 256 hours from now, the PIN **cannot be deleted** | Do not issue long-lead reservations as algoPIN more than ~10 days ahead if cancellation is possible |
| Bridge delete note | "Unactivated algoPINs can only be deleted within one week of their start time" | Conflicts with 256 h (~10.7 days). See blockers. |
| **199 rule** | Lock whitelist + blacklist holds max **199** PIN codes (algoPIN and Bluetooth PINs combined) | Capacity planning per room; deleting a PIN likely consumes a blacklist slot (HYP) |
| Variances | Only 3–5 unique PINs per identical window | Two guests with identical check-in/out on the same lock (e.g. shared entrance) exhaust quickly; vary `startDate` by an hour |
| Timezone | `409 timezone is not found on property` if the lock's property lacks a timezone | Validate property config |
| Idempotency (iglooworks) | Same lock + type + window + variance returns the **same** PIN; no new record | Safe to retry. igloohome behaviour NF (HYP: deterministic). |
| Edit | Not possible | Change of stay dates = issue new PIN + delete old (if allowed) |

### Revocation reality

algoPIN revocation requires **Bridge job 5 (Delete PIN) with the PIN value**, subject to the 256-hour / one-week rules. Without a Bridge, an issued algoPIN **cannot be revoked** before it expires. (DOC + HYP)

This is the single most important constraint for check-out and cancellation workflows.

## 3. Custom PIN via Bridge (job 4 / job 5)

| Field | Rule (DOC) |
|---|---|
| `accessName` | required |
| `pin` | 4–6 digits, digits only |
| `pinType` | 1 one-time ("Valid for 24 hours from start date"), 2 permanent, 4 duration |
| `startDate` | required, format `YYYY-MM-DDTHH:mm:ss+hh:mm`, must be now or later |
| `endDate` | duration only, must be after `startDate` |

Completion statuses (webhook `jobStatus`, DOC): 0 success, 1 generic failure, 2 another operation in progress, **5 invalid custom PIN length, 9 duplicate PIN, 12 insufficient PIN storage**; delete: **3 PIN not found**.

iglooworks adds pre-checks: `406` if a pending job for the same PIN exists or PIN already in use on the lock.

Delete is by **PIN value** on igloohome (`jobData.pin`), by **accessId** on iglooworks. Therefore on igloohome **our application must store the PIN value** to be able to delete it later. That means storing a secret — encrypt at rest. (HYP, derived from DOC)

Retry safety: custom PIN create is **not idempotent** at the API level (a duplicate yields status 9). Deletion of a missing PIN yields status 3. So a retry after an *unknown* outcome is recoverable if we interpret 9/3 correctly — but only after checking job status first. (HYP)

## 4. Bluetooth guest key (ekey)

`POST /devices/{deviceId}/ekey` with `startDate`, `endDate`, `permissions` → `{bluetoothGuestKey, keyId}`. The key is usable only by a BLE client (igloohome app or our own app using the private SDK). `keyId` appears in activity logs (`keyId` field) so guest actions are attributable. (DOC)

No igloohome REST revoke. iglooworks `POST /devices/{id}/access/revoke` revokes **all** access records for a recipient and deletes key material permanently. (DOC)

## 5. iglooKey token

A token with `shareableUrl` (`https://igloodev.app.link/pass?token=lnk_…`), `activationDeadline`, validity window, and type `TOKEN_TYPE_HYBRID`. Three create variants: default, offline-capable, online-only (`offlineAccessSeconds` rejected). Supports **update** of `startsAt`/`endsAt` and **revoke**. `422` returns `excludedIds` for devices that do not support iglooKey. (DOC)

Unknown: guest experience (does the link open the igloohome app? a web page?), whether it needs a Bridge for online mode, which models support it, how `activationWindowSeconds` interacts with `activationDeadline`. (NF)

Potential value (HYP): iglooKey is the only igloohome-API credential that supports **date change and revoke without a Bridge**. If guest phones are acceptable, it may be the best fit for stay extensions and early check-out.

## 6. Master PIN

`GET /devices/{deviceId}/masterpin` returns the lock's master PIN. It cannot be changed via API. The portal also displays it. Treat as a top-secret value: do not expose in UI by default, never log, require elevated role and reason capture. Using it produces log type 18. (DOC + CLAUDE.md §7)

## 7. Lifecycle mapping (business concept → vendor operation)

| Business concept | Vendor operation options | Confirmed? |
|---|---|---|
| Issue guest access for a stay | algoPIN hourly/daily (no Bridge) · custom PIN duration via Bridge · iglooKey token · ekey | DOC |
| Pre-arrival provisioning | algoPIN can be generated any time; **beware 256 h rule** · custom PIN job needs Bridge online at creation | DOC |
| Check-in activation | algoPIN activates on first use (must be within 24 h) · custom PIN active from `startDate` | DOC |
| Stay extension | algoPIN: issue new PIN · iglooKey: `PATCH /pass/{id}` · custom PIN: create new + delete old (no edit) | DOC |
| Early check-out / revoke | algoPIN: Bridge delete job (limits) · custom PIN: Bridge delete · iglooKey: `DELETE /pass/{id}` · ekey: iglooworks only | DOC |
| Automatic expiry | All time-bounded types expire on the lock by themselves | DOC |
| Housekeeping / maintenance | one-time algoPIN per visit, or recurring daily algoPIN per staff member (variance limits) | DOC + HYP |
| Emergency access | master PIN (manual), remote unlock via Bridge | DOC |
