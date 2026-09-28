# API Capability Matrix

Research date: 2026-09-25. Evidence labels: see [README](README.md#evidence-labels). Endpoint IDs (H#, W#) refer to [02-endpoint-inventory.md](02-endpoint-inventory.md).

Columns:
- **home** / **works**: available on igloohome API / iglooworks API.
- **Bridge**: whether a Bridge is required.
- **Evidence**: strongest evidence we have today. Nothing is `API` or `HW` yet.

## Account, auth, connection

| Capability | home | works | Bridge | Evidence | Endpoint |
|---|---|---|---|---|---|
| Server-to-server token (client credentials) | Yes | Yes | No | DOC | H1 |
| End-user delegated login (auth code, per-user consent) | Yes (iglooconnect, partners) | Yes (code flow, via BD) | No | DOC | H2, H3 |
| Scoped least-privilege tokens | Yes (18 scopes) | Yes (28 scopes) | No | DOC | H1 |
| Check connection, scopes, tier, subscription end | Yes | NF | No | DOC-PARTIAL | H6 |
| Account / company details | NF | Yes | No | DOC | W1 |
| List users | NF | Yes | No | DOC | W2 |
| Departments (org hierarchy) | NF | Yes | No | DOC | W3–W6 |

## Inventory and mapping

| Capability | home | works | Bridge | Evidence | Endpoint |
|---|---|---|---|---|---|
| List properties | Yes | Yes | No | DOC | H7, W7 |
| Create/edit property | NF | NF | — | NF | — |
| List devices (locks, keypads, bridges, fobs) | Yes | Yes | No | DOC | H10, W8 |
| Filter devices by type | Yes (values NF) | Yes (values NF) | No | DOC-PARTIAL | H10, W8 |
| List devices per property | Yes | Yes | No | DOC | H9, W7c |
| Lock ↔ accessory relationships | `linkedDevices` | `linkedDevices` + `linkedAccessories` | No | DOC-PARTIAL | H10, W8 |
| Devices that support algoPIN | Yes | NF | No | DOC | H11 |
| Pair / unpair lock | SDK / app only | SDK / app only | No | DOC (SDK), NF (REST) | — |
| Link / unlink accessory (incl. Bridge) | SDK / app only | SDK / app only | Bridge must be online | DOC (SDK), NF (REST) | — |

## Health and status

| Capability | home | works | Bridge | Evidence | Endpoint |
|---|---|---|---|---|---|
| Battery level (last synced, cached) | Yes | Yes | No | DOC | H10, H12, W8 |
| Battery level (live, from lock) | Yes | Yes | **Yes** | DOC | job 9 |
| Last sync time | Yes | Yes | No | DOC | H12, W8 |
| Lock state `lockStatus` (cached) | NF | Yes | No | DOC-PARTIAL | W8 |
| Lock open / door open (live) | Yes | Yes | **Yes** | DOC | job 10 |
| Bridge Wi-Fi status, SSID, RSSI, locks capacity | Yes | HYP (article is home-only) | **Yes** | DOC | H29 |
| Bridge online/offline push | Yes | Yes | **Yes** | DOC | webhook type 10 |
| Offline Bridge detection on request | Yes (`406`) | Yes (`406`) | Yes | DOC | H28, H29 |
| Firmware version / update | SDK only | SDK only | Bridge DFU via cloud job (SDK) | DOC (SDK) | — |

## Access credentials

| Capability | home | works | Bridge | Evidence | Endpoint |
|---|---|---|---|---|---|
| algoPIN one-time / permanent / hourly / daily | Yes | Yes | **No** | DOC | H17–H20, W15–W18 |
| algoPIN passage (lock held open) | Yes | Yes | No | DOC (newer firmware only) | H21, W19 |
| Custom PIN create (remote) | Yes | Yes | **Yes** | DOC | job 4 |
| Custom PIN create (queued, executed by phone BLE sync) | NF | Yes | No (phone) | DOC | W26 + SDK `syncJob` |
| Custom PIN edit | **No** (job 3 unsupported) | **No** | — | DOC | — |
| PIN delete (remote) | Yes | Yes | **Yes** | DOC | job 5, W14 |
| List active PINs / access on a lock | NF | Yes | No | DOC | W11, W5 |
| Master PIN read | Yes | Scope listed; endpoint NF in works reference | No | DOC / DOC-PARTIAL | H16 |
| Master PIN set | **No** (job 16 unsupported) | **No** | — | DOC | — |
| Bluetooth guest key (ekey) generate | Yes | Yes | No | DOC | H22, W20 |
| Bluetooth ekey grant with audit trail | NF | Yes | No | DOC | W12 |
| Bluetooth ekey revoke | NF (job 18 unsupported) | Yes (per recipient) | No | DOC | W13 |
| iglooKey smart-link token create / update / revoke | Yes | NF | NF | DOC-PARTIAL | H23–H27 |
| RFID keycard add/delete | SDK only | SDK only | No (phone at lock) | DOC (SDK) | — |
| Fingerprint add/delete | SDK only | SDK only | No (phone at lock) | DOC (SDK) | — |

## Remote actuation

| Capability | home | works | Bridge | Evidence | Endpoint |
|---|---|---|---|---|---|
| Remote lock | Yes | Yes | **Yes** | DOC | job 1 |
| Remote unlock | Yes | Yes | **Yes** | DOC | job 2 |
| Set lock clock | Yes (via `lockTime`) | Yes | Yes | DOC | jobs 1, 2, 15 |
| Set max wrong-PIN attempts | **No** | **No** | — | DOC | job 14 |

## Events and audit

| Capability | home | works | Bridge | Evidence | Endpoint |
|---|---|---|---|---|---|
| Activity log history (server, translated) | Yes | Yes | No (data arrives via app/SDK sync or Bridge) | DOC | H14, W21 |
| Pull logs from lock now | Yes | Yes | **Yes** (destructive read on lock) | DOC | job 15 |
| Activity log push webhook | Yes | Yes | **Yes** | DOC | webhook type 5 |
| Job completion webhook | Yes | Yes | **Yes** | DOC | webhook type 3 |
| Job status polling | Yes | Yes | — | DOC | H30, W23, W27 |
| List jobs per device | NF | Yes | — | DOC | W25 |
| Webhook signature verification | Yes | Yes | — | DOC (algorithm unusual; see blockers) | — |
| Webhook registration via API | **NF** (portal / e-mail) | **NF** (dashboard) | — | DOC | — |

## Summary: what needs a Bridge

**Needs an online Bridge within BLE range of the lock:** remote lock/unlock, custom PIN create/delete, live battery, live lock/door status, pulling logs on demand. Every documented webhook event is Bridge-originated, so without a Bridge there are no push events at all.

**Works without a Bridge:** algoPIN generation, ekey generation, iglooKey tokens, reading cached device data, properties, and activity history already uploaded to the server.
