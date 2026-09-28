# Stoplight vs docs.igloohome.co — Comparison

Compared 2026-09-25. Evidence labels: see [README](README.md#evidence-labels).

| | **A. docs.igloohome.co** | **B. igloocompany.stoplight.io/docs/igloohome-api** |
|---|---|---|
| Role | Current docs site (igloohome + iglooworks, SDK, webhooks) | Older docs site for the igloohome API only |
| How it was read | `/llms-full.txt` corpus (64 pages) | Stoplight public API: `GET https://stoplight.io/api/v1/projects/cHJqOjEzNjUyMA==/table-of-contents` and `/nodes/{id}` (28 nodes). The web UI needs JavaScript; the content does **not** need a login |
| Stoplight project | — | "igloohome API", project id 136520, public, created 2022-06-01 |
| Branding | igloohome API, "API portal" | **iglooaccess** (older name; support article says "igloohome API (formerly iglooaccess)") |
| Format | Markdown generated from an OpenAPI-like source; every body field shown as "Optional" | **Real OpenAPI schemas** (`required`, `enum`, `pattern`, `format`, conditional-presence notes) |
| Snapshot | `sources/2026-09-25/llms-full.txt` | `sources/2026-09-25/stoplight-igloohome-api/` (TOC + 28 nodes, SHA-256 in `SHA256SUMS`) |

Correction to the earlier research: `09-sources.md` listed Stoplight as "legacy" and it was not read. It is public and it was worth reading. Also, **no documentation page required credentials**. Only the portals (API portal, iglooconnect, iglooworks dashboard) need a login; documentation access was never the blocker.

**Verdict:** B is an older, smaller version of the igloohome part of A. Most prose is identical word for word. It is **not** a pure duplicate: B has stricter, machine-readable schemas that A lost, and a few details that conflict with A. **Use A for coverage, B for field-level rules, and treat every conflict as open until an API call settles it.**

---

## 1. Coverage

| Topic | A | B |
|---|---|---|
| igloohome REST operations | 27 | 16 (+1 empty placeholder) |
| iglooworks API | Yes (30 ops) | No |
| algoPIN one-time / permanent / hourly / daily | Yes | Yes |
| algoPIN passage | Yes | **No** |
| `GET /devices/support-pins` | Yes | **No** |
| `PUT /devices/{id}` | Yes | **No** (scope `update-device` listed) |
| `GET/POST /devices/{id}/activity` | Yes | **No** (scope `get-device-activity` listed) |
| iglooKey `/pass` (5 ops) | Yes | **No** |
| `GET /server-health`, `POST /token`, `/token/revoke` | Yes | **No** |
| Bluetooth guest key (ekey) | Yes | Yes |
| Bridge proxied / targeted jobs, job status | Yes | Yes |
| Devices, device detail, master PIN, properties | Yes | Yes |
| Webhooks (automated, targeted, security) | Yes, plus "job-specific data" page | Yes; links to a "job-specific data" page that is **not published** |
| SDK | Full BLE SDK 3.5.0 (`co.igloo.home:sdk`): scan, pair, link, Wi-Fi, PINs, cards, fingerprints, DFU | Old SDK 1.1.0 (`co.igloo.access:sdk`): unlock, lock, sync, syncWithStatus only |
| Placeholder `POST /devices/{bluetoothId}` "Your GET endpoint" | No | Yes — empty stub, ignore |

A is the superset in coverage. B adds nothing new in **operations**, but adds a lot in **rules**.

## 2. Identical content (no change to findings)

Overview, iglooconnect guide (B adds a YouTube tutorial link), supported-devices table (same list, "Last updated: July 16, 2025"), what-is-algoPIN (24 h activation, 256 rule, 199 rule, variances), Bridge proxied job types and job data, "one week" delete note, Bridge-targeted job 10 and its 1-per-5-min limit, webhook event types 3/5/10 and log-type table, webhook signature algorithm and Node example, scope list (18 scopes).

## 3. Details only in Stoplight (new evidence, DOC from B)

### 3.1 Base URL — resolves most of D1

B's OpenAPI `servers` entry is **`https://api.igloodeveloper.co/igloohome`** (every operation inherits it). Token URL in the security scheme: `https://auth.igloohome.co/oauth2/token`. This matches A's guides, our PROBE (401), and the third-party library. A's reference examples (`api.igloohome.co/home`) and `llms.txt` (`/v1`) are now the outliers. Status: **DOC (two official sources agree) + PROBE**; still needs E2.

### 3.2 algoPIN request rules (resolves D15 and U7)

| Rule | One-time | Permanent | Hourly | Daily |
|---|---|---|---|---|
| Required fields | `variance`, `startDate`, `accessName` | same | + `endDate` | + `endDate` |
| `variance` enum | 1–5 | 1–5 | 1–3 | 1–3 |
| `startDate` / `endDate` format | `YYYY-MM-DDThh:00:00+hh:mm` — **minutes and seconds must be `00`** ("times have hour resolutions") | same | same | same |
| Earliest `startDate` | at or after the **start of the current hour** | same | **not more than 1 hour in the past** | same as hourly |
| Range | — | — | 1 h to 672 h | 29 to 367 days, **whole days only** ("29.5 days not allowed") |
| Extra | — | — | — | **start hour must equal end hour** (e.g. `…T16:00` → `…T16:00`) |
| `accessName` | ≤ **60 characters** (all types) | | | |

B lists the 400 messages for each rule (e.g. `'startDate' and 'endDate' times have hour resolutions, set minutes and seconds to 00`, `'endDate' time is not equal to 'startDate' time`, `Duration (Hourly) PIN code supports 1 hour from 'startDate' to 672 hours`).

### 3.3 Device response fields

| Field | B says | A says |
|---|---|---|
| `id`, `type`, `deviceId`, `pairedAt`, `linkedDevices` | **required** | shown, not marked |
| `batteryLevel` | integer ≥ 0; **only present once the device has reported battery**; absent for new or hardwired devices | shown in examples |
| `homeId` | **absent** if the device has no property (e.g. a Bridge or Fob, or a lock pending assignment) | shown in examples |
| `lastSync` | "timestamp of the last synchronization/**heartbeat**"; `string` or `null`; absent until first sync | shown for device detail |
| `lockStatus` | on `GET /devices/{deviceId}`: enum **`LOCKED` / `UNLOCKED`**, present **only if** type is `Lock` **and** it is linked to a Bridge | not documented for igloohome API; iglooworks example shows lowercase `"locked"` |
| `type` values | `Lock`, `Keypad`, `Bridge`, `Fob` | same |

Impact: resolves part of U3 (igloohome API does expose `lockStatus`, for Bridge-linked locks). The dashboard must handle missing fields, not treat them as zero.

### 3.4 Pagination

`limit` default **100** (1–300); `sort` enum **`asc` / `desc`**, default `desc`; 400 `'sort' must be 'desc' or 'asc'`. Resolves the `sort` part of U2. `type`, `search`, `expand` query params (in A) do **not** appear in B at all.

### 3.5 Bridge proxied job

- Required: `jobType`. Example set includes lock `{"jobType":1}` and unlock `{"jobType":2}` with **no** `jobData`.
- New **406** messages: **`"Lock is not linked to bridge"`** and **`"New PIN is already taken. Please try a different pin"`** (A only says "Bridge offline").
- 403 message names scope **`igloohomeapi/bridge-proxied-job`**, which is not in any scope list (A: scope depends on `jobType`).
- Description lists "Create Custom PIN code **(duration)**"; A allows pinType 1, 2 and 4.

### 3.6 Bluetooth guest key (ekey)

`permissions` is an **array of strings**: `UNLOCK`, `LOCK`, `GET_TIME`, `SET_TIME`, `GET_LOGS`, `GET_BATTERY_LEVEL`; default `['UNLOCK','LOCK']`. `keyId` typed **string** (A example: number `12847`). Resolves the `permissions` format gap in A.

### 3.7 Master PIN

Only for devices of type `Lock` and `Keypad`.

### 3.8 Hidden (commented-out) content — HYP, do not use

The Stoplight page sources contain commented-out sections that are not rendered:
- Bridge-targeted **job 31 "Link Device"** and **job 32 "Unlink Device"**, with `jobData: { deviceId }` ("Bluetooth ID of the device to link to the Bridge"), plus their webhook payloads.
- An OpenAPI tag **"App-less eKey"** with no operations, and a service description saying the API supports "**Creating/Revoking** Bluetooth Keys".

These suggest the vendor has (or had) Bridge linking and ekey revocation server-side, consistent with A's SDK note that Bridge `link()` runs as a server job. They are **not published** and must not be called without vendor confirmation. Worth asking igloohome support.

### 3.9 Portal and SDK access

- Webhook URL self-service: **`https://access.igloocompany.co/webhooks`** (iglooaccess portal). A: `web.igloohome.co/api/api-access`.
- API credentials: `https://access.igloocompany.co/api-access`.
- **SDK GitLab token "can be generated directly from the IglooAccess Dashboard"** for self-service accounts; partners request it by e-mail. This lowers blocker B8 (SDK access) for a User account.
- SDK token example uses scope `igloohomeapi/store-device-activity`; "Relevant scope" list: `get-devices`, `store-device-activity`, `update-device`. Confirms that scope exists (D13), although neither site's scope table lists it.
- Contact: `dev@igloocompany.co`; licence: "igloocompany API and SDK License Agreement".

## 4. Conflicts between A and B (new contradictions)

| # | Topic | A | B | Impact |
|---|---|---|---|---|
| **D23** | Meaning of `jobResponse.jobStatus` in `GET /jobs/{jobId}` | Webhook/job codes: 0 success, 1 generic failure, 2 another operation in progress | Job-status schema enum: **"0 (completed)", "1 (pending)", "2 (expired)"** | **High.** Polling logic in the first slice depends on it. Must be settled by E7 before any code interprets job status |
| **D24** | Scope for proxied jobs | Per job type (`lock-…`, `unlock-…`, `create-pin-…`, …) | 403 text: `igloohomeapi/bridge-proxied-job` | Medium; likely stale text in B. E7/E12 403 behaviour will show |
| D25 | Custom PIN types via Bridge | pinType 1, 2, 4 | "Create Custom PIN code (duration)" | Low; test pinType 4 first |
| D26 | ekey `keyId` type | number | string | Low; store as string |
| D27 | `lockStatus` casing | iglooworks `"locked"` | `LOCKED`/`UNLOCKED` | Low; normalise |
| D28 | Webhook portal URL | `web.igloohome.co/api/api-access` | `access.igloocompany.co/webhooks` | Ask user which portal they use |

Resolved or narrowed by B: **D1** (base URL: two official sources agree), **D13** (`store-device-activity` exists), **D15** (required algoPIN fields), **U7** (hour alignment), part of **U2** (`sort` values), part of **U3** (`lockStatus` on igloohome API), `ekey.permissions` format.

## 5. Source priority (decided 2026-09-25)

User-provided evidence: the user's portal (`web.igloohome.co/api/documentation`) links to `docs.igloohome.co/home/getting-started-igloohome-api`. So **A is the vendor's current, linked documentation.**

| Situation | Rule |
|---|---|
| A covers it | **A wins** |
| A is silent or vague, B has a stricter rule (required fields, hour-aligned dates, enums, conditional fields) | Use B as a **working assumption**, labelled `DOC (Stoplight)`, and verify in the matching experiment |
| A and B conflict (D23–D27) | **Neither wins.** Mark open; the real API response decides |
| Anything only in B's commented-out source (jobs 31/32, App-less eKey) | Do not use; ask igloohome support |
| Live API response differs from both | **Live API wins**; record in the experiment log and update the inventory |

B is a secondary reference, not a fallback: we never switch to B's version of an endpoint because A's version fails.

## 6. What this changes in our plan

1. **First slice still holds**, with sharper rules: stay start and end must be on the hour; one-night stays such as 14:00 → 12:00 next day (22 h) are **under 24 h**, so the 24 h activation rule does not apply to them; multi-night stays still need first use within 24 h.
2. **Job polling cannot be trusted until D23 is resolved.** E7 must record the real `jobStatus` values in `GET /jobs/{jobId}` for a completed job, and compare with the webhook if available.
3. **"Lock is not linked to bridge" (406)** gives a clean way to check the Bridge link during E7 without guessing from device fields.
4. **SDK access is likely self-service** for a User account (B8 downgraded).
5. Add a question for igloohome support: status of Bridge-targeted jobs 31/32 (link/unlink) and "App-less eKey" / ekey revocation.
