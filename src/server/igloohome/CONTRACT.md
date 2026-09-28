# igloohome API contract used by this module

Selected 2026-09-25 (implementation plan §6). Update this file whenever an experiment confirms or contradicts an entry.

## Source

| Item | Value |
|---|---|
| Primary docs | docs.igloohome.co, snapshot `docs/research/igloohome/sources/2026-09-25/llms-full.txt` (SHA-256 `b88348de8c107fc694adde4e045649224152cd639e638adc0274debaa1fc311e`) |
| Secondary (field rules only) | Stoplight snapshot `docs/research/igloohome/sources/2026-09-25/stoplight-igloohome-api/` |
| Account type | igloohome **User** (client-credentials flow) |
| Base URL | `https://api.igloodeveloper.co/igloohome` — **API (EXP-20260925-01)**. `https://api.igloohome.co/home` returns the same (not used) |
| Token | `POST https://auth.igloohome.co/oauth2/token`, form-encoded, `Authorization: Basic base64(id:secret)`, `grant_type=client_credentials`, explicit `scope` — **API**: JWT, `expires_in` 86400, `scope` claim = requested scopes |

## Client methods → vendor operations

| Method | Vendor operation | Inventory | Evidence | Experiment |
|---|---|---|---|---|
| `TokenProvider.getToken` | `POST /oauth2/token` | H1 | **API** | E1 ✓ |
| `serverHealth` | `GET /server-health` | H6 | **API** (`status` field absent; `tier` = `TRIAL`) | E2 ✓ |
| `listProperties` / `getProperty` / `listPropertyDevices` | `GET /properties…` | H7–H9 | **API** | E4 ✓ |
| `listDevices` / `listAllDevices` | `GET /devices` | H10 | **API** | E3 ✓ |
| `listPinCapableDevices` | `GET /devices/support-pins` | H11 | **API** | E3 ✓ |
| `getDevice` | `GET /devices/{deviceId}` | H12 | **API** (`lockStatus` uppercase on Bridge-linked lock-type devices; internal `id` NOT unique) | E3 ✓ |
| `listActivity` | `GET /devices/{deviceId}/activity` | H14 | **BLOCKED**: 403 `Forbidden` despite `get-device-activity` scope (U18); re-checked via Try it 2026-09-26, still 403 | E4 ✗ |
| `createProxiedJob` (job 9, 10 only) | `POST /devices/{deviceId}/jobs/bridges/{bridgeId}` | H28 | **API** (job 9 `batteryLevel`; job 10 `lockOpen` bool, `doorOpen` number, PIN counts) | E7 ✓, E8 ✓ (EXP-20260926-01) |
| `createBridgeDiagnosticsJob` (job 10) | `POST /devices/{bridgeId}/jobs` | H29 | **API** (Wi-Fi, `lockRssiList` with full device IDs as `bluetoothName`, capacity; 429 + Retry-After) | E6 ✓ (EXP-20260926-01) |
| `getJob` | `GET /jobs/{jobId}` | H30 | **API**: `jobStatus` = state (1 pending, 0 completed); result in `opResult`; `jobType` string | E7 ✓ (EXP-20260926-01) |
| `createAlgoPin` (onetime, hourly, daily, permanent) | `POST /devices/{deviceId}/algopin/{type}` | H17–H20 | **API** for onetime/hourly (EXP-20260926-02: deterministic, one-time single-use); daily/permanent DOC (rules in `lib/algopin-rules.ts`: Stoplight field rules + what-is-algopin) | E10, E11 (M5) |
| `createPinJob` (job 4 custom PIN, job 5 delete) | `POST /devices/{deviceId}/jobs/bridges/{bridgeId}` | H28 | DOC (rules in `lib/pin-job-rules.ts`) | E12, E14 (M5) |

## Open conflicts that affect this code

| ID | Effect | Where handled |
|---|---|---|
| D23 | ~~`jobResponse.jobStatus` meaning differs between docs~~ **Resolved 2026-09-26** (EXP-20260926-01): polled = state, webhook = result | `mapping.ts#toJobStatus` shows the state reading, `verified` for 0/1 |
| D24 | `doorOpen`: docs boolean, API sent number `1` | Job page shows the raw value with the note "docs say true/false"; not interpreted until E8b |
| D12 | `opResult` is `{result}` or a number | `schemas.ts#jobStatusSchema` accepts both |
| D27 | `lockStatus` casing | `mapping.ts#lockState` normalises |
| — | `linkedDevices` marked required but missing in a Stoplight example | `schemas.ts` defaults to `[]` |
| — | Links are on Bridge/keypad records; lock records have `linkedDevices: []` (API) | Find a lock's Bridge by scanning Bridges (M4) |
| — | Gateway denials are plain-text `Forbidden` (API) | `errors.ts` handles string bodies |

Fixtures: `tests/fixtures/igloohome/doc-examples.ts` (DOC) and `captured-2026-09-25.json` (API, sanitized, EXP-20260925-01).
