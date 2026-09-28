# Unknowns, Discrepancies and Access Blockers

Research date: 2026-09-25. Evidence labels: see [README](README.md#evidence-labels).

## 1. Access blockers (must be resolved by the user / business)

| # | Blocker | Why it blocks | Needed from |
|---|---|---|---|
| B1 | **Which product and account type?** igloohome User, igloohome Partner (iglooconnect), or iglooworks | Decides endpoint set, auth server, scopes, and feature ceiling | User — **narrowed 2026-09-25:** account is on the igloohome API portal (`web.igloohome.co/api`), so the product is igloohome API, not iglooworks. Individual vs Partner still to confirm |
| B2 | ~~No API credentials~~ | — | **Resolved 2026-09-25:** credentials in local `.env`; EXP-20260925-01 ran |
| B3 | ~~Test hardware inventory unknown~~ | — | **Resolved 2026-09-25:** 6 devices discovered (EXP-20260925-01); user confirms all are test devices and the app topology matches; all allowlisted |
| B4 | **Is the test lock guest-facing?** | CLAUDE.md §6 forbids mutating operations on production/guest devices | User — **Resolved (user, 2026-09-25):** test devices serve no guests; physical procedure in `10` §9.4 |
| B5 | **Trial ends 2026-10-17** (server-health `tier: TRIAL`, `endsAt`) | After that every call returns 402 | User: subscription decision before 2026-10-17 |
| B6 | Webhook public key | Required to verify signatures | Request from `dev+support@igloocompany.co` |
| B7 | Public HTTPS endpoint for webhooks | Needed to receive job results in experiments | User / infra |
| B8 | BLE SDK access (private GitLab token) | Needed only for onboarding or phone-based features | Stoplight: self-service accounts can generate the token in the iglooaccess dashboard; partners via e-mail (optional) |

## 2. Documentation discrepancies (DOC-CONFLICT)

| # | Topic | Conflict | Resolution plan |
|---|---|---|---|
| D1 | API base URL | ~~conflict~~ | **Resolved (API, EXP-20260925-01):** `api.igloodeveloper.co/igloohome` and `api.igloohome.co/home` both serve the same API; use the first |
| D2 | iglooworks base URL | `api.iglooworks.co/v2` (guides) vs `api.igloohome.co/works` (reference). Probe: 401 vs 500 | Test if applicable |
| D3 | Token endpoint | ~~conflict~~ | **Resolved (API):** `auth.igloohome.co/oauth2/token`, form-encoded, `expires_in` 86400, JWT with `scope` claim |
| D4 | API portal URL | `access.igloocompany.co/api-access` vs `web.igloohome.co/api/api-access` vs `web.igloohome.co/api/login` | **Resolved (user, 2026-09-25):** user logs in at `web.igloohome.co/api`; its documentation button links to `docs.igloohome.co` |
| D5 | Support e-mail | `dev+support@igloohome.com` vs `dev+support@igloocompany.co` | Try `.co` (used for webhook key) |
| D6 | algoPIN deletion window | "256 rule": start > 256 h from now cannot be deleted, vs "Unactivated algoPINs can only be deleted within one week of their start time" | Ask support; test on test lock with a disposable PIN |
| D7 | Custom PIN length | Bridge job: 4–6 digits; SDK `createPin`: 1–12 digits | Treat 4–6 as the REST limit |
| D8 | Bridge-targeted job path | Reference `POST /devices/{bridgeId}/jobs` vs article `/devices/{deviceId}/jobs` | Same thing (Bridge is a device); confirm |
| D9 | Webhook envelope | With and without outer `payload` wrapper | Capture a real webhook |
| D10 | Bridge ID field in Job Complete | `proxyId` (Bridge events article) vs `accessoryId` (job-specific data) | Capture a real webhook |
| D11 | `product.type` for Bridge connection event | `1` in example, while Bridge-targeted event uses `2` | Capture |
| D12 | `jobResponse.opResult` shape | `{"result":0}` vs `0` | Capture |
| D13 | Scope `store-device-activity` | Required by igloohome `POST /devices/{id}/activity`; missing from igloohome scope list | **Resolved 2026-09-27 (E21, API):** granted to our client per `server-health` |
| D14 | iglooworks algoPIN scope names | List: `algopin-otp`, `algopin-duration`; guide example: `algopin-onetime`, `algopin-daily` | Only if on iglooworks |
| D15 | Required fields | Reference marks every body field "Optional"; errors show `accessName` required | Follow prose + error messages |
| D16 | `PUT /devices/{id}` | Only field `batteryLevel`; error "too high! It must be at least 100" contradicts itself | Do not use |
| D17 | Supported devices | igloohome list has RG1X and SK4X; iglooworks list does not | Model-specific |
| D18 | iglooworks `edit-pin-bridge-proxied-job` | Scope exists, but job type 3 is "Not Supported" | Assume unsupported |
| D19 | Webhook signature example | Signed-string example body differs from the request body shown | Use a real webhook as test vector |
| D20 | Docs domain | Share links point to `docs.igloodeveloper.co`, which did not connect (curl 000) on 2026-09-25; `docs.igloohome.co` works | Use `docs.igloohome.co` |
| D21 | Old docs host | Support article links to `igloocompany.stoplight.io`; iglooworks pages link to `igloohome.stoplight.io` | Treat Stoplight as legacy; current source is `docs.igloohome.co` |
| D22 | API version | "API V2" (supported-devices pages) vs `/v1` in `llms.txt` base URL vs `/v2` in iglooworks guides; igloohome reference paths carry no version | E2 (added in 11-research-synthesis.md) |
| D23 | `GET /jobs/{jobId}` `jobStatus` meaning | Stoplight: 0 completed / 1 pending / 2 expired; webhook docs: 0 success / 1 generic failure / 2 in progress | **Resolved 2026-09-26 (EXP-20260926-01):** polled value = job state (observed 1 → 0), webhook value = job result (0). `2` not observed |
| D24 | `doorOpen` type and meaning | Docs: boolean (true = door open). API (EXP-20260926-01): number `1` in 3 of 3 runs; `lockOpen` is a boolean as documented | **E8b blocked:** lock not mounted on a door (bench). `doorOpen` stayed `1` locked and unlocked. Retest after installation; code accepts both types |
| D25 | Duplicate custom PIN (job 4) | Docs: webhook `jobStatus 9`. API (EXP-20260926-03): **synchronous HTTP 406** "PIN … is already taken", no job | Resolved: handle 406 at POST |
| D26 | Webhook re-delivery | Docs: nothing on retries/dedupe. API: after a Bridge reconnect the same log arrives again with a **new event id** | Feed de-duplicates by content; event-id dedupe alone is not enough |
| D24 | Proxied-job scope | Per job type vs Stoplight 403 text `igloohomeapi/bridge-proxied-job` | E7/E12 |
| D25 | Custom PIN types via Bridge | 1/2/4 vs Stoplight "(duration)" only | E12 with pinType 4 |
| D26 | ekey `keyId` type | number vs string | Store as string |
| D27 | `lockStatus` casing | `locked` (iglooworks) vs `LOCKED`/`UNLOCKED` (Stoplight) | Normalise |
| D28 | Webhook portal URL | `web.igloohome.co/api/api-access` vs `access.igloocompany.co/webhooks` | **Resolved (user, 2026-09-25):** portal is `web.igloohome.co/api`; register webhooks there |

**Narrowed by Stoplight (see `12-stoplight-comparison.md`):** D1 (two official sources name `api.igloodeveloper.co/igloohome`), D13 (`store-device-activity` used in official SDK doc), D15 (required algoPIN fields), U7 (hour-aligned dates required), U2 (`sort` = `asc`/`desc`), U3 (`lockStatus` on igloohome for Bridge-linked locks). Still verify via E2/E3/E10.

## 3. Unknowns requiring experiments (NF / HYP)

| # | Unknown | Experiment (see 10-experiments-plan.md) |
|---|---|---|
| U1 | Real response schemas for devices, properties, activity | E1–E4 — **Resolved (API) for devices/properties/server-health** |
| U2 | `type`, `sort`, `search`, `expand` query values | E3 |
| U3 | Does the igloohome API return `linkedAccessories`, `lockStatus`? | E3 — **Resolved (API): `lockStatus` yes (uppercase, Bridge-linked lock types); no `linkedAccessories`** |
| U4 | Job TTL (`expiryDate`) and behaviour when the lock is out of Bridge range | E7, E8 |
| U5 | Webhook delivery: retries, latency, ordering, duplicates | E6–E8 |
| U6 | igloohome algoPIN idempotency (same inputs → same PIN?) | E10 |
| U7 | algoPIN date granularity (hour-aligned required?) | E10 |
| U8 | Whether deleting a PIN consumes a blacklist slot (199 rule) | Ask support |
| U9 | Is `batteryLevel` in device list refreshed by Bridge job 9? | E7 then E3 |
| U10 | iglooKey guest UX, device support, Bridge dependency | E13 |
| U11 | Rate limits beyond Bridge-targeted jobs | Observe headers during E1–E4; do not load-test |
| U12 | Definition of billable "active lock" | Ask sales/support |
| U13 | Real-time entry events without Bridge | None documented — confirm with support |
| U14 | Whether a token can be restricted to specific devices/properties | Ask support |
| U15 | Behaviour on `startDate` in the past for algoPIN | E10 |
| U16 | Offline Bridge: are jobs rejected (406) or queued? | Docs say 406 rejects; confirm |
| U18 | `GET /devices/{id}/activity` returns 403 plain-text `Forbidden` although the token has `igloohomeapi/get-device-activity` (API, EXP-20260925-01) | Ask igloohome support (scope name? TRIAL tier? client setting?); retried after app notifications re-enabled → still 403 (not related) |
| U19 | EK2X keypad prefix is not in the supported-devices table but appears in `support-pins` | Ask support; treat as algoPIN-capable per API |
| U20 | Can Bridge jobs (battery/status) target the SW1X switch (typed `Lock`)? | E7/E8 on switch only after doorlock succeeds and user approves |
| U17 | What `admin_key`, `lock_id` query params on `GET /devices/{id}` do | Do not test (possible secret exposure) |

## 4. Unsupported capabilities (documented as not supported)

- Edit custom PIN (job 3).
- Set max incorrect PIN attempts (job 14).
- Set master PIN (job 16).
- Revoke / re-enable Bluetooth guest key via Bridge (jobs 18, 19).
- Delete RFID card / fingerprint via Bridge (jobs 24, 29).
- algoPIN on OE1X, SP3X, SW1X.
- Reading G3 admin keys.

## 5. Not found anywhere (NF)

- REST pairing/linking/unpairing, property creation, device transfer.
- Changelog, versioning or deprecation policy.
- Sandbox environment.
- SLA, uptime, status page.
- Webhook retry policy.
- MCP server: `llms.txt` headline says "REST API, 4 SDKs and an MCP server", but no MCP documentation page exists in the corpus or sitemap.
- "4 SDKs": docs cover igloohome BLE SDK and iglooworks BLE SDK, each Android + iOS (= 4 packages). HYP.
