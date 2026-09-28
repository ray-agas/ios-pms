# Plan: iot-pms platform foundation (Postgres, accounts, per-user scopes, PIN vault, activity by Bridge)

- **Status:** **approved 2026-09-27**: all recommendations Q1–Q10; order F0 → F5 → F1 → F2 → F7 → F3 → F4 → F6. Progress in §10
- **Replaces:** `slice-2-guest-stay-access-plan.md` (stays and reservations belong to Bobobox AU, not iot-pms)
- **Complexity:** High overall (database move + authentication + device registry). About 6 working days

## 1. Requirements (restated)

1. **Positioning.** iot-pms is the **device management service** over the igloohome API and a **showcase of every device and API**. It will map every device to its room. Reservations and stays live in the separate **Bobobox AU** app (DDD, modular monolith). In Bobobox AU's context map, **X3 "LOCK PLATFORM" is upstream of C1 Access, with an ACL required**; iot-pms is growing into that role. Context only for now; nothing of Bobobox AU is built here.
2. **Store every PIN** that iot-pms creates (algoPIN and custom PIN), encrypted.
   - **Super-admin** can see every PIN and revoke any of them.
   - **Operator** keeps today's rights: creates and manages PINs, sees a PIN once at creation, and sees metadata afterwards.
3. **Activity grouped by Bridge:** choose a Bridge (there are two) and see its events; the feed is grouped per Bridge.
4. **Accounts:** the super-admin creates operator accounts. "Admin" = "operator" for now; Bobobox AU's DDD work will settle the naming.
5. **Per-user igloohome scopes:**
   - The super-admin holds all scopes and chooses which scopes each operator gets.
   - Scopes are stored in the database.
6. **Postgres on Docker (Colima)** replaces the local SQLite file. It runs on one server that Bobobox AU will also use later, in its own database.
7. **Device registry in the database** (added 2026-09-26). Devices are managed on a page instead of `IGLOOHOME_ALLOWED_DEVICE_IDS`: add or remove, and assign to a **cabin** or a **room** (two space types).
8. When to refactor (roles, DDD naming): **options in §8**.

## 2. Facts this plan relies on

| Fact | Evidence |
|---|---|
| igloohome scopes sit on the **OAuth token of one client ID**. They are operation-level, not device-level | DOC (03-auth §3) |
| Leaving `scope` out grants **all** scopes. Explicit lists are least-privilege | DOC |
| igloohome API (our product, `igloohomeapi/…`): **18 scopes** (`home/getting-started-igloohome-api`), plus `store-device-activity`, which an endpoint needs but the list leaves out. The **28 scopes** on `works/getting-started-client-credentials` are **iglooworks** (`iglooworksapi/…`), a different product our client cannot use | DOC; our token's `scope` claim is `igloohomeapi/…` (API, EXP-20260925-01) |
| `server-health` returns the scopes actually granted to a token | API (EXP-20260925-01) |
| What happens when we ask for a scope the account is not entitled to (error or silently dropped) | **Unknown** (research Q4). Avoided in F3: omit `scope` once and read what `server-health` reports as granted |
| A job 5 delete needs the **PIN value**; an algoPIN can be deleted before activation | API + HW (EXP-04) |
| Colima is running with Docker Compose 5.4; port 5432 is free (another project uses 5442) | Checked 2026-09-26 |
| About 45 SQL statements use SQLite features (`json_extract`, `INSERT OR IGNORE`, `lastInsertRowid`, `AUTOINCREMENT`) | `grep` of `src/` |

## 3. Patterns to mirror

| Category | Source | Pattern |
|---|---|---|
| Use cases | `src/server/application/access-codes.ts`, `pin-jobs.ts` | One module per capability; returns `{ ok: true … } \| { ok: false, reason }` |
| Pure rules | `src/lib/algopin-rules.ts`, `pin-job-rules.ts` | Shared by form and server; unit-tested with a fixed clock |
| Guards | `src/server/application/safety.ts` | `checkX(input) → { allowed } \| { allowed: false, reason }`, no I/O |
| Errors | `src/server/igloohome/errors.ts` | `ProviderError` codes; vendor text redacted |
| Secrets | `src/server/igloohome/redaction.ts` | One redaction path; tests fail on a leak |
| Server actions | `src/app/(dashboard)/access/actions.ts` | Re-check session + role; rebuild input from primitives |
| Data access | `src/server/storage/schema.ts`, `db.ts`, `api-calls.ts` | Drizzle ORM (F1b): typed queries; drizzle-kit migrations in `db/migrations` |
| Tests | `tests/unit/*.test.ts` (`bun test`), in-memory DB per test | Hermetic, no network |

## 4. Phases

### F0 — Context and boundary (0.5 day)
- `docs/architecture/system-context.md`:
  - iot-pms as the lock platform for Bobobox AU Access (C1).
  - What iot-pms owns (devices, rooms-to-devices, PINs on locks, device events, igloohome jobs) and what it does not (reservations, stays, billing, guests).
  - The database layout: one server, separate databases, integration by API only.
- Mark the Slice 2 plan **superseded**; update the progress log.

### F1 — Postgres on Colima (1–1.5 days)
- **`docker-compose.yml`:** service `db`, `postgres:17`, bound to `127.0.0.1:5432`, a named volume, a health check. On first start it creates the database `iot_pms` and a least-privilege app role. The Bobobox AU database is added later with its own role.
- **`.env`:** `DATABASE_URL` (secret, git-ignored); `.env.example` gets a placeholder.
- **Driver:** `postgres` (postgres.js) for the app (works in Node and Bun). **PGlite** (in-process Postgres) for tests, so tests stay hermetic. Both sit behind a tiny `query(sql, params)` interface.
- **Migrations:** `db/migrations/0001_init.sql …` plus a small runner with a `schema_migrations` table, run at startup and by `bun run db:migrate`.
- **Rewrite the SQL:**

  | SQLite | Postgres |
  |---|---|
  | `json_extract(body, …)` | `body->'payload'->…` (body becomes `jsonb`) |
  | `INSERT OR IGNORE` | `ON CONFLICT DO NOTHING` |
  | `lastInsertRowid` | `RETURNING id` |
  | text timestamps | `timestamptz` |
  | `AUTOINCREMENT` | identity columns |

- **Data move:** `bun run db:import-sqlite` copies webhook events, API calls, jobs and access codes from `var/iot-pms.db`, so all experiment evidence is kept. The SQLite file stays as a backup.
- **Exit:** all current tests pass on PGlite; the app runs against Colima Postgres; the imported row counts match.

### F2 — Accounts and roles (1 day)
- **Tables:**
  - `users`: username, display name, bcrypt hash, role `super_admin | operator | viewer`, status, must-change-password, created_by, last login.
  - `audit_events`: every sign-in, account change, scope change, PIN reveal and revoke.
- **Bootstrap:** if there are no users, the current `.env` fallback account becomes the first **super-admin**. It stays available as a break-glass login.
- **Login:** checked against the database, using the same bcrypt and rate limiter. A Google login maps to the database user by e-mail.
- **Session re-check:** the session re-reads the role and status from the database, at most every minute. A disabled user or a role change takes effect within about a minute, not after 8 h.
- **Super-admin screen "People":** create an operator, reset a password, disable, change role. "Admin" appears as a label on operator until the naming is decided.
- **Exit:** tests for bootstrap, login, disabled user, role change, and "an operator cannot reach the super-admin actions".

### F3 — Per-user igloohome scopes (0.5–1 day)
- **Scope catalog** in code: the 19 documented scopes, each with a description and the operations it unlocks (from the operation catalog).
- **Discover the ceiling from igloohome, not from `.env`.**
  - The super-admin clicks "Sync scopes". iot-pms requests one token **without `scope`** (documented: all permissions) and reads `server-health`, which lists exactly what our client is granted.
  - That list is stored as the **ceiling** in the database, with the time of the sync. The super-admin always has the full ceiling.
  - Every *other* call keeps sending an **explicit** list (the user's scopes), so an empty scope is never used for day-to-day work.
  - `IGLOOHOME_SCOPES` shrinks to the startup read set, or is removed.
- **`user_scopes` table.** The super-admin assigns scopes per operator in the People screen, as checkboxes grouped by read, credential and Bridge jobs.
- **Enforcement, two layers:**
  1. iot-pms checks the user's scopes before every operation; the catalog already names the scope for each one.
  2. The call uses a **token requested with only that user's scopes** (a token cache keyed by scope set), so igloohome enforces it too.
- **Reads for every signed-in user:** `get-devices`, `get-properties`, `get-job-status`, so every screen works for everyone.
- **Lock/unlock scopes** can be assigned, but grant nothing: those operations are not built, and the client still blocks job types 1 and 2.
- **E21 (API):** a token without `scope` → `server-health`. Record the granted list: is it 18? Does it include `store-device-activity` and the iglooKey endpoints? This closes research Q4 without guessing.
- **Exit:**
  - Tests: an operator without `algopin-hourly` is refused before any call, and the token used carries only that user's scopes.
  - E21 recorded.

### F4 — PIN vault (1 day)
- **`pins` table:**
  - device; kind (algoPIN or custom); type; name; window; variance; `pinId`;
  - **ciphertext** (AES-256-GCM, key `IOT_PMS_PIN_KEY`, with a key version); fingerprint;
  - created_by; state `issued → active → revoked | expired | unknown`; links to the job or code.
- **Writes:** every algoPIN and custom PIN is stored at creation. A typed delete marks the matching entry as revoked.
- **Visibility:**
  - **Operator:** sees the list with masked PINs and metadata (as today), and the PIN once at creation.
  - **Super-admin:** sees every PIN in plain text and can **revoke with one click**; iot-pms decrypts the PIN and sends job 5, following the same job flow.
  - Reveals and revokes are **recorded, not blocked**.
- **Old PINs:** those created before F4 were never stored and cannot be recovered. They are listed as "PIN not stored (created before the vault)".
- **Security:**
  - The key is required at startup when the vault is on.
  - The PIN never appears in logs, API-call excerpts or error text; the redaction tests are extended to the vault.
  - A database dump contains ciphertext only.
- **Exit:** encryption round-trip test; a leak test; the role test "an operator cannot decrypt".

### F5 — Activity grouped by Bridge (0.5 day)
- A Bridge picker (All · `bridge` · `bridge-lab`, each with its connection status) on Activity, kept in the URL (`?bridge=`).
- The feed is grouped **per Bridge, then per day**. Events with no Bridge form their own group.
- The Overview's latest activity follows the same grouping.
- Independent of F1–F4, so it can go first as a quick win.

### F7 — Device registry: cabins and rooms (1 day, after F1 + F2)
- **Tables:**
  - `spaces`: name; **kind `cabin | room`**; optional igloohome property link; time zone; notes.
  - `managed_devices`: device ID; display name; kind and model (from igloohome); **space**; role in the space (door lock, bed lock, keypad, Bridge); status `enabled | disabled`; added by and when.
- **"Devices → Add" page:**
  - Lists the devices on the igloohome account (`GET /devices`) that iot-pms does not manage yet.
  - Pick a device, choose a cabin or room and its role, then add it.
  - The managed list offers move to another space, disable, and remove.
  - **Pairing itself still happens in the igloohome app**: the REST API has no pairing call (research NF). This page adopts devices that are already paired.
- **Replaces `IGLOOHOME_ALLOWED_DEVICE_IDS`.** Enabled managed devices *are* the allowlist that the safety guards read. The current env list is imported once at migration; the variable is then removed.
- **Devices screen:** grouped by cabin or room (our spaces); the igloohome property is shown as a secondary label.
- **Exit:**
  - Tests: a guard refuses a disabled or unmanaged device, and adding or removing is audited.
  - The 6 current devices are migrated.

### F4b — Emergency lock/unlock (added 2026-09-27, approved by the user)
- **Source:** proxied jobs 1 (Lock) and 2 (Unlock), `jobData.lockTime` optional (DOC, docs.igloohome.co/home/bridge-jobs-proxied, re-read 2026-09-27). `lockTime` is never sent: it resets the lock clock. The page documents no auto-relock, duration or rate limit.
- **Guards:**
  - Off unless `IGLOOHOME_ENABLE_REMOTE_LOCK=true`. Super-admin only.
  - Managed, enabled **lock** with a Bridge link (not the switch or keypad; that waits for E15/E16).
  - Reason of at least 10 characters and **own password re-entry** for both unlock and lock.
  - One job in flight per lock; at most 3 unlocks per lock per 10 minutes; never retried.
- **Token:** a dedicated token with only `lock-`/`unlock-bridge-proxied-job` plus `get-job-status`. Every other token keeps excluding the physical scopes. The client allows job types 1/2 only through this path.
- **Visibility:**
  - audit `device.unlock` / `device.lock` with the reason, and a job row;
  - a 24 h Overview banner;
  - after an unlock, "Lock again" until the lock reports locked.
  - No automatic re-lock timer unless E22 shows it is needed.
- **E22 (hardware):** the user runs it on the bench devices (Doorlock and its Bridge; `bridge-lab` and `darderdoor` excluded). It records latency, lock log types, job results, auto-relock, and offline behavior.

### F6 — Review (0.5 day)
- Security review of auth, the vault and scopes; a scan for leaked PINs and IDs; docs; progress log; memory update.

## 5. Files (main)

| File | Action |
|---|---|
| `docker-compose.yml`, `db/init/*.sql`, `db/migrations/*.sql` | CREATE |
| `src/server/storage/db.ts` (+ a new query interface), all modules with SQL | UPDATE |
| `scripts/db-migrate.ts`, `scripts/db-import-sqlite.ts` | CREATE |
| `src/server/users.ts`, `src/auth.ts`, `src/server/auth-policy.ts` | CREATE / UPDATE |
| `src/lib/scopes.ts`, `src/server/igloohome/token.ts` (cache per scope set) | CREATE / UPDATE |
| `src/server/application/pin-vault.ts`, `src/server/crypto/pin-cipher.ts` | CREATE |
| `src/app/(dashboard)/people/*`, `vault` view in Access, Activity Bridge picker | CREATE / UPDATE |
| `src/server/application/device-registry.ts`, `src/app/(dashboard)/devices/add/*`, guards reading the registry | CREATE / UPDATE |
| `docs/architecture/system-context.md`, env docs, plan log | CREATE / UPDATE |

## 6. Validation

```bash
colima status && docker compose up -d db && docker compose ps
bun run db:migrate && bun run db:import-sqlite
bun run check          # typecheck + lint + tests (PGlite)
bun run build
```
Browser pass at 390 px and 1440 px for each role (viewer, operator, super-admin), plus a leak scan.

## 7. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Regressions from rewriting about 45 SQL statements | Medium | The tests already cover these modules; they run on PGlite (real Postgres SQL) |
| Locking yourself out (a bug in the new login) | Low | The `.env` account stays as a break-glass super-admin |
| The PIN vault becomes the most valuable secret | High impact | AES-256-GCM, a key only in `.env`, reveal/revoke audited, no plain text in logs or dumps, a key version for rotation |
| Requesting an unentitled scope fails the whole token | Unknown (Q4) | E21 first; fall back to requesting only what `server-health` reports as granted |
| Trial ends 2026-10-17 | High | F3's E21 and the vault revoke test need the API; do them before the trial ends; ask support |
| Shared Postgres server with Bobobox AU later | Low | Separate databases and roles, no cross-database access; integration by API |

## 8. When to refactor (your question)

| Option | What | For | Against |
|---|---|---|---|
| **A. Now** | Postgres, accounts, roles and scopes first (F1–F3), then features | Every later feature builds on the final base; the SQL rewrite is smallest now | 2–3 days with few visible changes |
| **B. Later** | Build the vault and grouping on SQLite with `.env` users; migrate at the end | Quick visible wins | Per-user scopes and the vault **need** database users anyway, so the work is done twice, and more SQL to rewrite later |
| **C. Now for infrastructure, later for domain naming** *(recommended)* | Do F1–F3 now. Leave "admin vs operator", the Access vocabulary and the published API for Bobobox AU until its DDD context map fixes the X3 contract | Stable base now, no guessing at DDD terms | Role names may change once more (cheap: a label plus one migration) |

iot-pms itself should **not** adopt full DDD. It is an integration service (a supporting subdomain); its current structure (provider adapter → application → storage) fits. DDD belongs in Bobobox AU, which will put an ACL in front of iot-pms.

## 9. Decisions needed

| # | Question | Recommendation |
|---|---|---|
| Q1 | Refactor timing | **C** |
| Q2 | Postgres setup | `postgres:17` container, `127.0.0.1:5432`, database `iot_pms` now; Bobobox AU gets its own database later |
| Q3 | Database library | **postgres.js + PGlite for tests** (no ORM; the SQL stays readable) |
| Q4 | Super-admin "no limitation": do the `.env` hardware switches (`ENABLE_*`, allowlist) still apply to them? | **Yes.** They are hardware kill-switches that the super-admin sets in `.env`, not role limits |
| Q5 | Read scopes for every signed-in user; per-user scopes only for credentials and jobs | **Yes** |
| Q6 | Super-admin PIN reveal is recorded in the audit log (not blocked) | **Yes** |
| Q7 | The `.env` fallback account becomes the first super-admin and the break-glass login | **Yes** |
| Q8 | Order | F0 → **F5 (quick win)** → F1 → F2 → **F7** → F3 → F4 → F6 |
| Q9 | Who can add, move or remove devices? | **Super-admin only**; operators see the registry |
| Q10 | Space types | **`cabin` and `room` only**, as a fixed list; more types need a migration (cheap) |

## 10. Progress

- **F0 done (2026-09-27):** `docs/architecture/system-context.md`.
- **F5 done (2026-09-27):**
  - The Activity page has a Bridge picker (All · bridge-lab · bridge, with event count and connection status), kept in `?bridge=`.
  - "All" shows one section per Bridge, with day groups inside.
  - A Bridge with no events explains why (offline Bridges send none).
  - Checked at 390 px and 1440 px, 0 leaks.
  - The Overview keeps its 5 latest events, each labelled "via Bridge …".
- **F1 done (2026-09-27):**
  - `docker-compose.yml` runs `postgres:17-alpine` on `127.0.0.1:5432`. An init script creates the non-superuser role `iot_pms` and database `iot_pms`. Passwords were generated into `.env` and never printed. `db/README.md` covers adding the Bobobox AU database later.
  - `src/server/storage/db.ts`: postgres.js behind the existing `execute({sql, args})` shape (`?` → `$n`; rows normalized to ISO strings, JSON text and numbers). Versioned migrations run at startup, and the startup fails fast without `DATABASE_URL`.
  - SQLite-only SQL replaced:
    - `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`
    - `lastInsertRowid` → `RETURNING id`
    - `json_extract` → jsonb paths
    - `LIKE` on jsonb → `body::text`
  - **Found while testing:** postgres.js stores a JSON text parameter in a `jsonb` column as a JSON *string*. Webhook bodies are inserted with `?::text::jsonb`.
  - Tests run on PGlite (`tests/helpers/db.ts`). `bun run db:migrate` and `bun run db:import-sqlite` added.
  - Imported all evidence: 150 webhook events, 2,000 API-call logs, 50 jobs, 6 access codes (SQLite file kept).
  - Verified:
    - 121 tests pass; `next build` passes.
    - Every page returns 200 on Postgres.
    - All 150 bodies are jsonb objects; 35 jobs match their webhooks.
    - `iot_pms` is not a superuser.
    - `bun run events` works (it now exits explicitly because of the connection pool).
- **F2 done (2026-09-27):**
  - Migration `0002_users`: `users` (roles `viewer | operator | super_admin`; case-insensitive unique username and e-mail) and `audit_events`.
  - `src/server/users.ts`: create with a 16-character temporary password (shown once), reset, change own password (≥ 12 characters, must not contain the username), enable/disable, change role. Guards: nobody changes their own role or status, and one active super-admin always remains.
  - Login (`auth.ts`):
    - Checks database accounts with bcrypt and a timing-safe dummy hash.
    - The `.env` account is **always** super-admin: bootstrap on the first start plus the break-glass login. `AUTH_FALLBACK_ROLE` is ignored, with a startup warning.
    - The session re-reads the account at most every 60 s, so a disabled account is signed out and a role change applies within a minute.
    - A temporary password forces `/account/password`.
  - Role checks are by rank (`atLeast`), so a super-admin passes every operator check.
  - The People page (super-admin only; not found for others) and the audit panel. The nav shows People to super-admins; the account card has "Change password".
  - Verified end-to-end in the browser against Postgres:
    - bootstrap created the `.env` break-glass account as super-admin;
    - the super-admin created an operator;
    - the operator was forced to change the temporary password, signed in, sees "Operator (admin)", and gets not-found on `/people`;
    - after disable, the login is refused;
    - all 7 steps are in `audit_events`.
  - 128 tests pass; `next build` passes. The test account `qa-test-operator` is left **disabled** in the database.
- **F1b done (2026-09-27): Drizzle ORM** (`drizzle-orm` 0.45.3, `drizzle-kit` 0.31.11, exact pins).
  - `src/server/storage/schema.ts` holds all 6 tables. It matches the live database, including index and constraint names. The baseline migration `db/migrations/0000_baseline.sql` was diffed against the live schema: no drift.
  - `db.ts` uses postgres.js through Drizzle, and migrations run at startup. The first start adopted the existing database: it recorded the baseline in `drizzle.__drizzle_migrations` and dropped the old `schema_migrations` table. Tables and data were not touched.
  - Every module now uses typed Drizzle queries: webhook intake, API-call log, dashboard/activity, health check and jobs, access codes, PIN jobs, users and audit. Raw SQL remains only in two places: the jsonb path and `body::text LIKE` fragments, and the generic SQLite import script.
  - The job-complete webhook lookup is shared (`src/server/storage/events.ts`).
  - Drizzle wraps driver errors, so the duplicate-username check reads the Postgres code `23505` from the error or its cause.
  - `bun run db:generate` was added. Tests run on PGlite with the same migrations.
  - Verified:
    - 128 tests pass; typecheck, lint and `next build` pass.
    - `drizzle-kit check` is clean, and `drizzle-kit generate` finds no schema changes.
    - On the live Postgres (inside a rolled-back transaction), a Drizzle jsonb insert is stored as a jsonb **object**, so the postgres.js "JSON string" problem from F1 does not occur, and the jsonb-path job lookup finds it.
    - Counts are intact: 150 events (0 non-objects), 2,000 calls, 50 jobs, 6 codes, 2 users, 6 audit rows.
    - Every page returns 200 with the stored data.
- **F7 done (2026-09-27): device registry.**
  - Migration `0001_device_registry` (the first one generated by Drizzle):
    - `spaces`: kind `cabin | room`; name unique ignoring case; optional igloohome property and time zone.
    - `managed_devices`: full device ID (unique), name, kind and model when adopted, space (FK, restrict), role `door_lock | bed_lock | keypad | switch | bridge`, `enabled | disabled`.
  - `src/server/application/device-registry.ts`:
    - Create and delete spaces; only an empty space can be deleted.
    - Adopt, move, change role, enable/disable and remove devices.
    - Every change writes an `audit_events` row (`space.*`, `device.*`), with display IDs only.
  - **Enabled managed devices are the allowlist.** Health checks, PIN jobs and algoPINs read `managedAllowlist()` instead of `IGLOOHOME_ALLOWED_DEVICE_IDS`. The refusal message now reads "not managed by iot-pms, or is disabled".
  - One-time import at startup:
    - The env list was copied once (6 devices; marked by a `registry.import` audit row).
    - Names, kinds and models are filled from `GET /devices` on the next listing.
    - The import never runs again, even if the registry is emptied.
    - The env variable is now ignored, with a startup warning, and is deprecated in `.env.example`.
  - **Devices → Manage** (`/devices/manage`, super-admin only, not found for others):
    - Ready to add: devices on the igloohome account that are not managed yet. Pairing still happens in the igloohome app.
    - Managed devices, grouped by space: move, role, disable, and remove (with a confirmation).
    - Cabins & rooms form and list; registry activity.
    - The browser only sends display IDs; the server resolves the full ID from the live list.
  - **Devices screen** is grouped by cabin/room (kind chip and icon; the igloohome property as a secondary label), then "No cabin or room yet". Devices that are on the account but not managed are listed separately. The Overview still counts igloohome properties.
  - Verified:
    - 133 tests pass, including 5 new registry tests on PGlite (import once; the guard refuses unmanaged/disabled; audited with no full IDs; space rules; backfill).
    - Typecheck, lint and `drizzle-kit check` pass.
    - On live Postgres: 6 devices imported and backfilled; every page returns 200; 0 full device IDs in the rendered pages.
    - Browser flow at 1440 px and 390 px: create a cabin, move a lock into it, check `/devices` grouping, move it back, delete the cabin. No page errors and no mobile overflow. The QA cabin is gone; its audit rows remain.
- **F7b done (2026-09-27): the registry at scale.** Plan agreed in chat; defaults answered by the user: a second Bridge in a cabin gets a **warning, not a block** ("maybe later we can have 1 cabin with multiple bridge"); at most 3 watched cabins, configurable; Overview, Access and Activity also use the cheap overview.
  - **Add by Bridge:**
    - `bundleOf()` returns the Bridge's `linkedDevices`, plus what a linked keypad reports, one level deep.
    - `adoptBundle()` adds and moves them into one cabin or room in a single transaction, with a `space.adopt_bridge` audit row plus one row per device.
    - The Manage dialog shows the preview; devices already placed in another cabin or room start unticked.
    - A second Bridge in a space is allowed with a warning (bundle, single add, and move).
  - **Fewer igloohome calls:**
    - `getSite` no longer calls `GET /devices/{id}` for every device. The account device and property lists are cached for 60 s in-process.
    - Per-device detail runs only for watched cabins. It is reused for 30 s unless the device sent an event since, and is stored in `device_state` (migration 0002) as the last-known state.
    - Measured: 3 Devices page loads = 1 `listDevices` + 1 `listProperties` + 0 `getDevice` (before: 6 `getDevice` per load with 6 devices). Watching a cabin with 2 devices = 2 `getDevice`.
  - **Devices page:**
    - Compact cabin/room rows: Bridge status, device count, last event, and attention chips (Bridge offline, low battery, no Bridge, several Bridges).
    - URL filters: search, kind, Bridge status, needs attention; 25 rows per page.
    - Watch up to `IOT_PMS_MONITOR_MAX` (default 3; `?watch=`), which shows the full topology panel for those cabins.
    - The live poll re-renders at once only for events from watched devices; other events refresh the rows at most every 30 s.
  - **Manage page:** Bridges first in "Ready to add"; managed devices in collapsed cabin groups; search and status/kind filters; "show more"; search in the cabins list.
  - Verified:
    - 139 tests pass (new: bundle, one-level links, the warning, the live-detail cache, row filters and the watch list). Typecheck, lint, `next build` and `drizzle-kit check` pass.
    - Browser flow at 1440 px and 390 px: add `bridge-lab` with its linked lock into a QA cabin; watch it; filter to the empty state; no page errors, no mobile overflow.
    - Cleanup: QA cabin deleted and both devices moved back to "no cabin". `bridge-lab` was removed and re-added during the test, so its row now shows added by the `.env` break-glass account.
    - The user's own Cabin-01 was left untouched.
    - 0 full device IDs on all pages.
- **F3 done (2026-09-27): per-user igloohome scopes.**
  - `src/lib/scopes.ts`: catalog of the 18 documented scopes plus 2 found granted (E21), grouped as read / Bridge health checks / PINs and credentials / physical / other; each says which iot-pms feature uses it.
  - Rules:
    - super-admin = the whole ceiling;
    - everyone else = the 4 read scopes (Q5) plus assigned ones, never beyond the ceiling.
  - Every refusal says whether the **user** or **our client** lacks the scope.
  - Migration `0003_scopes`: `scope_syncs` (ceiling history; the latest wins; `IGLOOHOME_SCOPES` until the first sync) and `user_scopes`.
  - **Sync (People → igloohome scopes):** one token requested **without** `scope`, used only for `server-health`, then dropped (`TokenProvider` explicit `allScopes` mode; an empty list is still refused everywhere else). Audited as `scopes.sync` with the difference.
  - **Enforcement, two layers:**
    1. Guards check the caller's scopes before any call. Every job kind now names its scope (`JOB_SCOPE`).
    2. Health checks, PIN jobs and algoPINs call igloohome with a token requested with that caller's scopes (one token per scope set, in memory).
  - Tokens never include scopes that no iot-pms feature uses (lock/unlock, master PIN, eKey, update-device, store-activity, edit-PIN, job 15), even for a super-admin.
  - Reads use a shared token that carries the read scopes only.
  - People: each operator/viewer row has "Scopes · n" with a grouped checkbox editor (read scopes shown as always on; scopes not granted to our client disabled). Changes are audited as `user.scopes`, e.g. `+algopin-hourly -algopin-onetime`. Super-admin rows show "All 20 scopes".
  - The Overview shows "Your scopes · n of 20 granted to iot-pms".
  - **E21 recorded** (`docs/research/igloohome/experiments/EXP-20260927-01-scope-ceiling.md`): our client is granted **20** scopes, the 18 documented plus `store-device-activity` (resolves D13) and `edit-pin-bridge-proxied-job`. There are no iglooKey or passage scopes.
  - Verified:
    - 146 tests pass (new `scopes.test.ts`: rules, both refusal messages, an operator without `algopin-hourly` refused before any call, a health check needs its job scope, sync and assignment storage and audit, the token body carrying exactly the user's scopes, only the sync mode omitting `scope`). Typecheck and lint pass.
    - Browser, as super-admin: Sync, then give `qa-test-operator` the battery check only.
    - Browser, as that operator: the Overview shows 5 of 20; Bridge diagnostics and the hourly algoPIN are refused with "You do not have the … scope". No job was started.
    - Cleanup: the scope was removed and the account disabled again.
    - Fixed a React key warning (a server element passed into the client People console).
- **F4 done (2026-09-27): PIN vault.**
  - `src/server/crypto/pin-cipher.ts`: AES-256-GCM; the device ID is bound as additional data; format `v1.<iv>.<tag>.<ct>`.
  - Key: `IOT_PMS_PIN_KEY` (32 bytes, base64). It was generated into `.env` and never printed. Startup refuses to run while algoPIN or PIN-job creation is on without it.
  - Migration `0004_pin_vault`: `pins` (device, kind, type, name, window, ciphertext, key version, fingerprint, links to the access code, create job and revoke job).
  - **Writes:**
    - algoPINs are stored right after igloohome returns them; custom PINs after job 4 is accepted;
    - a vault failure is logged, never undoes the PIN;
    - any accepted job 5 (typed or from the vault) marks matching not-revoked entries (same lock and fingerprint).
  - **Access → PIN vault tab:**
    - everyone sees the list with masked PINs, status (from the linked code or jobs), search and a "Still valid" filter;
    - the super-admin gets **Reveal** (hidden again after 30 s, copy) and **Revoke** (confirm; decrypts and sends job 5 through the guarded flow, with a link to the job);
    - `pin.reveal` and `pin.revoke` are audited, with display IDs only and never the PIN.
  - PINs created before the vault are not recoverable (said in the UI).
- **F4b done (2026-09-27): emergency lock/unlock.**
  - `client.createLockJob` is the only path to jobs 1/2 (body `{jobType}`, never `lockTime`); `createProxiedJob` still refuses them. New job kinds `remote_lock` / `remote_unlock` and catalog entry `createLockJob` (R3, DOC).
  - **Guards** (`safety.ts` + `remote-lock.ts`):
    - super-admin only, even with the scope; flag `IGLOOHOME_ENABLE_REMOTE_LOCK`;
    - locks only; managed and enabled lock and Bridge; the physical scope must be in the ceiling;
    - one job in flight per device; at most 3 unlocks per lock per 10 minutes;
    - reason of 10–200 characters and the person's **own password** each time (the break-glass account is checked against the `.env` hash). A wrong password is audited as `device.<action>_refused`.
  - **Token:** only `lock-` or `unlock-bridge-proxied-job` plus `get-job-status`. `tokenScopes()` keeps physical scopes out of every other token.
  - **UI:**
    - Devices → watched cabin → lock → Emergency (red panel; "Unlock now" / "Lock now"; dialog with place, Bridge status, last-known lock state, reason, password);
    - the Overview banner lists every emergency action of the last 24 h for everyone, with "Lock again" (super-admin, links to the watched cabin) until a later lock or a "locked" report.
  - Verified:
    - 156 tests pass (new: cipher, vault storage/reveal audit/revoke linking, emergency guards, unlock limit, token scopes, client job-type isolation, password re-entry). Typecheck, lint and build pass; migration 0004 applied.
    - Browser: the vault tab renders (0 entries); with the flag off the Emergency panel shows and "Unlock now" is disabled with the reason; no emergency banner; 0 full device IDs; no page errors.
  - **E22 pending** (user, bench Doorlock via `bridge`; not `bridge-lab` or `darderdoor`).
- **E22 done (2026-09-27):** `docs/research/igloohome/experiments/EXP-20260927-02-remote-lock.md`.
  - Lock/unlock work; the lock moves in about 3–8 s and the webhook arrives in 7–12 s.
  - Remote actions log as Bluetooth actions (11 / 37), followed by a clock sync (13). No auto-relock.
  - With the Bridge dropping, a job was accepted with 200 and never ran.
  - **Bug fixed:** jobs now settle from their job-complete webhook on read (`settle()` in `health-check.ts`; before, only a GET /jobs poll moved them). Disabled job buttons re-enable when their wait ends (`retryAt` plus `RefreshAt`). Regression test `job-settle.test.ts`.
  - The user keeps `IGLOOHOME_ENABLE_REMOTE_LOCK=true` as a showcase.
- **F6 done (2026-09-27): review.**
  - **Security review** (independent, read-only) of every server action, emergency lock/unlock, vault crypto, scopes/tokens, device-ID exposure, webhook intake and session handling.
    - Confirmed OK:
      - every action re-checks the session and role and rebuilds its input;
      - jobs 1/2 are reachable only through `runRemoteLock`; Try-it is R0 only;
      - AES-GCM uses a random IV, device AAD and tag check;
      - the all-scopes token is used once and never cached;
      - `tokenScopes` strips unassigned and physical scopes;
      - `toPublic` drops full IDs; disabled users are signed out within 60 s.
    - **MEDIUM, fixed:** a temporary password was enforced only by the dashboard layout redirect, so a direct server-action POST skipped it. Now the proxy (`authorized` in `src/auth.ts`) redirects every request except `/account/password`. Verified: a temporary-password session gets 302 for both a page GET and an action POST; `/account/password` 200; a normal session is unaffected.
    - **LOW, kept open on purpose:** webhook signatures are opt-in (`IGLOOHOME_WEBHOOK_REQUIRE_VALID_SIGNATURE`). There is no public key yet, and failing closed before a real event verifies `valid` could drop genuine events (activity logs are deleted from the lock once read). Unverified rows are labelled UNVERIFIED.
      - Note: job settling (E22 fix) and vault revoke status read job-complete webhooks. A forged event would need the unguessable provider job ID.
      - Turn strict mode on after the first `valid` event.
  - **Leak scans (all 0):**
    - full device IDs in `api_calls` excerpts, `audit_events`, docs, `db/` and `var/dev.log`;
    - PIN values in API-call excerpts, webhook bodies and PIN audit rows;
    - `AUTH_SECRET`, igloohome client secret, `IOT_PMS_PIN_KEY` and database passwords in `.next/static` client bundles, `src`, `docs`, `db`, `tests` and `scripts`;
    - `NEXT_PUBLIC_` variables in `.env`.
    - `.gitignore` covers `.env*` (keeps `.env.example`), `var/`, `*.db` and `.next/`.
  - **Docs updated:** `environment-configuration.md` (scopes as the ceiling, `IGLOOHOME_ENABLE_REMOTE_LOCK`, deprecated allowlist, `DATABASE_URL`, `IOT_PMS_PIN_KEY`, `IOT_PMS_MONITOR_MAX`, token rules), `integration-architecture.md` (client surface: `createAlgoPin`, `createPinJob`, `createLockJob`), `device-topology.md` (full IDs live in Postgres), EXP-20260927-02 L4b (auto-relock with the door sensor: user report).
  - 157 tests pass; typecheck, lint and build pass.
  - **Open items after the foundation plan:**
    1. Webhook public key from igloohome support, then strict signature mode.
    2. Vault write path not yet exercised live: create one algoPIN, then check that it appears in the vault, that reveal works, and that revoke works.
    3. E8b / L4b: door sensor and auto-relock once a lock is mounted.
    4. E15/E16: switch and keypad jobs (undocumented; need approval).
    5. U18: activity endpoint 403.
    6. Remove `IGLOOHOME_ALLOWED_DEVICE_IDS` and `AUTH_FALLBACK_ROLE` from `.env` (both ignored, with warnings).
    7. Per-process state (list/token caches, login rate limiter) needs a shared store before running more than one instance.
    8. Bobobox AU DDD naming (admin vs operator, Access vocabulary) once its context map fixes the X3 contract.
    9. The igloohome trial ends **2026-10-17**.

## After the foundation plan

- **Vault fix (2026-09-27):** a vault revoke stayed "Revoking…" on screen although job 5 had finished. The Access page never re-read the status.
  - The vault list now polls a light status action every 4 s while an entry is "pending" or "revoking" (at most 3 minutes).
  - One-time custom PINs show **Used** after their first successful entry: `firstUse` is scoped to the device and to after the PIN's creation, because PIN values can be reused.
  - Each status has a plain-words reason on hover, e.g. "already used once on the lock; igloohome released it (delete result 3)".
- **G1 done (2026-09-27): super-admin experiment mode**, approved by the user. The "Not supported" job types (3, 14, 16, 18, 19, 24, 29) stay blocked; the separate flag was accepted.
  - `IGLOOHOME_ENABLE_EXPERIMENTS` (default `false`). A super-admin with the flag may send supported jobs to a **switch or keypad** (documented for locks only). The decision carries `experimental: true`, and jobs get `provider_jobs.experimental` (migration 0005). Operators and fobs are still refused, with the reason.
  - **Step-up** (`step-up.ts`): reason plus own password for experiments, lock/unlock and job 15; wrong passwords are audited. Shared by health checks, PIN jobs and lock jobs.
  - **Job 15** (pull activity logs, destructive read) is added as kind `pull_logs`: super-admin only, allowed in `createProxiedJob`.
  - **Where experiments run:**
    - lock/unlock on the switch or keypad from the watched cabin's Emergency panel ("Experiment · UNVERIFIED");
    - custom PIN and delete (jobs 4/5) on the keypad or switch from Access, where the confirm dialog adds reason and password;
    - Developer → Try it: super-admins get job types 9, 10, 2, 1, 5, 15 on any managed lock, switch or keypad, routed through the guarded use cases (never directly to the client).
    - The one-click health-check launcher points experiments to Try it.
  - **Findings:** `experimentFindings()` gives the latest outcome per device and job (works / failed / no result / waiting, with the detailed reason). Shown as badges with the reason on hover in the device panel, the Emergency panel and Try it.
  - **Keypad labels:** a keypad target reads "Keypad-Bedlock · keypad for switch-bedlock" (from its link) in algoPIN and PIN forms.
  - **Reveal ID:** super-admin only, on device details and Manage rows. Audited as `device.reveal_id` with the display ID only; hidden after 30 s; never in page HTML (leak scan 0 on every page and in `audit_events`).
  - Verified:
    - 159 tests pass (new: the experiment rule, job 15 rules, unsupported job types still refused by the client, the reason check). Typecheck, lint and build pass.
    - Browser: the switch shows why it is refused and how to enable experiments; Reveal ID returns the 12-character ID and writes the audit row; Try it offers the 6 job types and the extra fields; no page errors.
  - **Pending:** the user's experiments E10b (algoPIN on the keypad), E16 (custom PIN on the keypad), E15 (switch unlock/lock), U20 (switch battery/status).
- **G1 results and follow-ups (2026-09-28):** `EXP-20260928-01-switch-keypad.md`.
  - The keypad holds and checks the PINs and commands the switch over Bluetooth; the switch is the motor and re-locks itself in 4–6 s.
  - **Proven combinations became regular features** (`src/lib/device-support.ts`, read by `checkHealthCheck`): switch 9/10/1/2/15, keypad 4/5/9.
  - Combinations that did not work are refused with the reason: switch 4/5, keypad 1/2 (no motor), keypad 10/15.
  - Emergency and custom-PIN target lists always include the switch and keypad, so their state and reason are visible. The lock and switch emergency badges show **HW**.
  - Badges have a new **No effect** status.
  - Vault revoke always takes a reason and password (visible fields; the error stays in the dialog). PINs that never reached a device show "Not created · Never reached the device".
  - The Overview emergency list is a collapsible `<details>`: it opens by itself only while an unlock is not locked again, and counts lock-type logs (e.g. auto-relock 48) as locked again.
  - Verified: 159 tests pass; live check of all of the above; no page errors.
- **algoPIN determinism fix (2026-09-28):** EXP-20260928-01 K8/K9.
  - Deletes and first uses now count only on the same device and after the code was issued (`deletesOf`, `firstUse` scoped).
  - New status "Same PIN deleted before", with a reason on hover and a warning at issue time.
  - Vault maps a device delete to Revoked.
  - Hover reasons on the Issued list, including the 24 h activation rule.
  - Regression test `access-code-status.test.ts`; 162 tests pass.
- **K8 settled and Access UX for scale (2026-09-28):**
  - The user confirmed on hardware that a re-issued, previously deleted algoPIN is **refused** by the device (both never-used and used-then-deleted). The status is now "Refused: deleted before" (red), with text stating the fact. Job 15 on the Doorlock works.
  - **Device picker** (`device-picker.tsx`) replaces the native selects in the algoPIN, Custom PIN and Delete PIN forms: search by name, cabin/room or ID; kind chips; "Available only"; grouped by cabin/room (`placesOf`); unavailable devices greyed with the reason; arrow keys and Enter; "Experiment" hint.
  - **Vault filters:** status chips with counts (All, Still valid, each status present) and a device filter, next to search.
  - **Issued list:** compact one-line rows (name, status, type, device, created time) that expand for the details. Filters: text, device, status, created-from/to dates (Asia/Jakarta days). 15 rows at a time with "Show more"; up to 100 loaded.
  - **Mobile fix:** the Access grid had no column cap, so wide content (date inputs, timestamps) pushed the page to 409 px at 390 px. Now `grid-cols-[minmax(0,1fr)]`; the document is 390 px on every tab.
  - Verified: 162 tests pass; build passes; browser check of picker (grouping, search, keyboard), issued filter, vault chips; no page errors.

