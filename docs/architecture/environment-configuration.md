# Environment Configuration

Date: 2026-09-25 (revised for Next.js + Auth.js). Template: [`/.env.example`](../../.env.example). Real values go in a local `.env` only (git-ignored). **No variable may use the `NEXT_PUBLIC_` prefix** — everything is server-only.

## 1. What the igloohome API actually needs (evidence)

| Value | Needed? | Source | Status |
|---|---|---|---|
| Client ID | **Yes** | Portal → API Access (A: Getting Started "Step 1"; B same) | DOC |
| Client Secret | **Yes** | Same | DOC |
| Token endpoint | **Yes** | `https://auth.igloohome.co/oauth2/token` (A + B security scheme) | DOC; verify E1 |
| API base URL | **Yes** | `https://api.igloodeveloper.co/igloohome` (A guides + B OpenAPI `servers`) | DOC + PROBE; verify E2 |
| Scope list | Optional for the API, **required by our policy** (omitted = all permissions) | A + B | DOC |
| Access token | Obtained at runtime; **not configured** | — | DOC |
| Refresh token | **Not used**: client-credentials flow returns none | A | DOC |
| Redirect URI | **Not used**: only for iglooconnect partners | A | DOC |
| API key | **Not used**: iglooworks only | A (works) | DOC |
| Webhook public key | Later (webhooks milestone) — base64 RSA 2048 DER PKCS1 from support | A + B | DOC |

## 2. Variables

All `IGLOOHOME_*` and custom `AUTH_*` names are **ours**; each `IGLOOHOME_*` value maps to a documented igloohome value above. `AUTH_SECRET`, `AUTH_URL`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` follow Auth.js conventions — confirm against the Auth.js version installed at M1.

### App

| Variable | Required | Secret | Default | Meaning |
|---|---|---|---|---|
| `LOG_LEVEL` | no | no | `info` | pino level |
| `DATABASE_URL` | yes | **secret** | *(none)* | Postgres connection (role `iot_pms`, database `iot_pms`), Colima/Docker: see `db/README.md`. Checked at startup |
| `POSTGRES_SUPERUSER_PASSWORD`, `IOT_PMS_DB_PASSWORD` | for `docker compose` | **secret** | *(none)* | Used once, when the data volume is created (`db/init/10-iot-pms.sh`). Letters and digits only |
| `SQLITE_IMPORT_PATH` | no | no | `./var/iot-pms.db` | Legacy SQLite file read by `bun run db:import-sqlite` |

### Dashboard login

| Variable | Required | Secret | Default | Meaning |
|---|---|---|---|---|
| `AUTH_SECRET` | **yes** | **yes** | *(empty)* | Signs session cookies; app refuses to start without it |
| `AUTH_URL` | yes | no | `http://localhost:3000` | Dashboard base URL. Open the app at `localhost`, not `127.0.0.1` — redirects use `localhost` and a host mismatch drops the session cookie (observed in M1 smoke test) |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | no | **yes** | *(empty)* | Google provider enabled only when both set. **Not available yet** |
| `AUTH_ALLOWED_EMAIL_DOMAIN` | with Google | no | `bobobox.com` | Only verified emails in this domain may sign in |
| `AUTH_ALLOWED_EMAILS` | no | no | *(empty)* | Optional narrower allowlist |
| `AUTH_OPERATOR_EMAILS` | no | no | *(empty)* | Google users with the `operator` role; others are `viewer` |
| `AUTH_FALLBACK_USERNAME` | until Google | no | *(empty)* | Single fallback login; enabled only with the hash below |
| `AUTH_FALLBACK_PASSWORD_HASH_B64` | until Google | **yes** | *(empty)* | base64 of a bcrypt hash (base64 avoids `$` expansion in `.env`); generated locally by `scripts/hash-password.ts` |
| `AUTH_FALLBACK_ROLE` | no | no | — | **Ignored since plan F2 (2026-09-27).** The `.env` account is always super-admin (bootstrap + break-glass); other accounts are managed on the People page |

### igloohome

| Variable | Required | Secret | Default | Meaning |
|---|---|---|---|---|
| `IGLOOHOME_API_BASE_URL` | yes | no | `https://api.igloodeveloper.co/igloohome` | Selected contract base (plan §6). Change only after E2 evidence |
| `IGLOOHOME_AUTH_TOKEN_URL` | yes | no | `https://auth.igloohome.co/oauth2/token` | |
| `IGLOOHOME_CLIENT_ID` | yes | **yes** | *(empty)* | Portal `web.igloohome.co/api` → API Access |
| `IGLOOHOME_CLIENT_SECRET` | yes | **yes** | *(empty)* | Same |
| `IGLOOHOME_SCOPES` | yes | no | slice-1 read + health-check scopes | Space-separated; app refuses to start if empty. Since plan F3 it is the ceiling only until the first People → Sync, and the source of the shared read token's scopes. Per-person scopes are assigned on People |
| `IGLOOHOME_HTTP_TIMEOUT_MS` | no | no | `15000` | Our choice; vendor timeout not documented |
| `IGLOOHOME_ENABLE_BRIDGE_JOBS` | no | no | `false` | Enables health-check jobs (R1) |
| `IGLOOHOME_ENABLE_PIN_JOBS` | no | no | `false` | M5: enables Bridge job 4 (custom PIN) and job 5 (delete PIN), R2. Needs `igloohomeapi/create-pin-bridge-proxied-job` and `igloohomeapi/delete-pin-bridge-proxied-job` |
| `IGLOOHOME_ENABLE_ALGOPIN` | no | no | `false` | M5: enables creating algoPINs (R2) on allowlisted, algoPIN-capable locks. Needs the `igloohomeapi/algopin-onetime`, `-hourly`, `-daily`, `-permanent` scopes |
| `IGLOOHOME_ENABLE_REMOTE_LOCK` | no | no | `false` | Plan F4b: emergency lock/unlock (jobs 1/2, **physical**). Super-admin only, reason + own password each time, max 3 unlocks per lock per 10 minutes. The lab install keeps it `true` as a showcase (user decision, EXP-20260927-02) |
| `IGLOOHOME_ALLOWED_DEVICE_IDS` | no | **sensitive** | *(empty)* | **Deprecated (plan F7).** Copied once into the device registry on the first start, then ignored with a warning. Devices → Manage is the allowlist now. Remove it |
| `IGLOOHOME_WEBHOOK_PUBLIC_KEY` | recommended | keep out of repo | *(empty)* | Webhook signature key (base64 RSA 2048 DER PKCS1). Without it events are stored as `no_key` |
| `IGLOOHOME_WEBHOOK_REQUIRE_VALID_SIGNATURE` | no | no | `false` | `true` rejects unsigned/invalid events with 401. Turn on only after a real event verified `valid` |

PIN fingerprints in stored webhook events use a key derived from `AUTH_SECRET`; rotating `AUTH_SECRET` changes all future fingerprints (and so the link between vault entries and activity logs).

### iot-pms

| Variable | Required | Secret | Default | Meaning |
|---|---|---|---|---|
| `DATABASE_URL` | yes | **yes** | *(none)* | Postgres as role `iot_pms` (plan F1). Migrations run at startup |
| `IOT_PMS_PIN_KEY` | while algoPIN or PIN jobs are on | **yes** | *(none)* | Plan F4 vault key: 32 random bytes, base64 (`openssl rand -base64 32`). Losing it makes stored PINs unreadable in iot-pms; the PINs keep working on the locks |
| `IOT_PMS_MONITOR_MAX` | no | no | `3` | Plan F7b: how many cabins/rooms the Devices page watches live at once (1–10) |

## 3. Rules

- `.env` is git-ignored; never paste values into docs, tickets, chat or screenshots.
- Rotate the igloohome client secret in the portal, or the fallback password, if either was ever exposed.
- The fallback login is a shared single account: fine on localhost for the POC, **not** acceptable for exposure beyond the internal network. Switch to Google before that.
- Adding a mutating igloohome scope requires an approved plan; the client also hard-restricts job types (architecture §4.2). Jobs 1/2 are reachable only through `createLockJob` (plan F4b).
- Tokens never carry scopes that no iot-pms feature uses; physical scopes only go into the emergency flow's own token (plans F3, F4b).
- Full device IDs only in the local Postgres database; docs, audit rows and every screen use redacted IDs.
