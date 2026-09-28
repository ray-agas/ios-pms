# Implementation Plan — igloohome Integration Foundation and First Vertical Slice

Date: 2026-09-25 · Status: **APPROVED 2026-09-25 (Plan Canvas verdict). M1 complete; M2 in progress (EXP-20260925-01 done) — see §21.**
Evidence labels as in [research README](../research/igloohome/README.md#evidence-labels). Endpoint IDs (H#) from [02-endpoint-inventory.md](../research/igloohome/02-endpoint-inventory.md).

Architecture detail lives in:
- [integration-architecture.md](../architecture/integration-architecture.md) — layers, provider boundary, persistence, errors, security
- [device-topology.md](../architecture/device-topology.md) — hardware model and verification status
- [first-slice-workflow.md](../architecture/first-slice-workflow.md) — user workflow, screens, states
- [environment-configuration.md](../architecture/environment-configuration.md) — `.env` variables
- [10-experiments-plan.md](../research/igloohome/10-experiments-plan.md) — experiment execution procedure

---

## 1. Scope and selected first vertical slice

**Slice 1: "Connect, discover, and health-check the test site."**

An operator can:
1. See whether the igloohome API connection works, which scopes the token has, and the subscription state.
2. See every device the API returns (locks, keypads, Bridge, switch), with type, model prefix, capabilities, battery, last sync and lock status where the API provides them.
3. See the device topology **as the API reports it**, side by side with the topology we know from the mobile app, with differences highlighted.
4. See recent activity history for a device.
5. Run a **read-only Bridge health check** on an allowlisted test device (live battery, live lock/door status, Bridge Wi-Fi diagnostics) and watch the asynchronous job until it finishes.
6. Inspect every API request and response, with secrets redacted.
7. Switch on **Developer mode** (added 2026-09-25 from review feedback): for every operation, see the exact request, which igloohome endpoint and documentation page it maps to, the evidence status, and a plain-language decoding of every code in the response (HTTP status, `jobStatus`, log types, Wi-Fi status). A **"Try it" console** lets an operator re-run slice-1 operations with editable parameters to verify documented behaviour — restricted to the same allowlisted operations and guards as the rest of the app.

Why this slice (evidence-based):

| Reason | Evidence |
|---|---|
| Every operation in it is documented, and read-only or low-risk (R0/R1) | DOC: H1, H6–H12, H14, H28 (jobs 9, 10), H29, H30 |
| It resolves the blockers that every later feature depends on: base URL (D1, D22), token behaviour (D3), real schemas (U1–U3), job-status meaning (D23), the Bridge link check (406 "Lock is not linked to bridge") | `07`, `12` |
| It answers how the API represents our keypads, switch and Bridge — unknown today and critical for the bedlock use case | `device-topology.md` |
| It proves the full async path (POST job → poll → terminal state) without changing any credential or moving any lock | DOC H28/H30 |
| It needs no public webhook endpoint (polling is documented) | DOC H30 |
| The account is an igloohome **User** account; nothing here needs Partner or iglooworks features | User-provided context; `03` |

**Deliberately excluded from slice 1** (see §18): any PIN/credential creation or deletion, lock/unlock, master PIN, Bluetooth keys, iglooKey, passage mode, Bridge log pull (job 15), webhooks, room mapping, and any write endpoint.

The previously recommended "guest stay access" workflow (`11-research-synthesis.md` §9) becomes **Slice 2**. Its credential lifecycle is run first as a separate experimental milestone (M5), as the brief requires, because it is not yet verified.

## 2. User workflow (slice 1)

Operator = a Bobobox engineer on the test site. Full screen and state detail: `first-slice-workflow.md`.

```
Open dashboard
  → Connection panel: token OK? scopes? tier? subscription end?   (H1, H6)
  → Devices: list from API, grouped by type; missing fields shown as "not reported"   (H10, H11)
  → Device detail: fields + capability badges + last sync + lock status   (H12)
  → Topology: API relationships vs. mobile-app relationships (manual record)
  → Activity: recent history for the device   (H14)
  → [allowlisted device only] "Run health check" → confirm dialog → job created → polling → result   (H28 job 9/10, H29, H30)
  → Request inspector: every call, redacted, with status and latency
```

## 3. API dependencies and evidence

| Use case | Operation | Scope | Evidence today | Becomes `API` after |
|---|---|---|---|---|
| Get token | H1 `POST {AUTH_TOKEN_URL}` | — | DOC (A + B) | E1 |
| Connection status | H6 `GET /server-health` | none stated | DOC-PARTIAL (A only) | E2 |
| Properties | H7, H8, H9 | `get-properties`, `get-devices` | DOC (A + B) | E4 |
| Device list / algoPIN-capable list | H10, H11 | `get-devices` | DOC (A + B; H11 A only) | E3 |
| Device detail | H12 (no `admin_key`/`lock_id` params) | `get-devices` | DOC (A + B) | E3 |
| Activity history | H14 | `get-device-activity` | DOC (A only) | E4 |
| Live battery | H28 job 9 | `get-battery-level-bridge-proxied-job` | DOC (A + B) | E7 |
| Live lock/door status | H28 job 10 | `get-device-status-bridge-proxied-job` | DOC (A + B) | E8 |
| Bridge diagnostics | H29 job 10 | `get-device-status-bridge-proxied-job` | DOC (A + B) | E6 |
| Job status | H30 `GET /jobs/{jobId}` | `get-job-status` | DOC, **D23 conflict** | E7 |

A = docs.igloohome.co (primary), B = Stoplight (secondary reference), per `12-stoplight-comparison.md` §5.

## 4. Account and permission requirements

| Item | Status | Plan |
|---|---|---|
| Account type | **igloohome User** (user-provided); portal `web.igloohome.co/api` | Individual path: client credentials flow. No iglooconnect, no iglooworks endpoints |
| Credentials | Not yet supplied | Operator copies Client ID + Secret from portal → local `.env` only |
| Scopes for slice 1 | Defined | `igloohomeapi/get-devices igloohomeapi/get-properties igloohomeapi/get-device-activity igloohomeapi/get-job-status igloohomeapi/get-battery-level-bridge-proxied-job igloohomeapi/get-device-status-bridge-proxied-job` |
| Scopes explicitly **not** requested | Policy | lock, unlock, create/delete PIN, algoPIN, master PIN, ekey, update-device. Docs: omitting `scope` grants **all** — the app must refuse to start without an explicit scope list |
| Subscription | Trial or paid, unknown | Read `tier`/`endsAt` from H6; show `402` as account-level alert |
| Device-level permissions | Not supported by vendor scopes | Enforced by our allowlist (`IGLOOHOME_ALLOWED_DEVICE_IDS`) |

## 5. Hardware and Bridge prerequisites

From user context (see `device-topology.md` for the full model):

| Prerequisite | Status |
|---|---|
| One Bridge, powered, on Wi-Fi, configured in the mobile app | Confirmed physically / in app (user) |
| Door lock linked to the Bridge | Confirmed in app (user); API link unverified → E3 + E7 (`406 Lock is not linked to bridge`) |
| Door lock with built-in keypad | Confirmed physically (user); model prefix unknown → E3 |
| Separately linked keypad | Confirmed in app (user); API representation unknown → E3 |
| Switch with keypad readers (internal bedlock) | Confirmed in app (user); API support **NF** beyond the supported-devices row (SW1X, algoPIN No) → E3, E3b |
| Devices assigned to a property with a timezone | Unknown; missing timezone → `409` on many endpoints → E4 |
| Test devices serve no guests | Confirmed (user) |

Model prefixes and the Bridge ID **do not need to be supplied manually**: they are discoverable from H10 (`deviceId` = Bluetooth name; the prefix identifies the model). The operator only needs to confirm, after E3, which discovered IDs are the test devices, and put them in the allowlist. Committed docs use redacted IDs (`IGB4••••••a1`).

## 6. API version selection

| Item | Selected contract | Source |
|---|---|---|
| Documentation generation | **docs.igloohome.co, snapshot 2026-09-25** (`llms-full.txt` SHA-256 `b88348de…c311e`) — linked from the user's portal | User + DOC |
| Product | igloohome API ("API V2" per supported-devices page) | DOC |
| Base URL | `https://api.igloodeveloper.co/igloohome` | DOC (A guides + B OpenAPI `servers`) + PROBE + 3P |
| Token | `POST https://auth.igloohome.co/oauth2/token`, form-encoded, Basic auth, `grant_type=client_credentials`, explicit `scope` | DOC (A + B) |
| Not used | `/v1` base (llms.txt), `api.igloohome.co/home` (reference examples), REST `/token` wrapper (H4/H5), iglooworks hosts | Outliers / other product |
| Field-level rules | From B where A is silent (required fields, conditional presence, `sort` enum) — treated as working assumptions | `12` §5 |
| Conflicts | D23–D27 stay open; the live API decides | `12` §4 |

Old vs new differences that affect slice 1: base URL (settled toward `api.igloodeveloper.co/igloohome`), `lockStatus` (only in B, conditional), `server-health` and activity (only in A), and job-status meaning (D23). No slice-1 operation is deprecated in either source; neither source has a deprecation policy (NF).

Version isolation: the contract above is written into the provider package's own `CONTRACT.md` (one file, created in M1). Only the provider package knows paths, field names and codes. A future docs change is detected by re-downloading `llms-full.txt` and comparing the SHA-256 (`10` §8), and absorbed inside the provider package.

## 7. Integration architecture (summary)

**Fresh standalone project** (no dependency on other Bobobox services). One **Next.js (App Router, TypeScript)** app, per user decision 2026-09-25: UI and server in one codebase for fast development, with all igloohome calls server-side. Dashboard login via **Auth.js** (Google restricted to `@bobobox.com` when available; bcrypt-hash fallback login now).

```
Browser (dashboard pages, login)
   │  session cookie (Auth.js)
   ▼
Next.js server: pages · server actions · route handlers ─┐
Experiment CLI (tsx script, same use cases) ─────────────┼─► Application use cases ─► igloohome module ─► igloohome API
                                                          │        │                  (client, token, zod schemas,
                                                          │        └─► SQLite (Drizzle): api_calls, provider_jobs
                                                          └─ role check (viewer / operator)             mapping, errors, redaction)
```

No message broker, no microservices, no CQRS/event sourcing (CLAUDE.md §3.4). Details: `integration-architecture.md`.

## 8. Provider adapter boundary

- **Anti-corruption layer = the provider package's mapping functions.** Vendor JSON is parsed into vendor DTOs (tolerant: unknown fields kept, conditional fields optional) and mapped to **our** read models (`DeviceSnapshot`, `TopologyEdge`, `ConnectionStatus`, `ProviderJob`) before leaving the package.
- **No gateway interface yet.** There is one provider; an abstract interface with one implementation is not justified. The module exposes one client; a TypeScript interface is extracted when a second provider appears.
- **Business naming is limited to what slice 1 establishes:** "connection", "device", "topology", "health check", "activity". No "guest access", "room" or "stay" concepts in slice 1 code.
- Vendor terms (`jobType`, `bridgeId`, `homeId`, `linkedDevices`) never appear outside the provider package.

## 9. Application use cases

| Use case | Provider calls | Mutating? |
|---|---|---|
| `check_connection()` | H1, H6 | No |
| `list_devices(filter)` | H10 (paginated), H11 | No |
| `get_device(device_id)` | H12 | No |
| `get_topology()` | H10 + H12 → edges; merged with manual app-topology record | No |
| `list_properties()` | H7, H9 | No |
| `get_activity(device_id, range)` | H14 | No |
| `start_health_check(device_id, kind)` — `kind` ∈ {lock_battery, lock_status, bridge_diagnostics} | H28 job 9 / 10, H29 | Contacts device (R1); allowlist + confirmation |
| `refresh_job(job_id)` | H30 | No |
| `list_api_calls(filter)` | local SQLite | No |
| `describe_operation(op)` | none — static catalog (method, path, scope, risk, evidence, doc links) | No |
| `decode_codes(response)` | none — static code dictionaries with evidence labels | No |
| `try_operation(op, params)` | same client methods as above, only for catalog operations | R0 ops: operator; R1 ops: same guards as health check |

(Final code names follow TypeScript camelCase, e.g. `checkConnection`, `startHealthCheck`.) Every use case receives the signed-in actor; `start_health_check` requires the `operator` role.

## 10. Dashboard screens

Connection, Devices, Device detail, Topology, Activity, Health-check job, Request inspector, and a **Developer mode** toggle (request/doc/code panels on every screen + "Try it" console).

UI (user decision 2026-09-25): **mobile-first, responsive**, Tailwind CSS, shadcn/ui primitives, light/dark themes, WCAG 2.2 AA. Phone layout serves the door tester during hardware experiments; desktop serves Developer mode and inspection. Framer Motion (`motion`) is **not adopted up front**: CSS transitions first, `motion` only if a concrete state animation needs it. Direction and per-screen mobile/desktop layout: `integration-architecture.md` §8b. States for each (loading, empty, 401, 402, 403, 404, 406, 409, 429, 5xx, timeout, job in progress/succeeded/failed/unknown): `first-slice-workflow.md` §3–§4.

## 11. Persistence

| Stored (SQLite file, git-ignored) | Why | Not stored |
|---|---|---|
| `api_calls`: time, operation, method, path template, status, latency, **redacted** request/response excerpt, correlation id | Inspector + experiment evidence | Access tokens, client secret, PINs, keys, master PIN |
| `provider_jobs`: our id, provider `jobId`, device, bridge, kind, created_at, last polled, raw status, our interpreted status, expiry | Async jobs outlive a request; restart-safe polling | — |
| Manual app-topology record (YAML file in repo, redacted IDs) | Compare with API topology | — |

Provider-owned and **never cached as truth** in slice 1: devices, properties, battery, lock status, activity. Every screen shows `fetched_at`; device fields show the provider's own `lastSync`. No device cache table — live fetch is cheap at test-site scale. Token held in memory only.

## 12. Credential and security handling

- Client ID/Secret only in local `.env`; `.env` git-ignored; `.env.example` has no values.
- Token in process memory; refreshed ~1 h before `expires_in` ends; never logged or stored.
- Single redaction function applied to **every** log line and inspector record: `Authorization`, `client_secret`, `access_token`, `pin`, `newPin`, `bluetoothGuestKey`, `admin_key`, master-PIN responses, and PIN values inside activity logs. Redaction has its own unit tests (must fail if a known secret leaks).
- **Dashboard login required on every page** (Auth.js). Google sign-in restricted to verified `@bobobox.com` emails when an OAuth client exists; until then a single fallback login (username + bcrypt hash, stored base64-encoded in `.env`). Roles: `viewer` (read-only), `operator` (+ health checks); role re-checked in every server action/route handler. Login attempts rate-limited. Every call and job records the actor.
- All igloohome code under `src/server` imports `server-only`; no secret uses `NEXT_PUBLIC_`; the browser never calls igloohome.
- Still bound to `127.0.0.1` / internal network in slice 1. Exposure beyond that requires Google login (not the shared fallback) and HTTPS.
- Slice 1 performs **no credential operations**. §8 of the brief is handled by M5 (experimental) and Slice 2.

## 13. Error handling and operational safety

Mapping (full table in `integration-architecture.md` §5):

| Provider response | Our error | Retry? |
|---|---|---|
| 401 | `ProviderAuthError` → re-fetch token once, then fail | once |
| 402 | `ProviderSubscriptionError` (account-level banner) | no |
| 403 | `ProviderScopeError` (show missing scope) | no |
| 404 | `ProviderNotFound` | no |
| 406 | `BridgeUnavailable` (offline) / `LockNotLinkedToBridge` (message match) | no |
| 409 timezone | `ProviderDataIntegrityError` ("property has no timezone") | no |
| 418 | `CapabilityUnsupported` | no |
| 429 | `ProviderRateLimited(retry_after)` | GET: wait `Retry-After`; job POST: no auto-retry |
| 5xx / timeout / network | `ProviderUnavailable` | GET: 2 retries with backoff; job POST: **never** |

Safety rules: job POSTs are never retried automatically; a job created twice is worse than a job missing. Health checks are allowed only for allowlisted devices, need a confirmation click, and are disabled unless `IGLOOHOME_ENABLE_BRIDGE_JOBS=true`. There is an app-side guard of one Bridge-targeted job per Bridge per 5 minutes (documented limit). Until D23 is resolved, the dashboard shows the **raw** `jobStatus` and the webhook-docs interpretation side by side, and labels the result "unverified meaning".

## 14. Testing strategy

| Level | What | How |
|---|---|---|
| Unit | Redaction, error mapping, token expiry logic, zod parsing of conditional fields, mappers, allowlist, role check, rate guard, env validation | Vitest; no network |
| Provider contract | Client with an injected `fetch` stub, using **doc examples first**, replaced by **real redacted captures** after M2 | Vitest fixtures in `tests/fixtures/igloohome/` |
| Application | Use cases with a stub client | Vitest |
| Auth | Unauthenticated request → redirect; viewer cannot start a job; fallback login accepts correct hash only; lockout after repeated failures; Google provider rejects non-`bobobox.com` email | Vitest (auth callbacks as functions) |
| UI | Each state from §13 renders (loading/empty/errors/job states); responsive layouts at 360/768/1280 px; basic a11y checks | Vitest + React Testing Library on components; Playwright viewport smoke test + axe in M3 |
| Live (manual only) | Experiments E1–E8 via `scripts/experiment.ts`, never in CI, gated by explicit flags | Experiment records |
| Safety | Non-allowlisted device cannot start a job; job POSTs never retried; missing `IGLOOHOME_SCOPES` or `AUTH_SECRET` stops startup; no igloohome module in the client bundle (`server-only` build check) | Vitest + `next build` |

Coverage target: unit + contract tests on the igloohome module, redaction and auth; no coverage theatre on page markup.

## 15. Hardware experiment sequence

Full procedure, roles and physical conditions: `10-experiments-plan.md` §9 (added with this plan).

| Order | Experiment | Milestone | Physical presence |
|---|---|---|---|
| 1 | E1 token, E2 server-health, E4b scope check | M2 | None |
| 2 | E3 device discovery + E3b topology comparison (keypads, switch, Bridge) | M2 | None (someone with the mobile app to read the app topology) |
| 3 | E4 properties + activity | M2 | None |
| 4 | E6 Bridge diagnostics | M4 | None; Bridge powered |
| 5 | E7 lock battery job + D23 resolution | M4 | Optional; lock within Bridge range |
| 6 | E8 lock status job (door open/closed) | M4 | **One person at the door** to open/close it between two runs |
| 7 | E9 Bridge offline | M4 (optional) | One person to unplug/replug the Bridge |
| 8 | E10–E14 credential lifecycle | **M5 (separate approval)** | E11/E14: see `10` §9.4 — two people |
| — | E15 remote unlock | Not planned | — |

## 16. Environment variables

Full table with sources and verification status: `environment-configuration.md`. The template is `/.env.example`.

Required for slice 1: `IGLOOHOME_API_BASE_URL`, `IGLOOHOME_AUTH_TOKEN_URL`, `IGLOOHOME_CLIENT_ID`, `IGLOOHOME_CLIENT_SECRET`, `IGLOOHOME_SCOPES`, `AUTH_SECRET`, `AUTH_URL`, and the fallback login pair `AUTH_FALLBACK_USERNAME` + `AUTH_FALLBACK_PASSWORD_HASH_B64` (until Google is configured). Optional: `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`, `AUTH_ALLOWED_EMAIL_DOMAIN`, `AUTH_ALLOWED_EMAILS`, `AUTH_OPERATOR_EMAILS`. Safety switches: `IGLOOHOME_ALLOWED_DEVICE_IDS`, `IGLOOHOME_ENABLE_BRIDGE_JOBS`. Not needed: refresh token, redirect URI, API key (iglooworks), webhook public key (later), SDK GitLab token (not used).

## 17. Risks and unresolved questions

| Risk / question | Likelihood | Impact | Mitigation |
|---|---|---|---|
| D23 job-status meaning | High (docs conflict) | Wrong "done/failed" display | Show raw + both interpretations until E7; resolve before Slice 2 |
| API topology differs from app topology (keypads, switch) | High | Misleading topology view | Topology screen is explicitly a comparison; manual app record |
| **Switch/bedlock not controllable via API** | Unknown (NF) | Bedlock use case may need the mobile app or other hardware | E3/E3b discovery; ask igloohome support; not assumed |
| Linked keypad has no independent API capabilities | Unknown | PIN strategy for Slice 2 | E3 + H11 `support-pins` output |
| Base URL wrong | Low | All calls fail | E2 against both candidate bases |
| Undocumented rate limits | Medium | 429 during experiments | Honour `Retry-After`; no loops; log headers |
| Trial expiry (402) mid-project | Medium | All calls stop | Show `endsAt`; plan subscription |
| Secret leak via logs/inspector | Low with tests | High | Central redaction + failing tests |
| Server secrets leak into client bundle | Low | High | `server-only` imports, no `NEXT_PUBLIC_` secrets, build check |
| Shared fallback password | Medium | Medium | Localhost/internal only; rate limit; move to Google before any exposure |
| No Google OAuth client for a while | High | Low | Fallback login covers slice 1 |

Decided 2026-09-25: stack = Next.js + TypeScript; login = Auth.js with Google (later) + hashed-password fallback (now); fresh project, no reuse of other Bobobox services. Open: Q1 confirm localhost/internal-only in slice 1. Q2 who records the mobile-app topology for E3b. Q3 ask igloohome support about Switch/keypad-reader API support, D23, Bridge jobs 31/32. Q4 who owns a Google OAuth client later.

## 18. Out of scope (slice 1)

Credential operations of any kind (algoPIN, custom PIN, delete PIN, ekey, iglooKey, passage); master PIN; lock/unlock; Bridge log pull (job 15); `PUT /devices`; `POST /activity`; webhooks and signature verification; room/stay/guest concepts and room mapping; multi-account/partner flows; iglooworks; onboarding/pairing (not in REST); firmware; bulk operations; roles beyond viewer/operator; a user database; deployment beyond localhost/internal network; any message broker or advanced pattern.

## 19. Milestones

| # | Milestone | Output | Exit criteria |
|---|---|---|---|
| **M0** | Plan + config docs (this document) | Plan, architecture docs, `.env.example`, `.gitignore` | **User approval** |
| M1 | Skeleton + igloohome module + login, offline | Next.js app, env validation, Auth.js (fallback login active, Google wired but off), roles, token client, redaction, error mapping, zod schemas + mappers from doc examples, `hash-password` script, unit/contract/auth tests | Tests green; `next build` passes; no igloohome network call; startup fails without explicit scopes or `AUTH_SECRET`; every page requires login |
| M2 | Read-only live experiments (E1–E4b) via CLI | Experiment records; real redacted fixtures; inventory entries upgraded to `API`; topology comparison | D1, D3, D22, U1–U3 resolved; test devices identified and allowlisted |
| **M2.5** | **Webhook receiver + event store** (added 2026-09-26, user-approved) | Public `POST /api/webhooks/igloohome`, signature check, de-duplicated sanitized SQLite store, `bun run events`, Cloudflare named tunnel exposing only that path | First real event received and stored; signature verified `valid` once the public key is available |
| M3 | Read-only dashboard + Developer mode | Connection, Devices, Detail, Topology, Activity, Inspector screens; operation catalog, code dictionaries, developer panels, "Try it" for R0 operations | All states render; redaction verified on real data; every catalog entry links to its doc page and evidence status |
| M4 | Bridge health check | Job creation for jobs 9/10 + targeted 10, polling, job screen, "Try it" enabled for these R1 operations; E6–E8 (E9 optional) | D23 resolved or documented; Bridge-link check done; **Slice 1 complete** |
| M5 | Credential lifecycle experiments (E10–E14), CLI only | Experiment records; decision memo for Slice 2 credential type | Separate approval before start; results reviewed |
| M6 | Plan Slice 2 "Guest stay access for one room" | New plan via `/ecc:plan` | Based on M5 evidence |

Estimated complexity: **Medium**. M1 ≈ 1.5–2 days (includes login), M2 ≈ 0.5 day + experiment time, M3 ≈ 3–4 days (includes Developer mode and responsive/mobile-first UI), M4 ≈ 1–1.5 days. Estimates exclude waiting for credentials or vendor answers.

## 20. Definition of done (slice 1)

- [ ] All M1–M4 exit criteria met.
- [ ] Every slice-1 operation in the inventory is upgraded from `DOC` to `API` (or `HW` for jobs), with a redacted experiment record.
- [ ] D1, D3, D22, D23 closed or explicitly documented with observed behaviour.
- [ ] Topology document updated with the API view of every test device, including keypads and switch.
- [ ] No secret, token, PIN or key appears in logs, SQLite, fixtures, docs or screenshots (checked by test + manual grep).
- [ ] Job POSTs are never auto-retried (test).
- [ ] Non-allowlisted devices cannot receive jobs (test).
- [ ] Error and job states from §13 are visible in the UI.
- [ ] Limitations and open questions updated in `07-unknowns-and-blockers.md`.
- [ ] No credential or physical-actuation operation exists in the codebase.
- [ ] Every page and route handler requires login; health checks require the `operator` role (tests).
- [ ] No igloohome module or secret appears in the client bundle (build check).
- [ ] Every screen usable at 360 px, 768 px and 1280 px widths without horizontal scroll or layout shift during polling; keyboard and screen-reader basics pass; light/dark themes.
- [ ] Developer mode: every catalog operation shows request, doc link, scope, risk and evidence; every numeric code shown is decoded with its source and verified/unverified label; "Try it" cannot call anything outside the catalog (test).

## 21. Progress log

### M1 — complete (2026-09-25)

Built: Next.js 16 app (Bun), env validation with fail-fast at server start (`instrumentation.ts`), Auth.js v5 login (fallback bcrypt login active; Google wired, off until `AUTH_GOOGLE_*` set), roles viewer/operator, `proxy.ts` gate, igloohome module (`token.ts`, `client.ts`, `schemas.ts`, `mapping.ts`, `errors.ts`, `redaction.ts`, `codes.ts`, `CONTRACT.md`), `hash-password` script, placeholder Connection page.

Verified: `bun run check` (typegen + tsc, eslint, 60 tests) and `next build` pass; runtime smoke test with throwaway env: signed-out → `/login`, wrong password → generic error, right password → session with role `operator`, home page renders without any igloohome call.

Changes from the plan, with reasons:
| Planned | Built | Why |
|---|---|---|
| Node + Vitest + tsx | **Bun** (install, scripts, `bun test`); Next still on Node | User decision |
| `middleware.ts` | `proxy.ts` | Next 16 renamed the convention |
| SQLite + pino in M1 | Deferred to M2/M3 | Not needed yet; `better-sqlite3` does not run under Bun, choose a driver that works in both |
| `AUTH_URL=http://127.0.0.1:3000` | `http://localhost:3000`; open the app at `localhost` | Smoke test showed redirects go to `localhost`; host mismatch drops the session cookie |
| Application `safety.ts` | Deferred to M4 | Only needed with health-check use cases; job-type restriction is already enforced in the client |
| Auth.js version unspecified | `next-auth@5.0.0-beta.32` pinned | v5 is still beta; pinned to avoid surprise breaks |

Not verified (needs M2): any real igloohome response, base URL, token behaviour, scopes, schemas.

### M2 — in progress (2026-09-25)

EXP-20260925-01 (E1–E4b, read-only) ran: token, server-health, devices, support-pins, device details, properties → **API-confirmed**; D1, D3, U1, U3, T1–T8 resolved; activity history **blocked (403, U18)**; scope enforcement confirmed (E4b 403). Captured sanitized fixtures + contract tests added (69 tests). Record: `docs/research/igloohome/experiments/EXP-20260925-01-phase-a.md`.

Update: user confirmed all 6 devices are test devices and allowlisted them; E3b matches. U18 (activity 403) persists after re-enabling app notifications → portal permission check / igloohome support. **M2 exit criteria met except U18**, which does not block M3 (Activity screen shows "blocked by API"). Impact on slice 1: Activity screen shows "blocked by API (403)" until U18 is answered; Bridge lookup must scan Bridge records (links are not on locks).

### M2.5 — built, awaiting first real event (2026-09-26)

Why: activity history is delivered by the Bridge as webhook events (type 5), logs are deleted from the lock once read, and `GET /devices/{id}/activity` is blocked (U18). Catching and storing events is the only documented way to keep history. The same receiver also gives Job Complete (3) and Bridge Connection (10) events.

Built: route, intake, signature check (vendor scheme), PIN fingerprinting, de-duplication, SQLite store, viewer. Verified: 80 tests; production smoke test on a throwaway DB (GET 405, POST stored, duplicate detected, non-JSON 400, dashboard still gated).

Remaining: named tunnel running; URL registered in the portal; first real event; public key → `valid`; then set `IGLOOHOME_WEBHOOK_REQUIRE_VALID_SIGNATURE=true`.

Update 2026-09-26 (first real events): 9 events received from the Doorlock via `bridge` (activity logs types 11, 13, 16, 19, 51; one Job Complete from a mobile-app action). Delivery 8–12 s after the lock's own timestamp. igloohome **does send** `x-igloocompany-sha256` (events show `no_key`, not `no_signature`). Portal Webhooks page has only the URL field — **public key must come from support** (email pending). Same PIN → same fingerprint across events (matching works). Webhook config is now validated at server start.

### M3 — part 1 built (2026-09-26): shell, Overview, Devices/topology, Activity

Built:
- App shell: sidebar on desktop and bottom tabs on mobile, skip link, `MotionConfig reducedMotion="user"`.
- Overview: connection status, scopes, trial countdown, stat tiles, rooms, and the latest 5 events.
- Devices: rooms, a Bridge → device tree, battery, lock state, last sync, and expandable details with evidence badges.
- Activity: live feed that polls `GET /api/activity?after=` every 5 s (the route checks the session). It has filters, day groups, an `aria-live` announcement, and clock syncs hidden by default.
- Login page restyled.
- UI kit: shadcn (radix-nova) and `motion`. motion was chosen because the user asked for smooth animation (§8b note resolved).

Security:
- Views sent to the browser carry display IDs only.
- A rendered-page scan found `FeedItem.deviceId` shipping full device IDs. It is now removed, and `tests/unit/activity-feed.test.ts` guards against it coming back.
- Rendered HTML and `/api/activity` were re-scanned against the full IDs and `.env` secrets: 0 hits.

Verified:
- `bun run check`: 82 tests pass.
- `next build` passes.
- Signed-out requests to `/` and `/api/activity` redirect to `/login`.
- Screenshots at 390 px (light) and 1440 px (dark): no horizontal overflow and no console errors.

Known gaps:
- Bridges show "No connection event yet" until a type 10 event arrives.
- The Bridge `lastSync` is shown as "Paired" (it equals the pairing time).
- Webhook events carry the `UNVERIFIED` badge until the public key arrives.

### M3 — part 2 built (2026-09-26): Developer mode

Built:
- `/developer` page with four tabs:
  - **Try it**: the 9 R0 catalog operations, run by the operator role only; Bridge jobs locked until M4.
  - **Inspector**: the latest 100 calls from the `api_calls` table.
  - **Catalog**: the 11 client operations, each with its inventory ref, scope, risk, evidence, doc link, parameters and documented errors.
  - **Codes**: both `jobStatus` tables side by side for D23, webhook event types, Wi-Fi status, proxied job types, log types and models.
- Developer panels ("Behind this screen" on Overview, Devices and Activity), switched on by a per-browser cookie and off by default.
- Also fixed: the filter pills' outline was clipped by the scrolling row.

Changes from §8a, with reasons:
| Planned | Built | Why |
|---|---|---|
| Panel shows each call made for the current render | Panel shows the screen's catalog operations plus their latest logged calls | Per-render correlation would need request-scoped context; the latest calls answer the same question |
| R1 Try it with health-check guards | R1 shown but locked | The guards are M4 scope |

Security:
- Try it accepts only catalog operations with a zod schema, and only display IDs. The server resolves display IDs to full IDs. Extra parameters are dropped.
- Response excerpts and Try-it bodies have device-ID fields masked (`redactDeviceIdsInJson`, which also works on truncated JSON).
- A browser run with the operator role found 0 full device IDs on any page, including the Inspector and Try-it results.
- Tests: `tests/unit/developer-mode.test.ts`.

Verified:
- `bun run check`: 90 tests pass.
- `next build` passes.
- Try-it runs recorded with source `try-it`: server-health 200, getDevice 200, and activity **403 again on 2026-09-26** (U18 unchanged).

Note: in `next dev`, `serverComponentsHmrCache` replays cached fetch responses across hot reloads, so the Inspector shows some 2–4 ms rows. Real calls take about 300–1700 ms.

Remaining for M3: none. Next is M4 (Bridge health checks: jobs 9 and 10, and targeted job 10, which settles D23).

### M4 — built, hardware runs pending (2026-09-26)

Fix first: catalog doc links used `docs.igloodeveloper.co` (the sitemap host, which does not resolve; D20). They now use `docs.igloohome.co`, all 6 pages checked 200, and a test enforces the host.

Built:
- `safety.ts`: a pure guard. Rules: operator role; `IGLOOHOME_ENABLE_BRIDGE_JOBS`; device **and** Bridge in the allowlist; lock jobs only on locks (not on the switch or keypad); Bridge link reported by the API; one open job per device (including `unknown`); Bridge-targeted job at most 1 per Bridge per 5 min; igloohome `Retry-After` honoured.
- `health-check.ts`: start, poll and read.
  - The `provider_jobs` row is written **before** the POST. A POST with no HTTP status becomes `unknown` and is never retried.
  - Polling `GET /jobs/{id}` is throttled to 1 call per 2 s per job.
  - The job-complete webhook is matched by `data.jobId`; the real payload shape was confirmed from a stored event.
- UI:
  - Health-check buttons on Devices, with the reason shown on disabled buttons, and a confirmation dialog stating the target, the Bridge, "does not move the lock or change credentials" and "sent once".
  - `/jobs` list.
  - `/jobs/[id]` monitor: polls every 3 s until completed or expired, then waits up to 2 min for the webhook. It shows a timeline, the result (battery, lock and door), webhook vs polled `jobStatus` side by side for D23, and the raw redacted data.
  - Try it runs the R1 operations through the same `startHealthCheck`, after an extra confirm click.
- Per-request dedupe of the device list (`listAllDevicesOnce`).

Verified:
- `bun run check`: 98 tests pass (new: `tests/unit/safety.test.ts`).
- `next build` passes.
- With the flag off (current `.env`), every check is disabled with the reason, the R1 Try-it entries are locked, and 0 full device IDs appear on any page.
- During testing, igloohome answered slowly: 4–6.5 s per call, with two 10 s timeouts. That was vendor latency, not rate limiting (no 429).

Known gap: `/jobs/<unknown id>` renders the not-found UI with HTTP 200. `loading.tsx` streams the response before `notFound()` runs.

Pending (needs the operator and hardware):
- E6: Bridge diagnostics on `bridge`.
- E7: battery on Doorlock → **D23** (compare the webhook value with the polled value).
- E8: lock/door status with a person at the door.
- E9 (optional): Bridge offline.

Update 2026-09-26: E6, E7 and E8 were run by the user from the dashboard. Record: `docs/research/igloohome/experiments/EXP-20260926-01-bridge-health-checks.md`.
- **D23 resolved.** The polled `jobStatus` is the job state: `1` while pending, `0` when completed. The webhook `jobStatus` is the job result: `0` = success.
- The 429 on Bridge diagnostics counted a proxied job 10 on the same Bridge, so the app's 5-minute guard now counts lock-status jobs too.
- `lockOpen` followed the manual toggle (HW). `doorOpen` is a number (`1`, meaning unknown).
- **Leak found and fixed:** Bridge diagnostics `lockRssiList[].bluetoothName` is the full device ID. That field is now masked, and masking also runs when stored rows are read, so rows written before the fix are covered too. A test covers it.
- The job page now reads results from the webhook, or from `opResult` when no webhook arrived. It shows Wi-Fi status, RSSI and link capacity.
- 99 tests pass.

**Slice 1 exit criteria met** (M1–M4). Open items: webhook public key (support), U18 activity 403, E15/E16 (jobs on the switch and keypad: undocumented, need approval), `doorOpen` meaning, trial ends 2026-10-17.

### M5 — algoPIN issue built, hardware runs pending (2026-09-26)

User decisions on 2026-09-26:
- algoPIN creation on the test locks is approved.
- M5 runs from the dashboard with a calendar that follows the algoPIN rules, instead of the planned CLI.
- Wi-Fi SSID, IP and DNS may be shown (the dashboard and the experiment record).

Built:
- `lib/algopin-rules.ts`: one rule module used by both the form and the server.
  - Types: one-time, hourly (1–672 h), daily (29–367 days, same hour at both ends), permanent.
  - Every time is on the hour, formatted `YYYY-MM-DDTHH:00:00+hh:mm` in the property's time zone.
  - One-time and permanent start at the current hour or later; hourly and daily may start up to 1 h in the past.
  - Variance 1–5 for one-time/permanent, 1–3 for hourly/daily. Name up to 60 characters.
  - Warnings for the 24 h activation rule, the 256 h no-delete rule and permanent PINs.
- `/access` page:
  - The calendar only offers valid days, and the hour pickers only offer valid hours.
  - A live summary shows the exact `startDate`/`endDate` that will be sent.
  - Creating a PIN needs a typed confirmation (the lock name).
  - The PIN is shown once, with show/hide and copy.
  - An "Issued" list shows each code's status. "Used on the lock" comes from webhook activity logs, matched by PIN fingerprint.
- Guard (`checkAlgoPinIssue`): operator role; `IGLOOHOME_ENABLE_ALGOPIN=true`; device allowlisted and listed by `GET /devices/support-pins`; the token holds the type's scope.
- Storage: `access_codes` never stores the PIN, only its HMAC fingerprint. The PIN is redacted in `api_calls`, and the POST is never retried (tests).
- Not offered: passage algoPIN (R3, no scope listed), PIN delete (Bridge job 5), custom PINs (E12), iglooKey (E13), deletion limits (E14).
- Also fixed:
  - The Inspector labels `GET /jobs` polls as pending or completed.
  - The job page shows SSID, IP, DNS and channel.
  - E8b is blocked by hardware: the lock is not mounted on a door.

Verified:
- `bun run check`: 110 tests pass (new: `algopin-rules.test.ts`, algoPIN guard, client contract).
- `next build` passes.
- UI checked at 390 px and 1440 px: no overflow, no console errors, 0 full device IDs.
- The daily end calendar opens with start + 29 days as its first allowed day.

Pending (needs the user):
1. `.env`: set `IGLOOHOME_ENABLE_ALGOPIN=true` and add the four `igloohomeapi/algopin-*` scopes, then restart.
2. E10: generation behaviour.
3. E11: enter a one-time PIN on the lock.

Update 2026-09-26 (E10/E11 run by the user; record `experiments/EXP-20260926-02-algopin.md`):
- An identical request returns the same PIN (A2).
- One-time PINs are single-use on the lock (A4).
- Every use was matched to its code by fingerprint.
- The active-PIN count rose 4 → 5 after the first use of a duration PIN (A7).

Fixed from feedback:
- "Latest calls" in Developer panels now refreshes every 3 s (`LiveCallList` + `recentCallsAction`).
- Job results are coloured badges with icons, and the raw field and value show on hover or focus.
- A rejected entry with a code's PIN (log 16) no longer counts as "used".

### M5 — Bridge PIN jobs built (E12 custom PIN, E14 delete), hardware runs pending (2026-09-26)

Built:
- `lib/pin-job-rules.ts`: job 4 rules — 4–6 digits, `pinType` 1/2/4, `YYYY-MM-DDTHH:mm:ss+hh:mm`, now or later, end after start. Job 5 rules — 4–12 digits.
- Client `createPinJob`: jobs 4/5 only, runtime-guarded, so lock/unlock stay unreachable. The PIN is redacted in the call log, and the POST is never retried.
- `pin-jobs.ts`: reuses the health-check pipeline and guards, with the new flag `IGLOOHOME_ENABLE_PIN_JOBS` and the scopes `create-pin-` / `delete-pin-bridge-proxied-job`. Only a PIN fingerprint is stored (`provider_jobs.pin_fingerprint`, added by an idempotent ALTER).
- Access page tabs: algoPIN · Custom PIN · Delete PIN, each with a typed confirmation.
- Job page outcome badge for jobs 4/5.
- Issued algoPINs show "Deleted from lock" after a successful delete job for the same PIN.

Verified: 119 tests pass; `next build` passes; UI checked at 390 px and 1440 px (flag off → reasons shown, 0 leaks).

Not built: E13 iglooKey (needs a guest phone and more research on the `shareableUrl` flow).

Update 2026-09-26 (E12 + E14 part 1 run by the user; record `experiments/EXP-20260926-03-bridge-pin-jobs.md`):
- Custom PIN create and delete both work (lock logs 27 and 31).
- The lock enforces the start time to the second.
- A duplicate PIN is refused with HTTP 406, not webhook jobStatus 9 (D25).
- Delete of a missing PIN returns jobStatus 3.
- Custom PINs count in `pinsCurrentActive`, and expired algoPINs free their slot.
- After a Bridge reconnect, the same log is re-sent with a new event id (D26); the feed now de-duplicates by content.

Built from feedback:
- **Live screens:** Devices and Overview check the local event store every 4 s (no igloohome call). When a new event arrives they re-render once and show a "Live update" toast. Device cards show their last event. The Bridge dot has a tooltip: it is the last type 10 event, not a live ping.
- **Code hints everywhere:** `lib/code-meanings.ts` plus `<Code>`, a popover on hover, tap or Enter showing meaning, source, evidence and a link to Developer → Codes (`?tab=codes`). Used for log types and job statuses (Activity, Access, job page), job types, HTTP statuses and outcomes (Inspector, Try it, job page), and model prefixes (device details). The code dictionaries moved to `lib/codes.ts` so the browser can use them.

Verified: 121 tests pass; `next build` passes; live polling (2 checks in 9 s) and popovers checked in the browser; 0 leaks.

Remaining M5: E14 part 2 (delete an unactivated algoPIN) and E13 iglooKey. Then M6 (plan Slice 2).

Update 2026-09-26 (EXP-20260926-04):
- igloohome reserves a PIN value per lock, even after a one-time PIN was used (406 on re-create).
- A delete answers `jobStatus 3` when the lock no longer has the PIN, but it still releases the reservation (3/3 runs).
- One delete job expired without running.
- An algoPIN deleted before activation is refused on the lock (E14 part 2 ✓).
- The UI explains both cases.

### M6 — Slice 2 plan proposed (2026-09-26)

`docs/plans/slice-2-guest-stay-access-plan.md`: guest stay access for one room. Hourly algoPIN per stay, issued just in time, activation tracked from lock logs, and revoke by job 5 only for early check-out, cancellation or extension. It is waiting for approval and the decisions D1–D6.

Update 2026-09-26: M6 dropped by the user. iot-pms is the device/lock platform, and stays live in Bobobox AU (DDD). The next plan is `iot-pms-platform-foundation-plan.md`: Postgres on Colima, accounts and roles, per-user scopes, PIN vault, activity by Bridge. It is proposed and waiting for confirmation.
