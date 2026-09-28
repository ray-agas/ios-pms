# iot-pms — AI context

> **Purpose of this file:** persistent context for AI agents and engineers working on iot-pms. It is a living document: read "Keeping This Document Updated" (§17) before you change the code, and update this file in the same change.
>
> **Sources:** written from the code (paths below) and cross-checked with `docs/architecture/*`, `docs/plans/*` and `docs/research/igloohome/*`. Where the two disagree, the code is described and the gap is listed in §15.
>
> **Evidence labels** (used across the project): **DOC** = igloohome documentation says so; **API** = confirmed by a real API response; **HW** = confirmed on the physical device; **UNVERIFIED / HYP** = not confirmed. Experiment records live in [`docs/research/igloohome/experiments/`](research/igloohome/experiments/).
>
> Last full review: 2026-09-28.

---

## 1. What this system is

**iot-pms is a device-management service and showcase for the igloohome smart-lock ecosystem.** It lists and monitors igloohome devices (locks, keypads, bedlock switches, Bridges), groups them into Bobobox **cabins and rooms**, runs Bridge jobs (health checks, PIN writes and deletes, emergency lock/unlock), issues **algoPINs**, keeps every PIN it creates in an **encrypted vault**, and shows what the igloohome API really does (developer mode, experiments, evidence badges).

- **Owner and context:** Bobobox (internal). It runs on a lab setup with real hardware: a Bridge, a door lock (IGB4), a bedlock switch (SW1X) with its keypad (EK2X), and a second test room (Bridge + DBX2 lock).
- **Goal stated by the user:** show everything the igloohome API can do, safely.
- **Relationship to Bobobox AU** (a separate app, repo `../bobobox-au-architecture`, read-only from here): in its context map iot-pms is **"X3 Lock Platform"**, upstream of the Access context, with an anti-corruption layer. See [`docs/architecture/system-context.md`](architecture/system-context.md).
- **Out of scope:** reservations, stays and guests. Those belong to Bobobox AU. Do not add stay or reservation logic here.

## 2. Architecture at a glance

```mermaid
flowchart LR
  subgraph Browser
    UI[Dashboard pages<br/>React 19 client components]
  end
  subgraph Next["iot-pms (Next.js 16, Node runtime, 127.0.0.1)"]
    Proxy[proxy.ts<br/>session gate]
    Pages[Server components<br/>src/app/(dashboard)]
    Actions[Server actions<br/>*/actions.ts]
    UC[Use cases<br/>src/server/application]
    Client[igloohome client<br/>src/server/igloohome]
    Store[Storage<br/>Drizzle + postgres.js]
    WH[/api/webhooks/igloohome/]
  end
  PG[(Postgres 17<br/>Docker/Colima)]
  IGAPI[igloohome REST API<br/>api.igloodeveloper.co/igloohome]
  IGAUTH[igloohome OAuth<br/>auth.igloohome.co]
  Bridge[igloohome Bridge] --- Devices[Locks · keypad · switch]

  UI --> Proxy --> Pages & Actions
  Pages --> UC
  Actions --> UC
  UC --> Client --> IGAPI
  Client --> IGAUTH
  UC --> Store --> PG
  IGAPI -. job via cloud .-> Bridge
  IGAPI -. webhooks .-> WH --> Store
```

- **One Next.js app** (App Router). Rendering and mutations happen on the server: pages are server components, and changes go through **server actions**. The browser never calls igloohome directly.
- **The layers, and the rule for each:**
  - `src/app/**` holds routes, pages and actions. Actions **re-check the session and role**, and rebuild their inputs from primitives.
  - `src/server/application/**` holds the use cases (guards, flows).
  - `src/server/igloohome/**` is the only code that talks to igloohome.
  - `src/server/storage/**` holds the schema and data access.
  - `src/lib/**` holds pure rules shared with client components.
- **Runs locally:** `next dev -H 127.0.0.1`. Only the webhook path is exposed to the internet, through a Cloudflare tunnel (per the comment in `src/app/api/webhooks/igloohome/route.ts`).
- **Stack:** Next.js 16.3.6, React 19, TypeScript, **Bun** (install, scripts, tests; Next itself runs on Node), Auth.js v5 beta.32, Drizzle ORM 0.45.3 + postgres.js, PGlite in tests, zod 4, Tailwind 4, shadcn/radix, motion, lucide.

## 3. Module map (where things live)

| Area | Path | Notes |
|---|---|---|
| Routes and pages | [`src/app/(dashboard)/`](../src/app/(dashboard)) | `page.tsx` Overview · `devices/` (+ `manage/`) · `activity/` · `access/` · `jobs/` (+ `[id]`) · `developer/` · `people/` |
| Auth pages | [`src/app/login/`](../src/app/login), [`src/app/account/password/`](../src/app/account/password) | Forced password change for temporary passwords |
| HTTP routes | [`src/app/api/`](../src/app/api) | `auth/[...nextauth]`, `activity` (feed polling), `webhooks/igloohome` (public) |
| Auth | [`src/auth.ts`](../src/auth.ts), [`src/proxy.ts`](../src/proxy.ts), [`src/server/auth-policy.ts`](../src/server/auth-policy.ts), [`src/server/users.ts`](../src/server/users.ts) | Credentials (database users + `.env` break-glass) and optional Google |
| Startup checks | [`src/instrumentation.ts`](../src/instrumentation.ts) | Fails fast on bad config, runs migrations, bootstraps the first super-admin, imports the legacy env allowlist |
| Config | [`src/server/config.ts`](../src/server/config.ts), [`.env.example`](../.env.example), [`docs/architecture/environment-configuration.md`](architecture/environment-configuration.md) | Every flag and secret |
| igloohome client | [`src/server/igloohome/client.ts`](../src/server/igloohome/client.ts) | The only place that builds igloohome URLs; one method per job family |
| Operation catalog | [`src/server/igloohome/catalog.ts`](../src/server/igloohome/catalog.ts) | Every operation: path, scope, risk (R0–R3), evidence, docs link, errors |
| Tokens | [`src/server/igloohome/token.ts`](../src/server/igloohome/token.ts) | Client-credentials token, in memory; `allScopes` mode only for the scope sync |
| Mapping / schemas / codes | [`mapping.ts`](../src/server/igloohome/mapping.ts), [`schemas.ts`](../src/server/igloohome/schemas.ts), [`src/lib/codes.ts`](../src/lib/codes.ts), [`src/lib/code-meanings.ts`](../src/lib/code-meanings.ts) | Vendor JSON → `DeviceSnapshot`; log/job code dictionaries |
| Redaction / webhooks | [`redaction.ts`](../src/server/igloohome/redaction.ts), [`webhooks.ts`](../src/server/igloohome/webhooks.ts), [`src/server/webhook-intake.ts`](../src/server/webhook-intake.ts) | Masks IDs and secrets; PIN → HMAC fingerprint; signature check |
| Use cases | [`src/server/application/`](../src/server/application) | See §6 |
| Guards (pure) | [`safety.ts`](../src/server/application/safety.ts) | `checkHealthCheck` (all Bridge jobs) and `checkAlgoPinIssue` |
| Proven device/job table | [`src/lib/device-support.ts`](../src/lib/device-support.ts) | What SW1X and EK2X really do per job (HW) |
| Scopes (pure) | [`src/lib/scopes.ts`](../src/lib/scopes.ts) | Scope catalog, `effectiveScopes`, `tokenScopes`, `scopeDenial` |
| Storage | [`src/server/storage/schema.ts`](../src/server/storage/schema.ts), [`db.ts`](../src/server/storage/db.ts), [`db/migrations/`](../db/migrations) | Drizzle schema; migrations run at startup |
| PIN crypto | [`src/server/crypto/pin-cipher.ts`](../src/server/crypto/pin-cipher.ts) | AES-256-GCM, device ID as additional data |
| UI components | [`src/components/`](../src/components) | Key ones: `room-topology`, `space-list`, `device-registry-console`, `algopin-form`, `pin-job-form`, `pin-vault-list`, `device-picker`, `emergency-lock`, `job-monitor`, `try-it-console`, `people-console`, `live-refresh` |
| Scripts | [`scripts/`](../scripts) | `db-migrate`, `db-import-sqlite` (one-time), `events`, `experiment` (read-only phase-A), `hash-password` |
| Tests | [`tests/`](../tests) | `bun test`; unit tests on PGlite (`tests/helpers/db.ts`); contract tests against documented and captured examples; never calls igloohome |

## 4. Domain concepts

| Concept | Meaning | Where |
|---|---|---|
| **Device kinds** | `lock`, `keypad`, `bridge`, `switch`, `fob`, `unknown`, derived from the device-ID prefix and API type. Full IDs look like `IGB4…`; the UI shows a **display ID** `IGB4••••••d0` | `mapping.ts`, `redaction.ts` |
| **Bridge** | Wi-Fi hub. Every remote job (1/2/4/5/9/10/15) goes igloohome cloud → Bridge → device over Bluetooth. Links are reported **on the Bridge and keypad records, not on locks** (API) | `health-check.ts` `loadTargets` |
| **Switch SW1X + keypad EK2X** | **The keypad holds and checks PINs; the switch is the motor.** A PIN typed on the keypad → keypad log 19/20 → switch log 11 (open) → switch log 48 (auto-relock, 4–6 s). The switch cannot hold PINs; the keypad cannot move anything (HW, EXP-20260928-01) | `src/lib/device-support.ts` |
| **Space** | A Bobobox **cabin or room** (`kind cabin | room`), optionally linked to an igloohome property and time zone | `spaces` table, `device-registry.ts` |
| **Device registry** | Devices iot-pms manages, placed in a space with a role (door_lock, bed_lock, keypad, switch, bridge) and `enabled | disabled`. **Enabled managed devices are the allowlist** every guard reads. Adding a Bridge can bring its linked devices along | `managed_devices`, `device-registry.ts` |
| **Job** | A Bridge job row (`provider_jobs`), written *before* the POST (so a crash shows "unknown", never nothing). States: `requested → queued → completed | expired | rejected | unknown`. **Settled from the job-complete webhook on read** (`settle()`), otherwise from polling `GET /jobs/{id}` | `health-check.ts` |
| **algoPIN** | A PIN computed by igloohome, checked offline by the device (no Bridge). Types: one-time, hourly, daily, permanent. Start is hour-aligned. Hourly/daily/permanent must be **typed once within 24 h** or they stop working. **Deterministic:** same device + type + start hour + variance → same PIN; **a deleted algoPIN stays refused** by the device even if re-issued (HW, K8) | `src/lib/algopin-rules.ts`, `access-codes.ts` |
| **Custom PIN** | A PIN written to the device by Bridge job 4 and deleted by job 5. One-time (`1`, used up by its first entry), duration (`4`), permanent (`2`). igloohome reserves a PIN value per device until it is deleted: a duplicate gets **406** (API) | `src/lib/pin-job-rules.ts`, `pin-jobs.ts` |
| **PIN fingerprint** | HMAC of a PIN (key derived from `AUTH_SECRET`). Webhook bodies store fingerprints, never PINs; used to match logs to codes | `webhooks.ts` |
| **PIN vault** | Every PIN iot-pms creates, **encrypted**. Super-admins reveal (audited) and revoke (job 5, audited, step-up) | `pins`, `pin-vault.ts` |
| **Roles** | `viewer < operator < super_admin` (`atLeast`). "Operator (admin)" label; the admin/operator naming waits for Bobobox AU DDD | `domain/models.ts` |
| **Scopes / ceiling** | igloohome OAuth scopes. The **ceiling** is what igloohome grants our client (synced; 20 scopes, E21). Super-admins have the whole ceiling; others have the 4 read scopes plus what a super-admin assigns | `scopes.ts`, `src/lib/scopes.ts` |
| **Experiment** | A supported job type on a device kind the docs do not list for it (switch, keypad). Super-admin only, needs `IGLOOHOME_ENABLE_EXPERIMENTS=true` plus step-up. Once proven, a combination moves to the device-support table and becomes a regular feature. Combinations proven **not** to work are left out of the pickers (`provenUnsupported`): the switch in Custom/Delete PIN, the keypad in the Emergency panel. They can only be re-tested from Developer → Try it | `safety.ts`, `device-support.ts` |
| **Step-up** | A reason (10–200 characters) plus the person's **own password** again, for risky actions. A wrong password is audited; 5 wrong ones in 15 min block step-up for that person (in-memory limiter) | `step-up.ts` |
| **Evidence** | DOC / API / HW / UNVERIFIED badges in the UI (`EvidenceBadge`) and in the catalog | `components/visuals.tsx` |

## 5. Main flows

### 5.1 Sign-in and session
1. `/login` → Credentials provider `"password"`. First `users` (bcrypt, timing-safe dummy hash), then the **break-glass** `.env` account (`AUTH_FALLBACK_*`, always `super_admin`). Optional Google (`@bobobox.com`, allowlist).
2. Login is rate-limited in memory: 5 failures per 15 min per client+username. Sign-ins are audited.
3. JWT session (8 h). The account is **re-read at most every 60 s**: disabled users are signed out; role changes apply.
4. A **temporary password** (new or reset account) sets `mustChangePassword`. `proxy.ts` (`authorized` in `src/auth.ts`) redirects **every request**, including action POSTs, to `/account/password` until it is changed.

### 5.2 Viewing devices (built for many devices)
- `getSite(watch)` (`dashboard.ts`) builds the site from:
  - the device and property lists (**cached 60 s** in-process);
  - the registry, Bridge status from stored webhooks (type 10), and the last-known state (`device_state`).
- **No per-device igloohome call** happens in an ordinary render.
- `/devices` shows **compact cabin/room rows** with URL filters and paging. **Watching** up to `IOT_PMS_MONITOR_MAX` (default 3) cabins loads live detail (`GET /devices/{id}`, reused 30 s unless the device sent an event) and the full topology panel.
- Live updates: `LiveRefresh` polls `/api/activity?after=` every 4 s (database only). It re-renders at once for watched devices; other events refresh at most every 30 s.
- `/activity` filters by Bridge (`?bridge=`), then by a device seen through it (`?device=`), then by event group. `/people` account activity filters by person (actor or target), type and date; `/access` Issued list by text, device, status and created date; PIN pickers are searchable and show what a keypad opens (`opensOf`).

### 5.3 Bridge job (health check, PIN job, lock/unlock, pull logs)
```
action (role check) → use case → checkHealthCheck (pure guard) → [step-up if needed]
  → insert provider_jobs (requested) → igloohome POST with the caller's token → queued / rejected / unknown
  → webhook type 3 (job complete) or GET /jobs polling → settled on read → UI shows result
```
- **Guard order in `checkHealthCheck`:**
  1. role (lock commands and job 15: super-admin);
  2. the flag for the job family;
  3. scope (caller's, explained vs the ceiling);
  4. device kind, from the **proven table** (`device-support.ts`) or the experiment rule;
  5. a Bridge link exists;
  6. device and Bridge are managed and enabled;
  7. **one job in flight per device** (with `retryAt`);
  8. igloohome's 429 `Retry-After`;
  9. Bridge diagnostics: 1 per Bridge per 5 min (counts job-10 on the same Bridge).
- **Emergency unlock:** at most 3 per device per 10 min (`unlockLimit`).
- Job POSTs are **never retried**. No HTTP status (a timeout) means `unknown`, shown as such. **A 200 means "sent", not "done"**: with a Bridge dropping, a job can be accepted and never run (EXP-20260927-02 F5).
- Entry points:
  - `jobs/actions.ts` (health checks, `remoteLockAction`);
  - `access/actions.ts` (custom PIN, delete, vault revoke);
  - `developer/actions.ts` (Try it; super-admins: job types 1, 2, 5, 9, 10, 15).

### 5.4 algoPIN
`access/actions.ts createAlgoPinAction` → `issueAlgoPin`:
1. `checkAlgoPinIssue` (role, flag, managed, capable, scope);
2. `checkAlgoPin` rules (window, variance, 24 h activation);
3. insert `access_codes` → `POST /devices/{id}/algopin/{type}` with the caller's token → store fingerprint and **vault entry**;
4. warn if the returned PIN was deleted from this device before.

The PIN is shown once to the creator. Status comes from logs: first use (log 19–26), deletes (job 5 on the same device, after issue), the activation window.

### 5.5 Emergency lock/unlock (R3, physical)
- Devices → watch the cabin → device → Emergency panel. Needs `IGLOOHOME_ENABLE_REMOTE_LOCK=true`, super-admin, and step-up.
- The call uses a token with **only** the lock or unlock scope plus `get-job-status`. `lockTime` is never sent.
- The Overview shows a collapsible list of the last 24 h of emergency actions for everyone. "Lock again" shows until a later lock, a "locked" report, or a lock-type log (e.g. auto-relock 48).

### 5.6 Registry and scopes admin (super-admin)
- **Devices → Manage:**
  - cabins and rooms; add a device, or **add a Bridge with its linked devices** (preview, single transaction);
  - move, role, disable, remove;
  - Reveal ID (audited). A second Bridge in a space is allowed, with a warning.
- **People:**
  - accounts (temporary password shown once; the last active super-admin cannot be removed; nobody changes their own role or status);
  - per-user scopes;
  - **Sync scopes**: one token without `scope`, used only for `server-health`, then dropped.

## 6. Use-case modules (`src/server/application`)

| Module | Responsibility |
|---|---|
| `dashboard.ts` | igloohome clients per scope set (`igloohomeAs`, `tokenScopes`), 60 s list caches, `getSite`, `liveDetails` (30 s + event invalidation, writes `device_state`), connection, activity feed, developer call log, `readCeilingFromIgloohome` |
| `health-check.ts` | Targets (device → Bridge), `recentJobs`, `settle`, `startHealthCheck` (9/10/Bridge diagnostics/15), `getJob`, `listJobs`, `refreshJob` (polling), `experimentFindings` |
| `safety.ts` | Pure guards (§5.3), `JOB_TYPE_FOR`, `JOB_SCOPE`, `CONFIRM_KINDS` |
| `pin-jobs.ts` | Custom PIN (job 4) and delete (job 5): targets, guard, step-up for experiments, vault write and revoke-link |
| `access-codes.ts` | algoPIN targets and issue, status derivation (`statusOf`, `firstUse`, `deletesOf`), notes |
| `pin-vault.ts` | `storePin`, `markRevoking`, `revealPin`, `pinForRevoke`, `listVault` (status and notes) |
| `remote-lock.ts` | Emergency lock/unlock options and run, unlock rate limit, 24 h notices |
| `device-registry.ts` | Spaces, managed devices, Bridge bundle (`bundleOf`, `adoptBundle`), one-time env import, backfill |
| `scopes.ts` | Ceiling (sync or env), assigned scopes, `callerOf` (role + scopes + ceiling + experiments, once per request) |
| `step-up.ts` | `checkConfirmation`, `confirmPassword` |
| `try-it.ts` | R0 (read-only) Try-it operations: schemas and fields |

## 7. igloohome integration

- **Endpoints used** (source of truth: `catalog.ts`; details in [`docs/research/igloohome/02-endpoint-inventory.md`](research/igloohome/02-endpoint-inventory.md) and [`src/server/igloohome/CONTRACT.md`](../src/server/igloohome/CONTRACT.md)):

| Operation | Method and path | Risk | Evidence |
|---|---|---|---|
| serverHealth | `GET /server-health` | R0 | API |
| listProperties / getProperty / listPropertyDevices | `GET /properties…` | R0 | API |
| listDevices / getDevice / listPinCapableDevices | `GET /devices…`, `/devices/support-pins` | R0 | API |
| listActivity | `GET /devices/{id}/activity` | R0 | **403 for our account (U18)** |
| createProxiedJob (9, 10, 15) | `POST /devices/{id}/jobs/bridges/{bridgeId}` | R1/R2 | API + HW |
| createPinJob (4, 5) | same path | R2 | API + HW |
| createLockJob (1, 2) | same path | R3 | API + HW |
| createBridgeDiagnosticsJob | `POST /devices/{bridgeId}/jobs` `{jobType:10}` (max 1 per 5 min) | R1 | API |
| createAlgoPin | `POST /devices/{id}/algopin/{type}` | R2 | API + HW |
| getJob | `GET /jobs/{jobId}` | R0 | API |

- **Base URL** `https://api.igloodeveloper.co/igloohome`; **token** `POST https://auth.igloohome.co/oauth2/token` (client credentials, `expires_in` 86400). Docs links use `docs.igloohome.co` (the sitemap host `docs.igloodeveloper.co` does not resolve).
- **Job types:** only 1, 2, 4, 5, 9, 10 and 15 are ever sent, each through its own client method. The documented "Not supported" types (3, 14, 16, 18, 19, 24, 29) have no code path.
- **Important quirks (all evidenced):**
  - Polled `GET /jobs` `jobStatus` = **state** (1 pending, 0 completed); webhook `jobStatus` = **result** (0 success) (D23).
  - `doorOpen` reads 1 without a door sensor.
  - Job-complete webhooks arrive 4–38 s after the POST.
  - Remote actions are logged by the device as **Bluetooth** actions (11 / 37), followed by a clock sync (13).
  - A Bridge reconnect re-delivers logs with new event IDs (the feed de-duplicates by content).
  - One job-10 limit counts both Bridge diagnostics and lock-status on the same Bridge (429 `Retry-After`).
- **Scopes:** 18 documented plus `store-device-activity` and `edit-pin-bridge-proxied-job` granted (E21). An omitted `scope` grants all, so the app refuses empty scope lists except in the sync mode.

## 8. Webhook flow

```
igloohome → POST /api/webhooks/igloohome (public, not behind login)
  → size ≤ 256 KB → signature check (header x-igloocompany-sha256; host from X-Forwarded-Host or Host)
  → if IGLOOHOME_WEBHOOK_REQUIRE_VALID_SIGNATURE=true and not valid → 401
  → parse; envelope (event id/type/date, product, Bridge)
  → sanitize: PINs → HMAC fingerprints, secrets redacted
  → INSERT webhook_events (dedupe by event id or sha256 of the body; duplicates → 200 duplicate:true)
  → 200 (storage failure → 500 so a retrying sender can retry)
```
- **Store first, process later:** nothing is processed at intake. Readers use the stored events for the activity feed, Bridge online status (type 10), job results (type 3) and PIN first-use (type 5).
- **Verification today:** no public key has been received from igloohome, so events are stored as `no_key` and shown as UNVERIFIED. Strict mode stays off until one real event verifies `valid` (dropping real events would lose activity logs for good).

## 9. Persistence (Postgres, Drizzle)

Schema: [`src/server/storage/schema.ts`](../src/server/storage/schema.ts). Migrations: `db/migrations/0000`–`0005` (`bun run db:generate` writes new ones; they run at startup). Tests use PGlite with the same migrations. Database setup: [`db/README.md`](../db/README.md) (role `iot_pms`, not a superuser).

| Table | Holds | Notes |
|---|---|---|
| `webhook_events` | Every webhook, sanitized (`body` jsonb), verification result | Unique `dedupe_key` |
| `api_calls` | Request inspector: every igloohome call, excerpts redacted and IDs masked | Keeps the latest 2,000 rows |
| `provider_jobs` | Every Bridge job: kind, type, device, Bridge, state, polls, errors, `pin_fingerprint`, `experimental` | Written before the POST |
| `access_codes` | Issued algoPINs (fingerprint only) | Status derived |
| `pins` | **Vault:** AES-256-GCM ciphertext (`v1.<iv>.<tag>.<ct>`, device ID as AAD), key version, fingerprint, links to code or jobs | Key `IOT_PMS_PIN_KEY` |
| `users` | Accounts (bcrypt), role, status, `must_change_password` | Case-insensitive unique username and email |
| `audit_events` | Who did what: sign-in, users, scopes, registry, PIN reveal/revoke, emergency actions, experiments, ID reveals | Display IDs only, never PINs |
| `spaces` | Cabins and rooms | Unique name (case-insensitive) |
| `managed_devices` | The registry / allowlist | Full device IDs |
| `device_state` | Last-known battery, lock state, last sync per device | Written by live detail |
| `scope_syncs` | Ceiling history (latest wins) | |
| `user_scopes` | Assigned scopes per user | Read scopes implicit |

**What is never stored:** plain PINs outside the vault ciphertext, tokens, client secrets. **Full device IDs** exist only in the database; screens, audit rows, logs, docs and API-call excerpts use display IDs.

## 10. Authentication and authorization

| Layer | Rule |
|---|---|
| Proxy (`src/proxy.ts` → `authorized`) | Every route except `api/auth`, `api/webhooks`, `login` and static files needs a session; a temporary password redirects everything to `/account/password` |
| Server actions | Each re-checks the session and role itself (`atLeast`, `requireRole`, local `superAdmin()` helpers) and rebuilds its input |
| Roles | Viewer: reads. Operator: health checks, PIN jobs and algoPINs **if their scopes allow**. Super-admin: everything, including registry, people, scopes, vault reveal/revoke, emergency lock/unlock, experiments, Reveal ID, job 15 |
| Scopes | Checked before every igloohome operation; the call uses a token with exactly the caller's usable scopes (`tokenScopes`: no scope without an iot-pms feature; physical scopes only in the emergency token) |
| Step-up | Reason and own password for emergency lock/unlock, job 15, experiments and vault revoke |
| Pages | Super-admin pages (`/people`, `/devices/manage`) return not-found for others |

## 11. Configuration and flags (summary)

Full list: [`docs/architecture/environment-configuration.md`](architecture/environment-configuration.md).

- **Secrets:** `AUTH_SECRET`, igloohome client ID/secret, `DATABASE_URL`, `IOT_PMS_PIN_KEY`, Postgres passwords, `AUTH_FALLBACK_PASSWORD_HASH_B64`.
- **Risk flags (default off):** `IGLOOHOME_ENABLE_BRIDGE_JOBS` (9/10/15, Bridge diagnostics), `IGLOOHOME_ENABLE_PIN_JOBS` (4/5), `IGLOOHOME_ENABLE_ALGOPIN`, `IGLOOHOME_ENABLE_REMOTE_LOCK` (1/2), `IGLOOHOME_ENABLE_EXPERIMENTS`. The lab install keeps remote lock and experiments on as a showcase (user decision).
- **Startup refuses to run** if:
  - scopes are empty;
  - the auth config is invalid;
  - strict webhook mode is on without a key;
  - `IOT_PMS_MONITOR_MAX` is out of range;
  - PIN creation is on without `IOT_PMS_PIN_KEY`;
  - or the database is unreachable.
- **Deprecated:** `IGLOOHOME_ALLOWED_DEVICE_IDS` (imported once into the registry) and `AUTH_FALLBACK_ROLE` (ignored). Both warn at startup.

## 12. Key technical decisions

| Decision | Why | Source |
|---|---|---|
| Server actions + server components, no public API | Internal tool; guards stay on the server | `src/app` |
| Catalog-only igloohome client, one method per job family | No free-form proxy that could send any job type | `client.ts`, integration-architecture §4.2 |
| Postgres + Drizzle, PGlite for tests | Shared server with Bobobox AU (separate databases); typed queries | plan F1/F1b |
| Registry = allowlist | Devices must be deliberately managed before any job | plan F7 |
| No per-device calls on render; watch up to 3 | igloohome rate limits at scale (1,389 detail calls/day with 6 devices before F7b) | plan F7b |
| Per-user tokens with the user's scopes | igloohome enforces what iot-pms allows (two layers) | plan F3 |
| Encrypted vault, reveal on demand | Super-admins must see and revoke every PIN; audited | plan F4 |
| Settle jobs from webhooks on read; intake only stores | Found in E22: jobs stuck "queued"; intake must never fail a delivery | EXP-20260927-02 |
| Proven device/job table instead of the docs' "locks only" | The docs do not cover SW1X/EK2X; hardware tests do | EXP-20260928-01 |
| Warn rather than block on topology (several Bridges per cabin) | Bobobox may put several Bridges in a cabin later | user, F7b |

## 13. Business rules and invariants (do not break)

1. No job POST is ever retried. A job row is written before the POST.
2. Job types 1/2 only through `createLockJob`, 4/5 only through `createPinJob`, 9/10/15 only through `createProxiedJob`. Unsupported types are never sent.
3. Every Bridge job passes `checkHealthCheck`; every algoPIN passes `checkAlgoPinIssue` plus `checkAlgoPin`. The server decides; the UI only displays the decision.
4. Only enabled managed devices (and their managed Bridge) can receive jobs.
5. One job in flight per device; the Bridge-diagnostics 5-minute rule; honour 429 `Retry-After`; 3 unlocks per device per 10 min.
6. Lock/unlock, job 15, experiments and vault revoke require step-up.
7. Tokens: never without explicit scopes (except the one-off sync); never a scope without an iot-pms feature; physical scopes only in the emergency token.
8. Browser views carry **display IDs only**. Full IDs are revealed on request to super-admins only (audited).
9. PINs: vault ciphertext only; fingerprints elsewhere; never in logs, audit rows, API-call excerpts or webhook bodies.
10. A delete or first use counts for a PIN only **on the same device and after it was issued** (PIN values repeat: deterministic algoPINs, reused custom PINs).
11. One active super-admin must always remain; nobody changes their own role or status.
12. Webhook intake stores and never processes. Readers interpret.

## 14. Current status (2026-09-28)

- **Done:**
  - Slice 1 (connect, discover, health checks) and M5 (algoPIN, custom PIN jobs).
  - Foundation plan F0–F7b and F6 review: Postgres/Drizzle, accounts and roles, registry, scale, scopes, vault, emergency lock/unlock.
  - G1 experiment mode, with the switch/keypad results turned into regular features.
  - The access UX (device picker, vault filters, compact Issued list).
- **Tests:** 167 passing (`bun run check`), build passing.
- **Progress logs:**
  - [`docs/plans/iot-pms-platform-foundation-plan.md`](plans/iot-pms-platform-foundation-plan.md) (most recent);
  - [`docs/plans/igloohome-implementation-plan.md`](plans/igloohome-implementation-plan.md) §21 (slice 1 / M5);
  - `docs/plans/slice-2-guest-stay-access-plan.md` is **superseded**: stays belong to Bobobox AU.
  - [`docs/plans/bobobox-au-x3-lock-platform-draft.md`](plans/bobobox-au-x3-lock-platform-draft.md): **parked draft**, no code; iot-pms as AU's X3 lock platform (one Bridge per cabin). `docs/research/igloohome/13-make-beds24-integration.md` is a reference note on an integration iot-pms does **not** use.

## 15. Known limitations, gaps and open items

| Item | Detail |
|---|---|
| Webhook signatures unverified | No public key from igloohome yet; strict mode off; events labelled UNVERIFIED. Readers (job settling, vault status) trust type-3 events whose provider job ID is unguessable |
| Activity endpoint | `GET /devices/{id}/activity` returns 403 for our account (U18); activity comes from webhooks only |
| Per-process state | List/detail caches, token cache and the login rate limiter live in memory; a second app instance needs a shared store |
| Emergency reasons are visible to everyone | By design, the Overview banner shows every emergency action and its free-text reason to all signed-in users, viewers included. Do not type guest names or other personal data in the reason |
| Delete PIN has no step-up | Job 5 from Access → Delete PIN needs the operator role, the PIN and the typed device name, but no password. Vault revoke always needs step-up. Intended; revisit if operators should need step-up too |
| Access page scale | The Issued list loads 100 codes and filters in the browser; per-code log lookups (`firstUse`, `deletesOf`) become heavy past a few hundred |
| Door sensor | Auto-relock with the magnetic door sensor is a user report (L4b), not yet tested on a mounted lock (E8b) |
| Not yet tried | Deleting an algoPIN from the keypad **before** first use; keypad PIN capacity; wrong-PIN lockout |
| Naming | "Operator (admin)" and the Access vocabulary wait for Bobobox AU's DDD context map (X3 contract) |
| Trial | The igloohome trial ends **2026-10-17** |
| Docs drift | `CLAUDE.md` is the research-phase brief (it says not to build the dashboard before review). The dashboard now exists; this file describes the current system |

## 16. Guidance for AI agents

- **Before code:** read `AGENTS.md` (this Next.js version has breaking changes; check `node_modules/next/dist/docs/`), `CLAUDE.md` (safety and evidence rules) and this file.
- **Run:** `docker compose up -d db` (Colima), then `bun run dev`. Check with `bun run check` (typecheck, lint, tests) and `bun run build`. Schema change: edit `schema.ts` → `bun run db:generate` → review the SQL.
- **Hardware safety:**
  - never run mutating jobs on devices you were not told to use;
  - the user runs hardware experiments themselves (bench devices: Doorlock, switch, keypad, `bridge`; **not** `bridge-lab`/`darderdoor`);
  - confirm the target before any mutating operation;
  - lock/unlock is physical.
- **Secrets and IDs:**
  - never print or commit `.env`;
  - never write full device IDs, PINs or tokens into docs, logs, tests or audit rows;
  - use display IDs.
- **Evidence:** never present an undocumented behavior as fact. Label it, and record experiments in `docs/research/igloohome/experiments/EXP-YYYYMMDD-NN-*.md`.
- **Adding an igloohome operation:**
  1. catalog entry (risk, scope, evidence, docs link);
  2. a dedicated client method with a runtime job-type check;
  3. a use case that passes `checkHealthCheck` (or a new pure guard with tests);
  4. a scope in `src/lib/scopes.ts` with `usedFor`;
  5. tests;
  6. update §7 and §13 here.
- **Adding a device capability:** once proven, add it to `src/lib/device-support.ts` with the EXP reference; do not loosen the guard elsewhere. A combination proven not to work there is hidden from the pickers automatically (`provenUnsupported`) and still refused by the guard.
- **Adding a table:** schema + migration + §9 here; keep IDs and PINs rules.
- **UI:** built for many devices (compact, filters, paging); server decides allowed/refused and gives a reason for every refusal (shown on hover); step-up for risky actions.
- **Tests:** unit tests in `tests/unit/*.test.ts` (bun:test, PGlite via `openTestDb()`); contract tests against `tests/fixtures/igloohome/`; pure rules get their own tests.

## 17. Keeping This Document Updated

Update this file **in the same change** when any of these change:

| Change | Update |
|---|---|
| New or changed route, page or server action | §3, §5, §10 |
| New igloohome operation, job type, scope or client method | §7, §13, `catalog.ts` evidence |
| New table, column or migration | §9 |
| New flag or secret | §11 (+ `environment-configuration.md`, `.env.example`) |
| New guard, rule or rate limit | §5.3, §13 |
| New experiment result (DOC → API/HW) | §4/§7 facts, `device-support.ts`, §15 |
| Something done or dropped from §15 | §14, §15 |
| Architecture decision | §12 |

**Checklist:**
1. Re-read the section you touched against the code.
2. Keep the evidence labels.
3. Update the "Last full review" date at the top when you re-check the whole file.
4. Record the change in the plan progress log (`docs/plans/`).
