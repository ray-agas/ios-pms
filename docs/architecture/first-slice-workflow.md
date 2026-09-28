# First Vertical Slice — Workflow, Screens and States

Date: 2026-09-25 · Status: PROPOSED. Slice 1 = "Connect, discover, and health-check the test site" ([plan](../plans/igloohome-implementation-plan.md) §1).

## 1. Actor and preconditions

- **Users:** Bobobox engineers, signed in to the dashboard (Auth.js). `viewer` = read-only; `operator` = viewer + health checks. Until a Google OAuth client exists, one fallback login (role `operator`) is used.
- App runs on the engineer's machine or internal network (`127.0.0.1` by default).
- `.env` filled with Client ID/Secret and explicit slice-1 scopes ([environment-configuration.md](environment-configuration.md)).
- No guest depends on the test devices (user-confirmed).

## 2. Flows

### 2.0 Sign in

`/login` → Google (if configured, `@bobobox.com` only) or fallback username/password → session cookie → dashboard. Wrong credentials: generic error; repeated failures are rate-limited. Signed-out users are redirected to `/login` from every page.

### 2.1 Connect

1. App start → settings validated (fails fast if scopes are empty or base URLs missing).
2. Connection screen calls `check_connection()` → token (H1) → `GET /server-health` (H6).
3. Shows: status, flow, granted scopes vs. requested scopes, tier, subscription end date, checked_at.

### 2.2 Discover

1. Devices screen calls `list_devices()` → `GET /devices` (all pages) + `GET /devices/support-pins`.
2. Table: name, redacted ID, model prefix → model name (supported-devices table), kind, battery (or "not reported"), last sync (or "never"), lock state (or "—"), algoPIN capability, property.
3. Click → Device detail (`GET /devices/{id}`), including linked devices and the raw (redacted) response.

### 2.3 Topology

1. Topology screen builds edges from `linkedDevices` of every device.
2. Loads `test-site-topology.yaml` (manual record of what the mobile app shows).
3. Shows both side by side; marks each edge **API only**, **app only** or **both**.

### 2.4 Activity

Device detail → Activity tab → `GET /devices/{id}/activity` (last 7 days default, paginated). PIN values inside descriptions are redacted.

### 2.5 Health check (operator role, allowlisted devices, `IGLOOHOME_ENABLE_BRIDGE_JOBS=true`)

1. Device detail → "Health check" → choose: **Lock battery** (job 9), **Lock / door status** (job 10), or, on a Bridge, **Bridge diagnostics** (targeted job 10).
2. Confirmation dialog shows: target device (redacted), Bridge used, what the job does ("wakes the lock over Bluetooth; no lock movement; no credential change"), documented rate limit.
3. Submit → `POST` job → job row created (`provider_jobs`) → Job screen.
4. Job screen polls `GET /jobs/{jobId}` every 3 s for up to the job's `expiryDate` (or 2 min if absent), then every 30 s on manual refresh.
5. Shows raw `jobStatus`/`opResult`, the **two documented interpretations** (D23), and result fields if present.

The lock's Bridge is taken from the device's `linkedDevices` (the Bridge entry). If none is present, the button is disabled with "No Bridge link reported by API".

### 2.6 Inspect

Request inspector lists every provider call: time, operation, path template, redacted device ref, status, latency, outcome; expandable redacted request/response. Filter by correlation id (one user action).

### 2.7 Developer mode

1. Toggle "Developer mode" in the header (off by default, remembered per browser).
2. Every screen then shows a panel per underlying call: redacted request, response, decoded codes (`9 → Duplicate PIN · source · unverified`), catalog entry (inventory ID, scope, risk, evidence) and doc links.
3. "Try it" console (`/developer`): pick a catalog operation → fill validated parameters → run → see request/response/decoded codes side by side → optionally mark the run as evidence for an experiment ID.
4. R1 operations in "Try it" go through the same confirmation, allowlist, flag and rate guard as health checks.

## 3. Screens

All screens are mobile-first; per-screen phone vs desktop layout is in `integration-architecture.md` §8b.


| Screen | Content | Actions |
|---|---|---|
| Connection | Status card, scopes (requested vs granted), tier, subscription end, last check | Re-check |
| Devices | Table grouped by kind; counts; fetched_at | Refresh; open device |
| Device detail | Fields, capability badges ("documented"), linked devices, raw response (redacted) | Activity tab; Health check (if allowed) |
| Topology | API graph + app graph + diff list | Refresh |
| Activity | Timeline | Date range; next page |
| Job | Status timeline, raw status, interpretations, result | Refresh |
| Request inspector | Call log (source: ui / try-it / cli) | Filter; expand |
| Developer console | Operation catalog, "Try it" form, code dictionaries reference | Run (catalog operations only); export as evidence |

## 4. States (all screens)

| State | Trigger | UI |
|---|---|---|
| Signed out | No/expired session | Redirect to `/login` |
| Forbidden (role) | Viewer tries a health check | Button hidden; server also rejects with "Operator role required" |
| Loading | Request in flight | Skeleton + "Contacting igloohome…" |
| Empty | 200 with empty `payload` | "No devices returned by the API" + hint: devices paired in app but not assigned to a property may be missing |
| Auth error | 401 after one token re-fetch | Red banner: "Credentials rejected — check `.env`" |
| Subscription | 402 | Account banner on every page: trial ended / payment required |
| Permission | 403 | "Token lacks scope `…`" (from error text when present) |
| Not found | 404 | "Device/job not found" with the ID (redacted) |
| Bridge offline | 406 offline | "Bridge offline — check power and Wi-Fi" |
| Not linked | 406 "Lock is not linked to bridge" | "API says this lock is not linked to the Bridge" (topology evidence) |
| Data integrity | 409 timezone | "Property has no timezone — fix in the igloohome app" |
| Unsupported | 418 | "Not supported by this model" |
| Rate limited | 429 | Countdown from `Retry-After`; health-check button disabled |
| Provider down | 5xx / timeout | "igloohome unavailable" + retry button (GET only) |
| Unexpected shape | Parse failure | "Unexpected response" + link to inspector entry |
| Job: requested | POST in flight | Spinner, button disabled |
| Job: queued | 200 `{jobId}` | "Queued at Bridge" |
| Job: in progress | Poll, not completed | "Waiting for lock/Bridge…" + elapsed time |
| Job: finished | `completed: true` | Raw status + interpretations (+ "meaning unverified" until D23 closed) |
| Job: expired/unknown | Past expiry, not completed | "No result — outcome unknown"; never shown as success |

## 5. Redaction and confirmation rules

- Tokens, client secret, PINs, keys and master-PIN values never render. Device IDs render redacted by default; a "show full ID" toggle is local-only and never logged.
- Slice 1 has **no mutating operation**. The only confirmation is for health-check jobs (they contact a device). Any future mutating action (PIN, lock/unlock) requires a typed confirmation of the redacted device ID and a reason, and is outside this slice.
