# igloohome API & IoT Ecosystem Research

Research date: **2026-09-25**
Status: **Documentation research complete. No authenticated API calls. No hardware tests.**
Scope: research only. No dashboard implementation.

> Note on naming: the vendor is **igloohome** (igloocompany). The project `CLAUDE.md` spells it "Igoohome"; that is a typo, not a different vendor.

## Artifacts

| # | Artifact | File |
|---|---|---|
| 1 | Research summary | this file |
| 2 | API capability matrix | [01-capability-matrix.md](01-capability-matrix.md) |
| 3 | Endpoint inventory | [02-endpoint-inventory.md](02-endpoint-inventory.md) |
| 4 | Account and authentication findings | [03-auth-and-accounts.md](03-auth-and-accounts.md) |
| 5 | Device and Bridge capabilities | [04-devices-and-bridge.md](04-devices-and-bridge.md) |
| 6 | Credential and PIN capabilities | [05-credentials-and-pins.md](05-credentials-and-pins.md) |
| — | Webhooks, jobs, events (supporting) | [06-webhooks-and-jobs.md](06-webhooks-and-jobs.md) |
| 7 | Unknowns, discrepancies and access blockers | [07-unknowns-and-blockers.md](07-unknowns-and-blockers.md) |
| 8 | PMS feature opportunities | [08-pms-opportunities.md](08-pms-opportunities.md) |
| 9 | Research sources | [09-sources.md](09-sources.md) |
| 10 | Recommended hardware and API experiments | [10-experiments-plan.md](10-experiments-plan.md) |
| 11 | Research synthesis and readiness review | [11-research-synthesis.md](11-research-synthesis.md) |
| 12 | Stoplight (older docs) vs docs.igloohome.co comparison | [12-stoplight-comparison.md](12-stoplight-comparison.md) |
| → | **Implementation plan** (proposed) | [../../plans/igloohome-implementation-plan.md](../../plans/igloohome-implementation-plan.md) |
| — | Raw doc snapshot (for diffing future doc changes) | [sources/2026-09-25/](sources/2026-09-25/) |

## Evidence labels

Every claim in these files carries one of these labels (from `CLAUDE.md` §4):

| Label | Meaning |
|---|---|
| **DOC** | Confirmed by official documentation |
| **DOC-PARTIAL** | Mentioned in official documentation, schema or semantics incomplete |
| **DOC-CONFLICT** | Official documentation contradicts itself; see `07-unknowns-and-blockers.md` |
| **PROBE** | Observed from an unauthenticated, read-only HTTP request (no credentials used) |
| **API** | Confirmed through an actual authenticated API request — *none yet* |
| **HW** | Confirmed through hardware testing — *none yet* |
| **3P** | Third-party source (secondary evidence only) |
| **HYP** | Hypothesis / inference requiring validation |
| **NF** | Not found in any source |

## What was researched

1. Started at `https://docs.igloohome.co/home`. The site publishes the **entire documentation suite** as a machine-readable corpus at `/llms-full.txt` (22,314 lines) plus `/llms.txt` and `/sitemap.xml`. All 64 sitemap URLs (64 `### FILE:` entries) are inlined in that corpus, so every page was read in full rather than sampled. The corpus is snapshotted with SHA-256 sums under `sources/2026-09-25/`.
2. Read all API reference pages (igloohome and iglooworks), all Bridge and Webhook articles, all Getting Started guides, and all BLE SDK pages (both flavours).
3. Sent **unauthenticated read-only GET** requests to the documented base URLs to resolve conflicting base-URL documentation. No credentials were used; no device was contacted.
4. Read the igloohome support article on the API portal (account types, pricing).
5. Read the older official Stoplight docs (`igloocompany.stoplight.io/docs/igloohome-api`, 28 pages, public via Stoplight API) and compared them — see `12-stoplight-comparison.md`.
6. Read one third-party client library (`keithle888/igloohome-api`, used by the Home Assistant integration) to cross-check the production base URL.

## Headline findings

### 1. There are two separate API products

| | **igloohome API** (`/home` docs) | **iglooworks API** (`/works` docs) |
|---|---|---|
| Target | igloohome app accounts (hosts, SMB, partners) | iglooworks enterprise accounts (companies with departments) |
| Scope prefix | `igloohomeapi/…` | `iglooworksapi/…` |
| Auth server | `auth.igloohome.co` | `auth.iglooworks.co` |
| Credentials | Self-service via igloohome API portal (30-day trial) | Via Business Development only |
| Extra features | iglooKey smart-link tokens, server-health | Departments, users, account, access list, grant/revoke ekey, async custom-PIN jobs, job list, admin key |

Source: DOC. **Which product our account belongs to decides which endpoints exist for us.** This is the first blocker to resolve.

### 2. Remote control is only through a Bridge, and it is asynchronous

Lock, unlock, custom PIN create/delete, battery, status and log retrieval are "Bridge proxied jobs". The API returns a `jobId` immediately; completion arrives by webhook (Job Complete event, `type: 3`) or by polling job status. HTTP 200 on job creation means *queued*, not *done*. (DOC)

### 3. algoPIN works without a Bridge

algoPIN codes (one-time, permanent, hourly, daily, passage) are computed server-side from the lock's secret; the lock validates them offline. No Bridge, no Wi-Fi needed. They cannot be edited, and deletion has hard limits (needs a Bridge job, and cannot delete far-future PINs). (DOC)

### 4. Onboarding (pair, link, Wi-Fi setup) is not in the REST API

Pairing a lock, linking a keypad/fob/Bridge to a lock, and configuring Bridge Wi-Fi are done over Bluetooth via the igloohome mobile app or the **private** BLE SDK (Android/iOS, distributed through a private GitLab registry). No REST endpoint for pairing or linking was found. (DOC for SDK; NF for REST)

### 5. The documentation has real contradictions

Three different base URLs, two token endpoints, two portal URLs, two support e-mail domains, and conflicting algoPIN deletion rules. 20+ discrepancies are logged in `07-unknowns-and-blockers.md`. Every one must be settled by an authenticated request before code depends on it.

## Confirmed vs. unconfirmed at a glance

| Category | Count / status |
|---|---|
| Endpoints documented (igloohome API) | 27 (see inventory) |
| Endpoints documented (iglooworks API) | 30 (see inventory) |
| Bridge proxied job types | 14 listed, **7 supported** |
| Bridge targeted job types | 1 (Get Device Status) |
| Webhook event types | 3 (Job Complete, Activity Log Received, Bridge Connection) |
| Capabilities confirmed by authenticated API call | **0** |
| Capabilities confirmed by hardware test | **0** |

## Next step

See `10-experiments-plan.md`. The recommended first action is **read-only**: obtain credentials, call `GET /server-health`, `GET /properties`, `GET /devices`, and record the real base URL, token shape, scopes, tier and device inventory. No mutating test should run until the target test lock and Bridge are identified and confirmed as not guest-facing.
