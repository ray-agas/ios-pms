# Devices and Bridge

Research date: 2026-09-25. Evidence labels: see [README](README.md#evidence-labels).

## 1. Device model

### Device ID (DOC)

`deviceId` = the device's Bluetooth name, 12 characters: `[PREFIX 4][BATCH 2][UNIQUE 6]`, e.g. `IGB403fe3b9d` (Deadbolt 2S, batch 03). The prefix identifies the model. Exception in the docs: `IGB4A` (Deadbolt 2E) is a 5-character prefix.

Some examples in the iglooworks reference use a different shape (`IGH-LK-3F9A21`, `IGH-BR-7C2E19`) and the SDK docs use `IGM4-XXXX` placeholders. Treat those as illustrative, not as a second ID format (HYP).

There is also an internal `id` (e.g. `2rqQx4Riasw3Rs6db01`, Mongo-style ObjectIds on iglooworks). Paths use `deviceId` on igloohome; iglooworks paths use `{id}` and it is not stated whether that means `deviceId` or internal `id` (DOC-PARTIAL).

### Device categories (DOC)

`Lock`, `Keypad`, `Bridge`, `Fob`.

### Supported devices on API V2 (DOC, "Last updated: July 16, 2025")

| Prefix | Device | algoPIN | Keycard (SDK list) |
|---|---|---|---|
| DBX1 / DBX2 | Deadbolt Go | Yes | |
| IGB4 | Deadbolt 2S Metal Grey | Yes | |
| IGB4A | Deadbolt 2E | Yes | |
| IGK3 | Keybox 3 | Yes | |
| IGM3 | Mortise 2 | Yes | Yes |
| IGM4 | Mortise 2+ | Yes | Yes |
| IGP1 | Padlock | Yes | |
| IGR1 | Rim Lock for Metal Gates | Yes | Yes (IGR) |
| ML5X | Smart Lever Mortise | Yes | Yes (ML5) |
| MP1F | Push-Pull Mortise | Yes | Yes |
| MT1X | Mortise Touch | Yes | |
| OE1X | Retrofit Lock | **No** | |
| RG1X | Glass Door Lock (home list only) | Yes | Yes (RG1) |
| RM2F | Gate Lock with Fingerprint | Yes | |
| RM2X | Gate Lock | Yes | |
| RW1X | Rim Lock for Wooden Doors | Yes | Yes (RW1) |
| SK3E | Keybox 3E | Yes | |
| SK4X | Keybox 4 (home list only) | Yes | |
| SP1E / SP2E / SP2X | Padlock E / 2E / 2 | Yes | |
| SP3X | Padlock 3 | **No** | |
| SW1X | Switch | **No** | |
| EB1X | **Bridge** | No | |
| EK1X | Keypad | Yes | |
| IEF1 | Key Fob | No | |

Keycard list also names `IWS` (not in the supported-device table). Fingerprint: RM2F by name; SDK example uses IGM4. Per-model support for **Bridge jobs, iglooKey, passage algoPIN, custom PIN length, and PIN storage capacity is not published** (NF).

### Protocol generations

G2 and G3 exist (DOC, SDK pairing + iglooworks admin-key). G3 uses certificate-based pairing; G2 admin key is retrievable (iglooworks W10), G3 admin key is "encrypted server-side and not readable". Which models are G2 vs G3: NF.

## 2. Device data available via REST

| Field | Source | Live or cached | Evidence |
|---|---|---|---|
| `deviceId`, `deviceName`, `type`, `pairedAt` | H10/H12, W8 | Server record | DOC |
| `homeId[]` (igloohome) / `properties[]` (iglooworks) | H10, W8 | Server record | DOC |
| `batteryLevel` | H10/H12, W8 | **Cached** — updated when app/SDK syncs or Bridge job 9 runs (HYP) | DOC-PARTIAL |
| `lastSync` | H12, W8 | Cached | DOC |
| `lockStatus` (`"locked"`) | W8 (iglooworks only) | Cached, update mechanism NF | DOC-PARTIAL |
| `linkedDevices[]` | H10, W8 | Server record | DOC |
| `linkedAccessories[]` incl. Bridge | W8 | Server record | DOC |
| Live battery | Bridge job 9 webhook `batteryLevel` 0–100 | **Live** | DOC |
| Live `lockOpen`, `doorOpen` | Bridge job 10 webhook | **Live** | DOC |

`doorOpen` requires a door sensor; which models have one: NF.

## 3. Bridge (EB1X)

### What the Bridge is (DOC)

Wi-Fi hub. "Your server queues a job … against the Bridge, and the Bridge executes it against the device [over Bluetooth] and reports status back via webhook." Transport to the Bridge is MQTT (DOC, SDK `setWifiConfig` sends "WiFi credentials + MQTT broker config").

### Bridge investigation — answers

| Question | Answer | Evidence |
|---|---|---|
| Discover Bridges? | Yes, indirectly: `GET /devices` returns all devices including type `Bridge`; `type` query filter exists but values are undocumented. No dedicated `/bridges` list. | DOC-PARTIAL |
| List devices connected to a Bridge? | **No dedicated endpoint.** Relationship is visible from the lock side (`linkedAccessories` with `type:"Bridge"` on iglooworks; `linkedDevices` on igloohome). Bridge-targeted status job returns `locksCurrentAdded`, `locksMaxCapacity`, `lockRssiList` — counts and RSSI, **not IDs**. | DOC-PARTIAL |
| Add / register / pair / link devices via API? | **No REST endpoint.** Linking a lock to a Bridge is done with the BLE SDK `link()` (dispatched as a server job for EB1) or the igloohome app. Pairing a lock is BLE `pair()`. algoPIN docs require locks "paired using the igloohome app". | DOC (SDK), NF (REST) |
| Manage devices through a Bridge? | Yes, limited to 7 proxied job types: lock (1), unlock (2), create custom PIN (4), delete PIN (5), battery (9), status (10), activity logs (15). | DOC |
| Unsupported through a Bridge | Edit PIN (3), max wrong-PIN attempts (14), set master PIN (16), revoke/re-enable Bluetooth guest key (18/19), delete RFID card (24), delete fingerprint (29). | DOC |
| Remote operations asynchronous? | Yes. `POST` returns `{jobId}`; result via webhook type 3 or `GET /jobs/{jobId}`. | DOC |
| Job-status retrieval | igloohome `GET /jobs/{jobId}` → `completed`, `expiryDate`, `jobResponse.jobStatus`, `jobResponse.opResult`, `jobType`. iglooworks `GET /bridge/jobs/{jobId}`. | DOC |
| Job expiry | Jobs carry `expiryDate`. TTL not documented; the only example is `2025-01-01T00:02:00Z` (would be ~2 min if created at midnight — HYP). | DOC-PARTIAL |
| Bridge availability | (a) `406 Unable to contact bridge as it appears to be offline` on job creation; (b) webhook type 10 `isOnline: true/false`; (c) targeted status job → Wi-Fi status (0 connected, 2 disconnected/SSID not found/bad password, 5 no internet), SSID, IP, DNS, channel, band, RSSI. | DOC |
| Offline / unreachable **lock** behind an online Bridge | Not documented. HYP: job accepted (200), then Job Complete with `jobStatus: 1` (generic failure) or job expires. Must test. | NF |
| Multiple Bridges per account | Supported implicitly: job path takes an explicit `bridgeId`. Whether one lock can be linked to more than one Bridge: NF. Capacity per Bridge given by `locksMaxCapacity` (value NF). | DOC-PARTIAL |
| Which Bridge to use for a lock | Caller must supply `bridgeId`. Take it from the lock's `linkedAccessories` / `linkedDevices`. Sending the wrong Bridge: `404 Bridge or Device Not Found` or failure — NF. | HYP |
| Transfer Bridge / device between accounts | No API. SDK troubleshooting: `DevicePairedException` → "factory reset if transferring". Unpair removes all credentials. | DOC (SDK), NF (API) |
| Bridge firmware | EB1 DFU runs as a cloud job created by the SDK (`checkFirmwareUpdate`/`performDfu`), polled every 3 s. No REST endpoint documented. | DOC (SDK) |
| Rate limits | Bridge-targeted job: 1 per 5 min (`429` + `Retry-After`). Proxied jobs: none in the API reference; `jobStatus: 2` = "another operation is in progress" on device. igloohome support pages (Make section): the Bridge "currently handles 2 jobs per minute"; Bridge jobs time out after 2 min. Not enforced with a 429 in our data (research 13 §3a) | DOC (support) · API |
| Does a Bridge enable every operation? | **No.** See unsupported list above. Credentials of type keycard/fingerprint/ekey cannot be managed through the Bridge. | DOC |

### Bridge-targeted status response (DOC, webhook)

```json
{"payload":{"event":{"id":"string","type":3,"data":{
  "jobId":"string","jobStatus":0,
  "wifiNetworkStatus":0,"wifiNetworkSsid":"string","wifiNetworkIpaddr":"string",
  "wifiNetworkDns":"string","wifiNetworkChannel":0,"wifiNetworkBand":0,"wifiNetworkRssi":0,
  "lockRssiList":[0],"locksMaxCapacity":0,"locksCurrentAdded":0},
  "date":"ISODATE","proxyTransportMethod":0},
 "product":{"id":"string","type":2}}}
```

Note `proxyTransportMethod: 0` and `product.type: 2` here, vs `2` and `1` on lock jobs. (DOC)

## 4. Onboarding and ownership lifecycle (documented path)

All steps require a phone near the device (igloohome app or private BLE SDK):

1. `scanDevice()` → find unpaired lock.
2. `pair(deviceId, name, propertyIds)` → registers on account; properties must share a timezone. Missing property timezone later causes `409 timezone is not found on property` on many endpoints.
3. `calibrate()` → motor direction.
4. `sync()` → set clock, battery.
5. Bridge: `setWifiConfig()` with Bridge admin key → provisions Wi-Fi + MQTT; SDK polls until `isProvisioned && isOnline`.
6. `link(accessoryDeviceId = EB1…, lockDeviceId)` → Bridge-to-lock link (server job; fails if Bridge offline).
7. Removal: `unlink()` all accessories, then `unpair()`; unpair **removes all PINs, keycards, fingerprints**.

Implication (HYP): the dashboard can **display** onboarding state but cannot **perform** onboarding. A field-ops mobile step is unavoidable.

## 5. Activity logs

Three ways logs reach us (DOC):
1. `GET /devices/{id}/activity` — server history (translated `activityType`, `description`, `locale`).
2. Bridge job 15 → lock uploads logs, **then deletes them from the lock**.
3. Webhook type 5 "Activity Log Received" — raw lock log objects: `logType`, `entryDate` (epoch s), `keyId`, `operationId`, plus `pin`, `newPin`, `pinType`, `value1–5`, `time1–2` depending on type.

Log types relevant to hospitality (DOC): 16 wrong PIN (includes attempted PIN), 18 master PIN unlock, 19–26 PIN use (first-use per type), 27–31 PIN create/change/delete, 42–44 key card add/unlock/delete, 47–52 auto-relock / manual / key / thumbturn, **53 attempted break-in**, 54–57 fingerprint and invalid card, 77 passage mode (iglooworks list), 93 DPI (undefined acronym).

Security note: raw logs contain **PIN values**, including wrong attempts. Must be redacted before display or storage (CLAUDE.md §7).

## 6. Open questions

1. Real `type` filter values for `GET /devices` (e.g. `Bridge`, `Lock`)?
2. Does the igloohome API expose `linkedAccessories`, or only `linkedDevices`?
3. Job TTL and behaviour when the lock is out of Bridge BLE range.
4. `locksMaxCapacity` value for EB1X.
5. Whether `batteryLevel` on `GET /devices` is updated by Bridge job 9.
6. Whether `lockStatus` exists on igloohome API responses.
