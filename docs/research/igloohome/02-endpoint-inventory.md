# Endpoint Inventory

Research date: 2026-09-25. Evidence labels: see [README](README.md#evidence-labels).

## Read this first

- **No request or response example in this file has been verified.** Every example below is the vendor's documentation example, reproduced so we can compare it against real responses later. Mark an entry `API` only after an authenticated call confirms it.
- Documentation lists every body field as "Optional" in the generated reference tables, even where the prose or error examples show the field is required (e.g. `accessName` → `400 'accessName' is required`). Treat the "Optional" column as **unreliable**. (DOC-CONFLICT)
- Common headers (DOC): `Authorization: Bearer {access_token}`, `Accept: application/json`, `Content-Type: application/json`. iglooworks explicitly returns 415 when `Content-Type` is missing, even on `DELETE`.
- Common errors on almost every igloohome endpoint (DOC): `401` invalid/expired token, `402 {"error":"30 days igloohome API trial has ended"}`, `403` missing scope, `500`. iglooworks adds `402 {"error":"account.payment.is.suspended"}`.
- Risk levels used here: **R0** read-only, no device contact · **R1** read-only but contacts a device through the Bridge (wakes lock, uses battery, rate-limited) · **R2** creates or removes access or data without physical actuation · **R3** physical actuation or irreversible credential destruction · **R-SENS** returns secret material (PIN, key).
- Operation counts: igloohome API reference = 27 operations (H4–H30). H1–H3 are OAuth flows documented in the Getting Started guides, not in the reference. iglooworks API reference = 30 operations (W1–W28, W7b, W7c).

## Base URLs (unresolved — DOC-CONFLICT)

| Candidate | Where documented | Unauthenticated GET probe (2026-09-25) |
|---|---|---|
| `https://api.igloodeveloper.co/v1` | `llms.txt` header | `GET /v1/server-health` → `403 {"message":"Forbidden"}` (API Gateway style "no route") |
| `https://api.igloodeveloper.co/igloohome` | Getting Started guide, algoPIN guide | `GET /igloohome/server-health` → `401 Unauthorized`; `/igloohome/devices` → `401` |
| `https://api.igloohome.co/home` | Every generated API reference example | `GET /home/server-health` → `401 Unauthorized` |
| `https://api.iglooworks.co/v2` | iglooworks guides | `GET /v2/devices` → `401 Unauthorized` |
| `https://api.igloohome.co/works` | Every generated iglooworks reference example | `GET /works/account` → `500 {"message":"Internal server error"}` |

**Update (Stoplight OpenAPI, DOC):** the official Stoplight spec declares `servers: https://api.igloodeveloper.co/igloohome`. Two official sources + PROBE + third-party now agree. See `12-stoplight-comparison.md` §3.1.

PROBE interpretation (HYP): both `api.igloodeveloper.co/igloohome` and `api.igloohome.co/home` have live, auth-protected routes. `/v1` appears not to exist as a route. The third-party Home Assistant library uses `https://api.igloodeveloper.co/igloohome` in production (3P). **Paths below are relative to whichever base is confirmed.**

---

## A. igloohome API

### A1. Authentication

| # | Operation | Method & path | Auth / scope | Body | Documented success | Documented errors | Risk | Test? |
|---|---|---|---|---|---|---|---|---|
| H1 | Get access token (client credentials) | `POST https://auth.igloohome.co/oauth2/token` | `Authorization: Basic base64(client_id:client_secret)`, `Content-Type: application/x-www-form-urlencoded` | `grant_type=client_credentials`, optional `scope` (space-separated; omitted = all) | `{"access_token","expires_in":86400,"token_type":"Bearer"}` | `invalid_request`, `invalid_client`, `invalid_scope` | R0 | Yes, first test |
| H2 | Authorization code exchange (iglooconnect) | `POST https://auth.igloohome.co/oauth2/token` | Basic auth | `grant_type=authorization_code`, `client_id`, `code`, `redirect_uri` | adds `id_token`, `refresh_token` (365 days) | adds `invalid_grant` | R0 | Only with partner account |
| H3 | Refresh token (iglooconnect) | same | Basic auth | `grant_type=refresh_token`, `client_id`, `refresh_token` | new `access_token` | as above | R0 | Partner only |
| H4 | Get or refresh access token (REST wrapper) | `POST /token` | none stated | JSON: `clientId`, `clientSecret`, `code`, `grantType`, `redirectUri`, `refreshToken`, `scope` | `{"access_token","expires_in":3600,"refresh_token","token_type"}` | `400 {"error":"invalid_client"}`; `500` for any Cognito error outside `invalid_request`/`invalid_client`/`invalid_grant` (e.g. `unauthorized_client`) | R0 | Yes |
| H5 | Revoke refresh token | `POST /token/revoke` | "Unauthenticated" | `clientId`, `clientSecret`, `refreshToken` | `200` | `400`, `500` | R2 (kills partner session) | Partner only |

Status: H1–H3 DOC. H4–H5 DOC-PARTIAL (reference only; relationship to H1 unclear; example shows `expires_in: 3600` vs. guide `86400`). Backend is AWS Cognito (DOC: "Revokes … via Cognito").

### A2. Server health / connection status

| # | Operation | Method & path | Scope | Documented success | Errors | Risk | Test? |
|---|---|---|---|---|---|---|---|
| H6 | Get server / OAuth client health | `GET /server-health` | any valid token (none stated) | `{"clientId","clientName","endsAt","flow":"client_credentials","isAdminLogin":false,"scopes":[…],"status":"active","tier":"paid","userRef"}` | `403` "user has revoked access, or their account was removed" | R0 | **Yes — best first call** |

Value: tells us token flow, granted scopes, subscription tier, and subscription end date in one call. DOC-PARTIAL (enum values for `tier`, `status` not documented).

### A3. Properties

| # | Operation | Method & path | Scope | Query | Documented success | Errors | Risk | Test? |
|---|---|---|---|---|---|---|---|---|
| H7 | List properties | `GET /properties` | `igloohomeapi/get-properties` | `limit` (1–300), `cursor`, `sort` | `{"nextCursor","payload":[{"id","name","timezone"}]}` | `400 'limit' must be between 1 to 300 inclusive` | R0 | Yes |
| H8 | Get property | `GET /properties/{propertyId}` | same | — | `{"payload":{"id","name","timezone"}}` | `404 Property Not Found` | R0 | Yes |
| H9 | List devices in property | `GET /properties/{propertyId}/devices` | `igloohomeapi/get-devices` | `cursor`, `limit`, `sort`, `type`, `search`, `expand` | same shape as H10 | `400` | R0 | Yes |

No create/update/delete property endpoint exists. (NF) Properties are created in the igloohome app. (HYP)

### A4. Devices

| # | Operation | Method & path | Scope | Params / body | Documented success | Errors | Risk | Test? |
|---|---|---|---|---|---|---|---|---|
| H10 | List devices | `GET /devices` | `igloohomeapi/get-devices` | query `limit`, `cursor`, `sort`, `type`, `search`, `expand` | `{"nextCursor","payload":[{"batteryLevel","deviceId","deviceName","homeId":[…],"linkedDevices":[{"deviceId","type"}],"pairedAt","type"}]}` | `400 'cursor' cannot be empty string` | R0 | Yes |
| H11 | List devices supporting algoPIN | `GET /devices/support-pins` | `igloohomeapi/get-devices` | same as H10 | same, plus `id` | `400 'limit' must be between 1 to 300` | R0 | Yes |
| H12 | Get device details | `GET /devices/{deviceId}` | `igloohomeapi/get-devices` | query `admin_key`, `lock_id`, `expand` (undocumented meaning) | adds `lastSync`, `id` | `404 not found device`, `409 timezone is not found on property` | R0 | Yes |
| H13 | Configure device details | `PUT /devices/{deviceId}` | `igloohomeapi/update-device` | body `batteryLevel` (string?) | `{"message":"Successfully"}` | `400 "The BatteryLevel is too high! It must be at least 100"` (message self-contradictory) | R2 (overwrites server-side battery value) | **No** until purpose is clear |
| H14 | Get device activity logs | `GET /devices/{deviceId}/activity` | `igloohomeapi/get-device-activity` | `startDate`, `endDate`, `locale`, `limit`, `cursor`, `sort` | `{"nextCursor","payload":[{"activityTimeAt","activityType":"UNLOCK","description":"Unlocked by keypad PIN"}]}` | `400`, `404 not found device/property`, `409` | R0 | Yes |
| H15 | Push device activity logs | `POST /devices/{deviceId}/activity` | `igloohomeapi/store-device-activity` (**not in published scope list**) | `logsPayload` array (item schema NF) | `{"message":"Successfully."}` | `400 "logsPayload" is required` | R2 (writes server audit data) | **No** — intended for BLE SDK sync |
| H16 | Get master PIN | `GET /devices/{deviceId}/masterpin` | `igloohomeapi/get-master-pin` | — | `{"pin":"49667198"}` | `404`, `409` | **R-SENS** | Only with explicit approval; never log value |

`type` filter values, `sort` values, `search` semantics, and `expand` values are **not documented** (DOC-PARTIAL). Response field `type` observed values in examples: `Lock`, `Keypad`. `batteryLevel` is the **last value synced to the server**, not live (HYP, supported by SDK docs describing `sync()` pushing battery to server).

### A5. algoPIN (no Bridge required)

All five share: path param `deviceId`; body `accessName`, `startDate`, `variance`, plus type-specific fields; success `{"pin":"7541869","pinId":"EE4421C77G9F512D"}`; errors `400 'accessName' is required`, `404 not found device`, `409 timezone is not found on property`, `418 this device type does not support the feature.`

| # | Operation | Method & path | Scope | Extra body | Variance range | Risk | Test? |
|---|---|---|---|---|---|---|---|
| H17 | One-time algoPIN | `POST /devices/{deviceId}/algopin/onetime` | `igloohomeapi/algopin-onetime` | — | 1–5 | R2 | Yes (test lock) |
| H18 | Permanent algoPIN | `POST /devices/{deviceId}/algopin/permanent` | `igloohomeapi/algopin-permanent` | — | 1–5 | R2 (hard to revoke) | Caution |
| H19 | Hourly duration algoPIN | `POST /devices/{deviceId}/algopin/hourly` | `igloohomeapi/algopin-hourly` | `endDate` (1–672 h) | 1–3 | R2 | Yes |
| H20 | Daily duration algoPIN | `POST /devices/{deviceId}/algopin/daily` | `igloohomeapi/algopin-daily` | `endDate` (29–367 days) | 1–3 | R2 | Yes |
| H21 | Passage algoPIN | `POST /devices/{deviceId}/algopin/passage` | **none listed** | `durationHours` | NF | **R3** (keeps lock unlocked for the duration) | Only newer firmware; test last |

Date format for algoPIN (DOC, Stoplight schema): `YYYY-MM-DDThh:00:00+hh:mm` — **minutes and seconds must be `00`**. Required fields: `variance`, `startDate`, `accessName` (+ `endDate` for hourly/daily). `accessName` ≤ 60 chars. One-time/permanent `startDate` ≥ start of current hour; hourly/daily `startDate` ≤ 1 h in the past. Daily: whole days, start hour = end hour. Full rule table: `12-stoplight-comparison.md` §3.2.

### A6. Bluetooth guest key (ekey)

| # | Operation | Method & path | Scope | Body | Documented success | Errors | Risk | Test? |
|---|---|---|---|---|---|---|---|---|
| H22 | Generate Bluetooth guest key | `POST /devices/{deviceId}/ekey` | `igloohomeapi/create-ekey-access` | `startDate`, `endDate`, `permissions` (format NF) | `{"bluetoothGuestKey":"<base64>","keyId":12847}` | `400 "configuration lock issue"`, `409 "invalid.generate.ekey"` (plain text) | **R-SENS** / R2 | Yes, with a mobile BLE client only |

The returned key is the `key` argument the BLE SDK needs for `lock`, `unlock`, `sync`, `createPin`, etc. (DOC, SDK pages). Permission names appearing in SDK docs: `LOCK`, `UNLOCK`, `CREATE_PIN`, `DELETE_PIN`, `GET_TIME`, `SET_TIME`, `GET_BATTERY_LEVEL`, `GET_LOGS`, `ADD_CARD`, `DELETE_CARD`, `ADD_FINGERPRINT`, `DELETE_FINGERPRINT_UID`, `CALIBRATE`, `SET_BRIGHTNESS`, `GET_FIRMWARE_VERSION`, `ENABLE_DFU`, `ADD_LOCK`, `DELETE_LOCK`. Stoplight (DOC) defines REST `permissions` as an array of `UNLOCK`, `LOCK`, `GET_TIME`, `SET_TIME`, `GET_LOGS`, `GET_BATTERY_LEVEL`, default `['UNLOCK','LOCK']`; `keyId` typed string. No REST endpoint to revoke an igloohome ekey was found (NF); Bridge job types 18/19 (revoke/re-enable guest key) are listed **Not Supported**.

### A7. iglooKey tokens ("Smart Link")

Shared body: `deviceIds`, `startsAt`, `endsAt`, `label`, `activationWindowSeconds`, `offlineAccessSeconds`. No scope named for any of these (DOC-PARTIAL).

| # | Operation | Method & path | Documented success | Errors | Risk | Test? |
|---|---|---|---|---|---|---|
| H23 | Create iglooKey token (hybrid) | `POST /pass` | `201 {"id":"lnk_…","shareableUrl":"https://igloodev.app.link/pass?token=lnk_…","type":"TOKEN_TYPE_HYBRID","startsAt","endsAt","activationDeadline","createdAt"}` | `400 "endsAt" must be in the future`, `422 {message:'device type not supported for iglooKey', excludedIds:[…]}`, `502`, `503` | R2 | Yes (needs guest phone) |
| H24 | Create iglooKey token (offline-capable) | `POST /pass/offline` | same | same | R2 | Yes |
| H25 | Create iglooKey token (online-only) | `POST /pass/online` | same; `offlineAccessSeconds` rejected | same | R2 | Yes |
| H26 | Update iglooKey validity | `PATCH /pass/{id}` | `200` with new `startsAt`/`endsAt`/`activationDeadline` | `503 failed to update iglooKey token` | R2 | Yes |
| H27 | Revoke iglooKey token | `DELETE /pass/{id}` | `204` | `502`/`503 failed to revoke iglooKey token` | R2 | Yes |

iglooKey is the **only igloohome-API credential with a documented update and revoke** endpoint. Which devices support it: NF (only 422 behaviour documented). What the guest does with `shareableUrl` (igloohome app deep link? web?): NF (HYP: Branch.io deep link into the igloohome app, based on `app.link` domain).

### A8. Bridge jobs

| # | Operation | Method & path | Scope | Body | Documented success | Errors | Risk | Test? |
|---|---|---|---|---|---|---|---|---|
| H28 | Create Bridge **proxied** job (targets a lock via Bridge) | `POST /devices/{deviceId}/jobs/bridges/{bridgeId}` | depends on `jobType` (table below) | `jobType` (number), `jobData` (object) | `200 {"jobId":"6345191a82bcfc12a921bdb6"}` | `400 job type not supported`, `404 Bridge or Device Not Found`, `406 Unable to contact bridge as it appears to be offline` | per job | See below |
| H29 | Create Bridge **targeted** job (targets the Bridge itself) | `POST /devices/{bridgeId}/jobs` | `igloohomeapi/get-device-status-bridge-proxied-job` | `{"jobType":10}` | `200 {"jobId"}` | `406` offline, **`429 Too many requests. Please try again after N seconds.` + `Retry-After` header; max 1 request / 5 min** | R1 | Yes |
| H30 | Get job status | `GET /jobs/{jobId}` | `igloohomeapi/get-job-status` | — | `{"completed":true,"expiryDate","jobId","jobResponse":{"jobStatus":0,"opResult":{"result":0}},"jobType":"UNLOCK"}` | `404`, `422 'jobId' is not a valid MongoDB ObjectId` | R0 | Yes |

**D23 (open, high impact):** Stoplight defines `jobResponse.jobStatus` in `GET /jobs/{jobId}` as `0 (completed)`, `1 (pending)`, `2 (expired)`, while webhook docs use 0 success / 1 generic failure / 2 operation in progress. Do not interpret polled `jobStatus` until E7 records real values. Stoplight also lists 406 `"Lock is not linked to bridge"` and `"New PIN is already taken. Please try a different pin"` for proxied jobs.

Proxied job types (DOC, `bridge-jobs-proxied`):

| ID | Job | Supported | Scope (from scope table) | `jobData` | Side effects | Risk |
|---|---|---|---|---|---|---|
| 1 | Lock | Yes | `lock-bridge-proxied-job` | optional `lockTime` (ISO) | Physically locks; **sets lock clock** if `lockTime` sent | R3 |
| 2 | Unlock | Yes | `unlock-bridge-proxied-job` | optional `lockTime` | Physically unlocks; sets clock | R3 |
| 3 | Edit custom PIN | **No** | — | — | — | — |
| 4 | Create custom PIN | Yes | `create-pin-bridge-proxied-job` | `accessName`, `pin` (4–6 digits), `pinType` (1 one-time / 2 permanent / 4 duration), `startDate`, `endDate` (duration) | Writes PIN to lock storage (199-slot limit) | R2 |
| 5 | Delete PIN | Yes | `delete-pin-bridge-proxied-job` | `pin` | Removes PIN; "Unactivated algoPINs can only be deleted within one week of their start time" | R2 (irreversible for algoPIN) |
| 9 | Get battery level | Yes | `get-battery-level-bridge-proxied-job` | — | Wakes lock | R1 |
| 10 | Get device status | Yes | `get-device-status-bridge-proxied-job` | — | Wakes lock; returns `lockOpen`, `doorOpen` | R1 |
| 14 | Set max incorrect PIN attempts | No | — | — | — | — |
| 15 | Get activity logs | Yes | `get-activity-logs-bridge-proxied-job` | optional `lockTime` | **"Activity logs are deleted from the lock after retrieval."** Sets clock. | R2 (destructive read) |
| 16 | Set master PIN | No | — | — | — | — |
| 18 | Revoke Bluetooth guest key | No | — | — | — | — |
| 19 | Re-enable revoked guest key | No | — | — | — | — |
| 24 | Delete RFID card by UID | No | — | — | — | — |
| 29 | Delete fingerprint by UID | No | — | — | — | — |

Proxied-job validation errors (DOC): `<field> is required`, `<field> is invalid`, `can only contain digits 0 to 9`, `length must be 4 to 6 digits long`, `must be in format YYYY-MM-DDTHH:mm:ss+hh:mm`, `must be now or after`, `must be after 'startDate'`, `405 Method not allowed`.

---

## B. iglooworks API

Only relevant if our account is an iglooworks enterprise account (see [03-auth-and-accounts.md](03-auth-and-accounts.md)). Common iglooworks behaviour (DOC):
- `403` has two meanings: missing scope (no body), or OAuth client access revoked (`{error:"The user has revoked access for this application..."}`). **"Never returned on the API-key auth path, which does not check scope at all."**
- Many write endpoints accept `departmentId`; for "flat orgs" the account's only department is used. `409 department not found` / "lock is not associated with the given department".

| # | Operation | Method & path | Key params / body | Documented behaviour | Risk |
|---|---|---|---|---|---|
| W1 | Get account | `GET /account` | — | `{"payload":{"_id","companyId","companyName","isFlatOrg"}}` | R0 |
| W2 | List users | `GET /users` | — | Raw array (not `{payload}`), **no pagination**; `400 COMPANY_ID_MISSING` | R0 (PII) |
| W3 | List departments | `GET /departments` | `limit`, `cursor`, `sort` | `{"payload":[{"departmentName","id","propertyRef":[…]}]}` | R0 |
| W4 | Properties in department | `GET /departments/{departmentId}/properties` | pagination | Empty payload if none; `409` dept not found | R0 |
| W5 | Access records in department | `GET /departments/{id}/access` | pagination | same shape as W11 | R0 / R-SENS (contains `pin`) |
| W6 | Devices in department | `GET /departments/{id}/devices` | pagination | same shape as W8 | R0 |
| W7 | List properties | `GET /properties` | pagination | adds `totalLock` | R0 |
| W7b | Get property | `GET /properties/{id}` | — | `{"payload":{"id","name","timezone","totalLock"}}` | R0 |
| W7c | Devices in property | `GET /properties/{id}/devices` | pagination | same shape as W8 | R0 |
| W8 | List devices | `GET /devices` | `type`, `search`, `expand`, pagination | Adds **`lockStatus`**, `linkedAccessories:[{deviceId,id,name,type:"Bridge"}]`, `properties[]`, `lastSync` | R0 |
| W9 | Get device | `GET /devices/{id}` | — | as W8 item | R0 |
| W10 | Get G2 admin key | `GET /devices/{id}/admin-key` | — | Obfuscated blob requiring client-side decryption; G2 only (`400 unsupported.device.protocol` for G3) | **R-SENS** (full admin) |
| W11 | List access records for device | `GET /devices/{id}/access` | `accessType`, pagination | `[{accessType:"pin",bluetoothDeviceName,createdAt,startDateTime,endDateTime,id,isCustomPin,name,pin,pinType:"duration"}]` | R-SENS (returns PIN values) |
| W12 | Grant ekey access | `POST /devices/{id}/access/grant` | `recipientId`, `departmentRef`, `startDateTime`, `endDateTime`, `permissions`, `lang` | `201`; persists access + activity + audit trail; `422 NON_LOCK_DEVICE_NOT_ALLOWED`; `409 CONFIGURATION_LOCK_ISSUE / FAILED_GENERATE_EKEY`. If activity logging fails, still `201` with different body (no `code`) | R2 |
| W13 | Revoke ekey access for recipient | `POST /devices/{id}/access/revoke` | `recipientId` | Revokes **ALL** matching access records for the recipient and **permanently deletes key material**; `{"message","revokedCount"}`; `404 NO_ACTIVE_ACCESS` | R2/R3 (irreversible) |
| W14 | Delete/revoke PIN access | `DELETE /devices/{id}/access/{accessId}` | — | Creates **async delete job** → `{"jobId"}`; `404 access not found` | R2 |
| W15–W18 | algoPIN daily / hourly / onetime / permanent | `POST /devices/{id}/algopin/{type}` | `accessName`, `departmentId`, `startDate`, `endDate`, `variance` | **Idempotent: same lock+type+window+variance returns the same PIN, no new record.** Double-gated scope (broad algopin scope AND specific type scope). `endDate` required for daily/hourly, forbidden for permanent/onetime | R2 |
| W19 | Passage algoPIN | `POST /devices/{deviceId}/algopin/passage` | `accessName`, `durationHours`, `startDate`, `variance` | Same idempotency note | R3 |
| W20 | Generate Bluetooth guest ekey (no persistence) | `POST /devices/{id}/ekey` | `startDate`, `endDate`, `permissions` | Errors are **plain text**; `409 "failed.generate.ekey"` | R-SENS |
| W21 | List activity (translated) | `GET /devices/{id}/activity` | `startDate`, `endDate`, `locale`, pagination | Payload item schema `{}` (NF) | R0 |
| W22 | Push raw activity logs | `POST /devices/{id}/activity` | `logsPayload` | `{msg:"Successfully."}` or `{msg:"no.activities.on.lock"}` | R2 |
| W23 | Get Bridge proxied job status | `GET /bridge/jobs/{jobId}` | — | `{completed,expiryDate,jobId,jobResponse:{jobStatus,opResult},jobType:"CREATE_CUSTOM_PIN"}` | R0 |
| W24 | Create Bridge proxied job | `POST /devices/{deviceId}/jobs/bridges/{bridgeId}` | `jobType`, `jobData`, `departmentId` | `404` (type 5) no matching PIN for `jobData.accessId`; **`406` (type 4) pending job for same PIN exists or PIN already in use** | per job |
| W25 | List jobs for device | `GET /devices/{id}/jobs` | `jobType`, `status`, `departmentId`, pagination | `[{_id,accessData:{accessType,customPin,pinType,startDateTime,endDateTime},createdAt,description:"create_bluetooth_pin",status:"pending"}]` | R-SENS (contains PIN) |
| W26 | Create custom Bluetooth PIN (async job, **no Bridge**) | `POST /devices/{id}/jobs` | `customPin`, `pinType`, `startDateTime`, `endDateTime`, `description`, `departmentId` | Job stays `pending` until a phone with the SDK runs `syncJob()` near the lock (HYP from SDK `syncJob` docs) | R2 |
| W27 | Get job details | `GET /devices/{id}/jobs/{jobId}` | — | as W25 item | R-SENS |
| W28 | Update job status | `PATCH /devices/{id}/jobs/{jobId}` | `status`, `reason` | "Called by device/bridge sync flows"; `{payload:null}` if job gone | R2 — **do not call from dashboard** |

Note: W26 path (`POST /devices/{id}/jobs`) is the same path shape as igloohome H29 Bridge-targeted job (`POST /devices/{bridgeId}/jobs`) but a different product and meaning. (DOC)

---

## C. BLE SDK operations (mobile only, not REST)

Documented for Android (Kotlin, `co.igloo.home:sdk:3.5.0` / `co.igloo.works:sdk:2.3.0`) and iOS (Swift, `IgloohomeSDK` 3.5.0 / `IglooworksSDK`). Distributed through **private GitLab** registries requiring a GitLab personal access token (DOC). Not usable from a web dashboard.

| Operation | Purpose | Needs | Notes |
|---|---|---|---|
| `scanDevice()` | Find nearby locks; returns `deviceId`, `isPaired`, `isActive`, `rssi` | BLE | RSSI ~-70 = connectable |
| `pair(deviceId, name, propertyIds, token)` | Register lock on account | BLE, unpaired lock | All properties must share timezone; rollback on commit failure |
| `unpair(deviceId, token)` | Remove lock | BLE | Fails if accessories linked; **removes all PINs, cards, fingerprints** |
| `link` / `unlink` | Attach keypad (EK1/EK2), fob (IEF), Bridge (EB1) to a lock | BLE (keypad/fob) or server job (Bridge) | Bridge link throws `BridgeOfflineException` when offline |
| `setWifiConfig(bridgeId, adminKey, ssid, password, token)` | Provision Bridge Wi-Fi + MQTT | BLE | Polls server 15/30/45 s until `isProvisioned` & `isOnline` |
| `calibrate` | Motor direction / door settings | BLE | OE1 interactive; IGB4 needs direction |
| `lock` / `unlock` | Local BLE actuation | BLE, ekey with LOCK/UNLOCK | 15 s timeout |
| `sync` / `syncWithStatus` | Set clock, read battery, upload logs | BLE, 3 tokens | Pushes battery + logs to server (feeds H10/H14) |
| `syncJob` (works) | Execute pending server jobs on lock | BLE | Job types CREATE_PIN, DELETE_PIN, ADD_GROUP_KEY, DELETE_GROUP_KEY |
| `createPin` / `deletePin` | Custom PIN via BLE | BLE | PIN 1–12 digits (vs 4–6 via Bridge) |
| `addKeycard` / `deleteKeycard` | RFID card enrolment | BLE, physical card | 45 s window; IWS, IGM3, IGM4, IGR, RG1, MP1F, ML5, RW1 |
| `addFingerprint` / `deleteFingerprint` | Fingerprint enrolment | BLE, finger on sensor | 3 good reads, 60 s |
| `checkFirmwareUpdate` / `performDfu` | Firmware update | BLE (locks) or cloud job (EB1 Bridge) | Battery ≥ 20% (≥ 31% SP2X/SP2E) |

## D. Operations searched for and NOT found (NF)

- REST pairing, unpairing, linking, or unlinking of any device.
- Create/update/delete properties or rooms.
- List PINs / access records on the **igloohome** API (exists only on iglooworks W11).
- Revoke an igloohome Bluetooth ekey.
- Edit a custom PIN (job type 3 unsupported).
- Transfer a device or Bridge between accounts.
- Webhook subscription management via API (set in portal / by e-mail).
- List Bridges as a dedicated resource, or list locks attached to a Bridge as a dedicated endpoint.
- Keycard or fingerprint management via REST.
- Firmware status or update via REST.
- Published rate limits for anything other than Bridge-targeted jobs.
- API versioning / deprecation policy or changelog.
- Sandbox / test environment.
