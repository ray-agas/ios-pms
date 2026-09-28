# Integration Architecture — igloohome POC

Date: 2026-09-25 (revised: Next.js + Auth.js, per user decision) · Status: PROPOSED (part of [implementation plan](../plans/igloohome-implementation-plan.md)).
Scope: slice 1 (connect, discover, health-check). Extension points for later slices are noted but not built.

This is a **fresh, standalone project**. It does not reuse or depend on any other Bobobox service or its conventions.

## 1. Principles

1. **One deployable app**, one codebase, one SQLite file. No broker, no microservices, no CQRS/event sourcing (CLAUDE.md §3.4).
2. **Vendor knowledge stays in one module** (`src/server/igloohome`). Everything else sees our own read models.
3. **No abstraction without a second user.** One provider → one concrete client, no interface. Extract a TypeScript `interface` when a second provider or a test double needs it.
4. **Truth stays with the provider.** We store only what we must: our API-call log and our job tracking.
5. **Safety is enforced in code, not in docs:** scopes, device allowlist, feature flag, role check, no auto-retry of job POSTs.
6. **The browser never talks to igloohome.** All vendor calls run server-side; secrets never reach client bundles.

## 2. Stack (user decision 2026-09-25)

| Concern | Choice | Why |
|---|---|---|
| Runtime | Next.js runs on Node.js (v24 on the dev machine); **Bun 1.4** is the package manager, script runner and test runner (user decision 2026-09-25) | Bun for speed; Node runtime for full Next.js compatibility |
| Framework | **Next.js 16.3 (App Router, Turbopack), TypeScript strict**. Next 16: `middleware` is renamed **`proxy`**; request APIs (`params`, `cookies()`) are async-only | UI and server in one app → fast development; server-side secrets via route handlers / server actions |
| Dashboard login | **Auth.js v5** (`next-auth@5.0.0-beta.32`, pinned; v5 is still beta) — Google provider restricted to `@bobobox.com` (when an OAuth client is available) **+ credentials fallback** (single operator, bcrypt hash in `.env`) | User decision; OAuth client not available yet |
| Server-only guard | `server-only` package imported by every module under `src/server` | Build fails if server code is imported into a client component |
| HTTP to igloohome | Native `fetch` (server side) with explicit timeout via `AbortSignal.timeout` | No extra dependency |
| Response validation | `zod` (lenient objects: unknown keys kept, conditional fields optional) | Vendor schemas are incomplete |
| Persistence | SQLite via **`@libsql/client`** (raw SQL, no ORM — two small tables do not justify one). Works under Node (app) and Bun (tests); `better-sqlite3` does not run on Bun | Needed now for webhook events (§7a) |
| Logging | Deferred to M2 (client already emits redacted `ApiCallRecord`s through `onCall`) | Nothing to log yet |
| Tests | **`bun test`** (preload stubs `server-only`); vendor calls stubbed by injecting a `fetch` implementation | Fast, no network, no extra test framework |
| Experiment CLI | Bun script (`bun scripts/…`) calling the same use cases | Bun runs TypeScript directly |
| Lint/format | ESLint (Next config) + Prettier | Default Next tooling |
| Styling | **Tailwind CSS**, design tokens as CSS variables (light + dark) | User decision; mobile-first utilities |
| UI primitives | shadcn/ui (copied components on Radix) + `lucide-react` icons | Accessible dialogs, sheets, switches, tabs without building them; fits Tailwind |
| Motion | **`motion` 13 (`motion/react`)**, decided in M3 (2026-09-26): user asked for smooth animation. Honors reduced motion via `MotionConfig reducedMotion="user"` | Layout, list and expand transitions that CSS alone does badly (see §8b) |

Exact package versions are chosen at M1 and recorded in `package.json`; nothing here assumes a specific version's API beyond what is verified then.

## 3. Layers and layout (proposed, created in M1)

```
iot-pms/
  src/
    app/                          # Next.js routes (UI)
      login/page.tsx
      (dashboard)/                # all pages behind auth
        page.tsx                  # Connection
        devices/page.tsx
        devices/[deviceId]/page.tsx
        topology/page.tsx
        jobs/[jobId]/page.tsx
        inspector/page.tsx
      api/
        auth/[...nextauth]/route.ts
        jobs/[jobId]/route.ts     # JSON for client-side polling (auth required)
    auth.ts                       # Auth.js config: Google (optional) + Credentials fallback, roles
    proxy.ts                      # Next 16 proxy (ex-middleware): redirects unauthenticated requests to /login
    instrumentation.ts            # fail fast at server start on unsafe config
    server/                       # every file imports 'server-only'
      config.ts                   # env parsing with zod; fails fast without explicit scopes / auth secret
      logger.ts                   # pino + redaction
      igloohome/
        CONTRACT.md               # selected API contract + sources (see §6)
        client.ts                 # the only place that builds URLs/requests
        token.ts                  # client-credentials token fetch + in-memory cache
        schemas.ts                # zod schemas for vendor responses
        mapping.ts                # vendor → our read models (anti-corruption layer)
        errors.ts                 # HTTP status/message → typed errors
        redaction.ts              # secret/PIN scrubbing
        catalog.ts                # operation metadata for Developer mode (see §8a)
        codes.ts                  # code dictionaries with evidence labels (see §8a)
      domain/models.ts            # ConnectionStatus, DeviceSnapshot, TopologyEdge, ActivityEntry, ProviderJob
      application/
        use-cases.ts              # checkConnection, listDevices, getDevice, getTopology, getActivity,
                                  # startHealthCheck, refreshJob, listApiCalls
        safety.ts                 # allowlist, feature flag, role check, per-Bridge rate guard
      storage/
        schema.ts  db.ts          # Drizzle: api_calls, provider_jobs
  scripts/experiment.ts           # CLI: runs E1–E8 through the same use cases, writes record skeletons
  tests/
    unit/  contract/  app/
    fixtures/igloohome/           # doc examples first, then real redacted captures
  .env.example  .gitignore
```

Dependency direction: `app` (pages, route handlers, server actions) and `scripts` → `server/application` → `server/igloohome` and `server/storage`. `server/domain` imports nothing. `server/igloohome` never imports `application` or `app`.

Client components receive only our read models (already redacted), never vendor payloads or tokens.

## 4. Provider boundary (anti-corruption layer)

### 4.1 What the igloohome module owns

- Base URL, paths, query parameters, headers, form/JSON encoding.
- Token acquisition (`POST {IGLOOHOME_AUTH_TOKEN_URL}`, Basic auth, `grant_type=client_credentials`, explicit `scope`), cached in memory until `expires_in` minus a safety margin; one re-fetch on 401.
- Vendor field names and codes: `deviceId`, `homeId`, `linkedDevices`, `lockStatus`, `jobType`, `jobData`, `jobResponse.jobStatus`, `opResult`, `nextCursor`, error bodies (`{"error"}` and `{"message"}` shapes).
- Pagination (`limit` ≤ 300, `cursor`, `sort` asc/desc).
- Mapping to our models; unknown fields preserved in a redacted `raw` copy for the inspector.

### 4.2 Client surface for slice 1 (only documented operations)

| Method | Vendor operation | Evidence |
|---|---|---|
| `getToken()` | H1 | DOC |
| `serverHealth()` | H6 `GET /server-health` | DOC-PARTIAL |
| `listProperties()`, `getProperty(id)`, `listPropertyDevices(id)` | H7–H9 | DOC |
| `listDevices({ type })`, `listPinCapableDevices()` | H10, H11 | DOC |
| `getDevice(deviceId)` | H12 | DOC |
| `listActivity(deviceId, { start, end, limit, cursor })` | H14 | DOC |
| `createProxiedJob(deviceId, bridgeId, jobType)` — **jobType restricted to 9 \| 10 at the type level and at runtime** | H28 | DOC |
| `createBridgeJob(bridgeId)` — **jobType fixed to 10** | H29 | DOC |
| `getJob(jobId)` | H30 | DOC, D23 |
| `createAlgoPin(deviceId, type, body)` | H16–H20 | API (M5, EXP-20260926-02) |
| `createPinJob(deviceId, bridgeId, {jobType: 4 \| 5})` — PIN jobs only | H28 | API (M5, EXP-20260926-03) |
| `createLockJob(deviceId, bridgeId, 1 \| 2)` — emergency lock/unlock only, never `lockTime` | H28 | API + HW (F4b, EXP-20260927-02) |

Each job family has its own method, so no path reaches a job type it was not built for. `createProxiedJob` still accepts only 9 and 10. Each change to this surface went through its own approved plan (M5, foundation F4b).

### 4.3 Our read models (vendor-neutral, slice 1 only)

| Model | Fields (ours) | From vendor |
|---|---|---|
| `ConnectionStatus` | ok, flow, grantedScopes, tier, subscriptionEndsAt, checkedAt | token response + H6 |
| `DeviceSnapshot` | providerDeviceId, modelPrefix, kind (lock/keypad/bridge/fob/switch/unknown), name, batteryPercent?, lastSyncAt?, lockState? (locked/unlocked), propertyIds, capabilities, fetchedAt | H10/H12 + supported-devices table |
| `TopologyEdge` | fromDevice, toDevice, relation ("linked"), source ("api" \| "app") | `linkedDevices` + manual app record |
| `ActivityEntry` | occurredAt, kind, description | H14 |
| `ProviderJob` | id, providerJobId, deviceId, bridgeId, kind, createdAt, rawStatus, interpretedStatus, statusConfidence, expiresAt, result | H28/H29/H30 |

`kind = "switch"` is derived from the `SW1X` prefix, because the documented `type` values are only Lock/Keypad/Bridge/Fob; the real value is recorded in E3. Capabilities come from the supported-devices table plus H11 and are labelled **documented**, not verified. `statusConfidence = "unverified"` exists only because of D23 and is removed after E7.

## 5. Errors, retries, rate limits

| Condition | Typed error | UI shows | Retry policy |
|---|---|---|---|
| Network error / timeout | `ProviderUnavailable` | "igloohome unreachable" | GET: up to 2 retries, exponential backoff + jitter. Job POST: none |
| 401 | `ProviderAuthError` | "Credentials rejected" | Re-fetch token once, then fail |
| 400 | `ProviderValidationError` | Message (redacted) | None |
| 402 | `ProviderSubscriptionError` | Account banner ("trial ended / payment") | None |
| 403 | `ProviderScopeError` | Missing scope | None |
| 404 | `ProviderNotFound` | "Not found" | None |
| 406 + "offline" | `BridgeUnavailable` | "Bridge offline" | None |
| 406 + "not linked" | `LockNotLinkedToBridge` | "Lock is not linked to this Bridge" | None |
| 409 + timezone | `ProviderDataIntegrityError` | "Property has no timezone (fix in app)" | None |
| 418 | `CapabilityUnsupported` | "Not supported by this model" | None |
| 422 | `ProviderValidationError` | Message | None |
| 429 | `ProviderRateLimited(retryAfter)` | Countdown | GET: wait `Retry-After` once. POST: none |
| 5xx | `ProviderUnavailable` | "igloohome error" | GET: as network. POST: none |
| Response fails schema | `ProviderContractError` | "Unexpected response shape" + inspector link | None — this is evidence for the docs |

406 message matching uses the documented strings; unknown text falls back to `ProviderNotAcceptable` and is logged for the inventory.

App-side guards: one Bridge-targeted job per Bridge per 5 minutes (documented limit); at most one open health-check job per device (`jobStatus 2` "operation in progress" risk).

## 6. API contract and version isolation

`src/server/igloohome/CONTRACT.md` records base URL, token URL, flow, scopes used, and the source of each (docs.igloohome.co snapshot 2026-09-25 SHA-256, Stoplight snapshot, experiment IDs); each client method → vendor path → evidence status; open conflicts that affect code (D23).

When vendor docs change: re-download the corpus, compare checksums, diff, update `CONTRACT.md` + schemas + mappers + fixtures. Nothing outside the igloohome module should change unless the business meaning changes.

## 7. Persistence

SQLite file at `DATABASE_PATH` (default `./var/iot-pms.db`, git-ignored). Two tables in slice 1.

`api_calls`
| Column | Notes |
|---|---|
| id, created_at (UTC ISO 8601) | |
| correlation_id | ties one UI action → its calls |
| actor | signed-in dashboard user (email or fallback username) |
| operation | client method name, e.g. `getDevice` |
| method, path_template | `/devices/{deviceId}` — the real ID goes in `device_ref` |
| device_ref | redacted, e.g. `IGB4••••••a1` |
| status_code, latency_ms, outcome | outcome = typed error name or `ok` |
| source | `ui`, `try-it`, `cli` |
| request_excerpt, response_excerpt | **after redaction**, truncated |

`provider_jobs`
| Column | Notes |
|---|---|
| id, provider_job_id, device_id, bridge_id, kind, requested_by | full IDs allowed locally (file git-ignored); redacted in exports |
| created_at, last_polled_at, expires_at | |
| raw_status (JSON), interpreted_status, status_confidence | D23 handling |
| result (JSON) | battery / lock / door / Wi-Fi fields only |

Not stored: igloohome tokens, client secret, PINs, keys, master PIN, full activity logs (fetched live), device list (fetched live). Stale data: every page shows `fetchedAt`; device values show the vendor's `lastSync`; absent fields show "not reported", never 0. Auth.js uses JWT sessions (no user table in slice 1).

Manual app topology: `docs/architecture/test-site-topology.yaml` (redacted IDs; created in M2 after E3).

## 7a. Webhook intake (built 2026-09-26, milestone M2.5)

| Piece | File |
|---|---|
| Public route `POST /api/webhooks/igloohome` (exempt from login in `proxy.ts`; only path exposed by the tunnel) | `src/app/api/webhooks/igloohome/route.ts` |
| Store-first intake: size limit 256 KB, signature check, JSON parse, de-duplicate, insert | `src/server/webhook-intake.ts` |
| Vendor scheme: signature (as the docs' Node example), envelope reader (both documented shapes, `proxyId`/`accessoryId`), PIN fingerprinting | `src/server/igloohome/webhooks.ts` |
| SQLite (`@libsql/client`, works under Node and Bun) | `src/server/storage/db.ts` |
| Viewer | `bun run events` |

`webhook_events`: `id`, `received_at` (UTC ISO 8601), `dedupe_key` (unique: `event:<id>` or `sha256:<raw body>`), `event_id`, `event_type` (3/5/10), `event_date`, `product_id`, `product_type`, `bridge_id`, `verification` (`valid`/`invalid`/`no_key`/`no_signature`/`error`), `body` (sanitized JSON).

Rules: the raw body is never stored or logged; `pin`/`newPin`/`customPin` become `…Fingerprint` (HMAC, 16 hex); other secret keys redacted. Unverified events are stored but must not drive decisions. Storage errors return 500 so a retrying sender (retry policy undocumented) can resend. Signature host: the check tries `x-forwarded-host` and `Host`, because the tunnel sits in front.

## 8. Dashboard authentication and roles

| Item | Decision |
|---|---|
| Library | Auth.js (NextAuth) |
| Providers | **Google** (enabled only when `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` are set; accepts only verified emails in `AUTH_ALLOWED_EMAIL_DOMAIN`, optionally narrowed by `AUTH_ALLOWED_EMAILS`) **and Credentials fallback** (one username + bcrypt hash from env; enabled only when both are set) |
| Current state | OAuth client not available → **fallback is the active login** until Google is configured |
| Session | JWT session cookie (HTTP-only, `SameSite=Lax`, `Secure` when not on localhost), signed with `AUTH_SECRET` |
| Roles | `viewer`: all read-only pages. `operator`: viewer + start health checks. Google users are `viewer` unless listed in `AUTH_OPERATOR_EMAILS`; fallback user role from `AUTH_FALLBACK_ROLE` (default `operator`) |
| Enforcement | `middleware.ts` protects every route except `/login` and `/api/auth/*`; **role checked again inside each server action / route handler** (middleware alone is not trusted) |
| Brute force | Credentials login: in-memory limit (e.g. 5 failures per 15 min per IP + username), generic error message, constant-time compare via bcrypt |
| Audit | Every job request stores `requested_by`; every API call stores `actor` |
| Exposure | Still localhost / internal network in slice 1. Public exposure needs Google login (not the shared fallback password) and HTTPS |

bcrypt hash in `.env`: Next.js expands `$VAR` references in `.env` files, and bcrypt hashes contain `$` (`$2b$12$…`). Store the hash **base64-encoded** in `AUTH_FALLBACK_PASSWORD_HASH_B64` to avoid expansion (to be confirmed against the Next.js version chosen at M1). A small `scripts/hash-password.ts` helper generates the value locally; the plain password never goes in any file.

## 8a. Developer mode (added 2026-09-25 from review feedback)

Purpose: make the integration self-explaining while we verify it, so nobody has to cross-read the research docs to understand a response.

**Operation catalog** (`catalog.ts`) — one entry per client method, generated from the endpoint inventory, not invented:

| Field | Example |
|---|---|
| id | `getDevice` |
| inventoryRef | `H12` |
| method, pathTemplate | `GET /devices/{deviceId}` |
| scope | `igloohomeapi/get-devices` |
| risk | `R0` / `R1` |
| evidence | `DOC` → updated to `API` / `HW` after experiments, with experiment ID |
| docLinks | official page, e.g. `https://docs.igloohome.co/home/api_devices`; Stoplight page when it adds field rules; our inventory section |
| params | name, location (path/query/body), type, required, allowed values, source of each rule |

**Code dictionaries** (`codes.ts`) — every documented code, with source and verification label:

| Dictionary | Content (from docs) |
|---|---|
| HTTP status per operation | e.g. 406 → "Bridge offline" / "Lock is not linked to bridge" |
| `jobStatus` (job-complete webhook) | 0 success, 1 generic failure, 2 another operation in progress, 3 PIN not found, 5 invalid custom PIN length, 9 duplicate PIN, 12 insufficient PIN storage |
| `jobStatus` (GET /jobs, Stoplight) | 0 completed, 1 pending, 2 expired — **shown side by side with the row above until D23 is resolved** |
| Wi-Fi status (Bridge diagnostics) | 0 connected, 2 disconnected/SSID not found/invalid password, 5 no internet |
| Activity `logType` | 11–57 (+77, 93 from iglooworks) with translation and which extra fields apply |
| Job types | 1–29 with supported yes/no |
| Webhook event types | 3, 5, 10 |

Each decoded value is rendered as `9 → Duplicate PIN · source: docs.igloohome.co webhook job data · unverified`. Codes not relevant to slice-1 operations are still available in a reference view, marked "not used by slice 1".

**Developer panels** (toggle per user, stored in a cookie, off by default): on every screen, for each call behind it: redacted request (method, URL, query, body, headers with `Authorization` masked), response status/latency/body (redacted), decoded codes, catalog entry and doc links.

**"Try it" console:**
- Only operations in the catalog; no free-form URL, method or job type (a free-form proxy would bypass the job-type restriction and could send lock/unlock).
- Parameters are form fields validated with the same zod schemas; device IDs picked from discovered devices.
- R0 operations: `operator` role. R1 operations (jobs 9/10, Bridge job 10): same guards as health checks (allowlist, flag, confirmation, rate guard).
- Every run is stored in `api_calls` with `source = "try-it"`, so results can be exported as experiment evidence.
- Responses that do not match the documented schema are highlighted — this is how DOC entries get upgraded or corrected.

## 8b. UI / UX direction (added 2026-09-25 from review feedback)

**Direction:** an operations and verification tool, used again and again → **utilitarian, calm, dense, scannable**. No marketing layout, no gradients or decorative blobs, no cards inside cards.

**Two real usage contexts drive "mobile first":**
- **At the door / Bridge (phone):** the door tester during E8/E11/E14 needs connection status, device state, job progress and big, unambiguous confirmation controls.
- **At the desk (laptop):** Developer mode, inspector, topology comparison — wide tables and side panels.

**Memorable detail:** one consistent **evidence badge** system everywhere (`DOC` · `DOC-PARTIAL` · `API` · `HW` · `UNVERIFIED`), so every value, code and capability says how much we trust it. It is the product's purpose made visible.

| Area | Mobile (base, ≥ 360 px) | Desktop (`md`/`lg`) |
|---|---|---|
| Navigation | Bottom tab bar: Status · Devices · Jobs · Dev | Left sidebar + top bar |
| Device list | Single-column rows (name, kind icon, battery, last sync, badges) | Sortable table |
| Device detail | Stacked sections with tabs (Overview / Activity / Health) | Two columns: detail + activity |
| Topology | Grouped list of links ("Door lock → linked to Bridge · API ✓ · app ✓") | Simple diagram + diff list (no graph library unless needed) |
| Job progress | Full-width status timeline, large status text, `aria-live` updates | Same, in a side panel |
| Developer panels | Bottom sheet | Right-hand panel |
| Confirmations | Full-screen sheet, 44 px+ touch targets, device ID and effect spelled out | Modal dialog |
| Inspector | Filterable list, tap to expand | Table with expandable rows |

Rules:
- Mobile-first Tailwind: base styles target phones; `sm`/`md`/`lg` add layout, never the reverse.
- Stable dimensions for toolbars, badges, counters and status chips (no layout shift while polling).
- Long device names and IDs wrap or truncate with full value available on tap.
- Light and dark themes via CSS variables (dark helps in dim hallways).
- Accessibility: WCAG 2.2 AA contrast, visible focus rings, keyboard reachable, `aria-live="polite"` for job status, status never conveyed by colour alone (icon + text).
- Motion: only to clarify state changes — job status transitions, sheet/panel open, list updates. Respect `prefers-reduced-motion`. Start with CSS/Tailwind transitions; add `motion` only if job-timeline or layout animations need it, and record the reason.
- Skills to apply during M3: `frontend-design-direction` (this section), `accessibility` / `frontend-a11y`, `make-interfaces-feel-better`, and `motion-foundations` only if `motion` is adopted.

## 9. Security summary

| Control | Where |
|---|---|
| igloohome secrets and auth secrets only in `.env` (git-ignored); no `NEXT_PUBLIC_` secrets | `server/config.ts` |
| Startup refuses empty `IGLOOHOME_SCOPES` (docs: omitted = all permissions) and missing `AUTH_SECRET` | `server/config.ts` |
| `server-only` on all server modules | `src/server/**` |
| Token in memory only | `igloohome/token.ts` |
| Central redaction for logs, call log, inspector, experiment exports | `igloohome/redaction.ts` + `logger.ts` |
| Login required everywhere; role checked in each action | `middleware.ts` + `application/safety.ts` |
| Device allowlist + `IGLOOHOME_ENABLE_BRIDGE_JOBS` + confirmation + operator role | `application/safety.ts` + UI |
| No credential/actuation job types in the client; "Try it" limited to catalog operations | `igloohome/client.ts`, `catalog.ts` |
| Bind to localhost (`next start -H 127.0.0.1`) | run scripts |

## 10. Later extension points (not built in slice 1)

| Need | Where it goes |
|---|---|
| Webhooks (Job Complete, Bridge Connection, Activity Log) | `app/api/webhooks/igloohome/route.ts` + `igloohome/webhooks.ts` (signature verification; vendor example is Node `crypto`) → same `provider_jobs` table |
| Credential lifecycle (Slice 2) | new client methods behind `IGLOOHOME_ENABLE_CREDENTIAL_OPERATIONS`; business-named use cases ("issue stay access", "revoke stay access"); operator role + reason capture |
| Rooms / stays | `domain` + `storage` tables for room ↔ device mapping; igloohome module unaware |
| More roles / real user store | Replace env allowlists with a users table when more than a handful of people need access |
| Second lock provider | Extract an interface from the client surface actually used |
