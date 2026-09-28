# Webhooks, Jobs and Operational Integration

Research date: 2026-09-25. Evidence labels: see [README](README.md#evidence-labels).

## 1. Job model (DOC)

```
Our server --POST job--> igloo API --(MQTT/Wi-Fi)--> Bridge --(BLE)--> Lock
           <--{jobId}--
           <============ webhook Job Complete (type 3) ===========
           --GET /jobs/{jobId}--> {completed, jobResponse, expiryDate}
```

States we must model (HYP, derived from DOC fields):

| Our state | Signal |
|---|---|
| `REQUESTED` | We sent POST, no response yet |
| `REJECTED` | 4xx on POST (400 validation, 403 scope, 404, 406 Bridge offline, 429) |
| `QUEUED` | 200 `{jobId}` |
| `SUCCEEDED` | webhook/poll `jobStatus: 0` |
| `FAILED` | `jobStatus` 1, 3, 5, 9, 12 |
| `BUSY` | `jobStatus` 2 (another operation in progress) — retry candidate only for read jobs |
| `EXPIRED` / `UNKNOWN` | past `expiryDate` with `completed: false`, or no webhook and poll inconclusive |

`jobResponse.opResult` appears as `{"result":0}` (igloohome) and as `0` (iglooworks) — shape differs (DOC-CONFLICT). Meaning of `opResult` is NF.

**Rule (CLAUDE.md §13):** a 200 on job creation is *request acceptance*, not *operation completion*. Unlock/lock must never be shown as done until `jobStatus: 0` arrives.

## 2. Webhook setup

| Product | How to register | Evidence |
|---|---|---|
| igloohome API (User/Partner via portal) | igloohome API portal → **Webhooks** section (`web.igloohome.co/api/api-access`) | DOC |
| iglooconnect partners | E-mail `dev+support@igloocompany.co`; self-service portal "planned" | DOC |
| iglooworks | iglooworks dashboard (`dashboard.iglooworks.co`) → Webhooks | DOC |

Requirements: endpoint must accept `POST`, HTTPS. No documented retry policy, timeout, expected response code, ordering, or deduplication behaviour (NF). One webhook URL per account or many: NF.

## 3. Webhook signature verification (DOC)

- Header: `x-igloocompany-sha256`, base64.
- Signed string: `METHOD|Host|URL path|Content-Type|Date|Body` joined with `|`.
- "HMAC with SHA-256" of the signed string, then RSA signature verification with igloo's **public key** (RSA 2048, DER, PKCS1, base64). Public key obtained from support (`dev+support@igloocompany.co`) or portal.
- The official Node.js example computes `crypto.createHmac('sha256', publicKey)` — i.e. the **public key is used as the HMAC key** — then `crypto.verify('sha256', hmacDigest, publicKey, signature)`.

Caveats (HYP / risk):
- The scheme is unusual; implement exactly as the vendor example, then prove it against a real webhook before trusting it.
- `Date` header is part of the signed data → we can enforce a freshness window to block replays. Vendor does not say so; our choice.
- The doc's own example strings disagree (`{"payload":"example"}` vs `{"payload":"example payload"}`), so do not use them as test vectors.
- Body must be verified as raw bytes, before JSON parsing.

## 4. Event types

| `event.type` | Name | Trigger | Key fields | Evidence |
|---|---|---|---|---|
| 3 | Job Complete / Job Processed | Bridge proxied or targeted job finished | `data.jobId`, `data.jobStatus`, job-specific data; `proxyId` or `accessoryId` = Bridge ID; `product.id` = lock ID | DOC (field naming inconsistent) |
| 5 | Activity Log Received | Bridge uploads lock logs | `data.activityLogs[]` raw log objects | DOC |
| 10 | Bridge Connection | Bridge connects/disconnects | `data.isOnline`; `product.id` = Bridge ID | DOC |

Common envelope: `{"payload":{"event":{id,type,data,date,proxyTransportMethod,…},"product":{id,type}}}` in the Bridge Events article; the Job-Specific Data article shows the same without the outer `payload` wrapper (DOC-CONFLICT). `event.id` is a natural **deduplication key** (HYP).

Job-specific data (type 3):

| Job | Extra `data` fields | Extra statuses |
|---|---|---|
| 1 Lock / 2 Unlock | none | — |
| 4 Create custom PIN | none | 5 invalid length, 9 duplicate, 12 storage full |
| 5 Delete PIN | none | 3 not found |
| 9 Battery | `batteryLevel` 0–100 | — |
| 10 Lock status | `lockOpen`, `doorOpen` | — |
| 10 Bridge-targeted status | Wi-Fi + capacity fields | — |
| 15 Logs | (logs arrive as type 5 events — HYP) | — |

There is **no documented webhook** for: PIN used / door unlocked in real time without a Bridge, battery low alarm, lock offline, algoPIN activation, iglooKey usage. Real-time guest entry events require a Bridge and depend on when the Bridge uploads logs (NF: upload cadence).

## 5. Polling guidance (HYP)

- Poll `GET /jobs/{jobId}` only as a fallback if no webhook arrives within N seconds; stop at `completed: true` or `expiryDate`.
- Do not poll Bridge-targeted status more than once per 5 min (documented 429).
- Device list for battery/health: poll infrequently (e.g. hourly) — values are cached server-side anyway.

## 6. Reliability rules (from CLAUDE.md §13 + findings)

| Operation | Safe to auto-retry? | Why |
|---|---|---|
| Token request | Yes | No side effect |
| GET endpoints | Yes, with backoff | Read-only |
| Bridge job 9, 10 | Yes, limited | Read, but wakes lock and can collide (`jobStatus: 2`) |
| Bridge job 15 | **No** | Deletes logs on the lock |
| algoPIN create | Yes on iglooworks (documented idempotent); igloohome HYP-idempotent — verify | Same inputs → same PIN |
| Custom PIN create (job 4) | **No** without first checking job status | Duplicate → status 9; storage use |
| Delete PIN (job 5) | Only after checking status | Not-found → status 3 |
| Lock / Unlock (1/2) | **Never automatically** | Physical action; a delayed first attempt plus a retry could unlock twice or lock on a guest |
| iglooworks revoke ekey | **No** | Irreversible |

## 7. Operational integration notes

- `lockTime` on jobs 1, 2, 15 sets the lock clock. Clock drift breaks algoPIN validity (HYP: algoPIN depends on lock time). A periodic clock sync strategy should be decided explicitly, not as a side effect of unlocks.
- Every device call can fail with `409 timezone is not found on property` — a data-integrity problem in the vendor account, not a transient error.
- `402` (trial ended / suspended) must surface as an account-level alert, not a per-request error.
