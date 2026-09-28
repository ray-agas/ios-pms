# Authentication, Accounts and Permissions

Research date: 2026-09-25. Evidence labels: see [README](README.md#evidence-labels).

## 1. Account types

| Account type | Product | How you get API access | Who authenticates | Evidence |
|---|---|---|---|---|
| **User / Individual** | igloohome API | Self-service: log in at the igloohome API portal with igloohome app credentials, copy Client ID/Secret. 30-day free trial. | Your own server (client credentials) | DOC, support article |
| **Partner** | igloohome API via **iglooconnect** | "A valid igloohome business partnership"; register static HTTPS callback URL(s) with BD / integration team; receive Client ID | Each end-user logs in and consents (authorization code) | DOC |
| **iglooworks enterprise (client credentials)** | iglooworks API | "Contact BD to obtain your api credentials" | Your own server | DOC |
| **iglooworks code flow** | iglooworks API | Manual onboarding via BD ("automated portal coming soon") | Each end-user, "per organization" | DOC |
| **iglooworks API key** | iglooworks API / SDK | Not documented how to obtain. Mentioned in SDK (`IglooPlugin(context, apiKey)`) and in iglooworks 403 notes ("API-key auth path, which does not check scope at all") | App / server | DOC-PARTIAL |

Support article (updated 2026-09-07) describes the portal:
- "User/Individual Account — if you manage your own igloohome account and its devices."
- "Partner Account — if you are building on behalf of other igloohome account owners."
- Partner billing modes: **"BILL TO INTEGRATOR"** (partner invoiced) or **"BILL TO USER"** (end user invoiced).
- Devices section in the portal shows Bluetooth IDs, names, time zones, and **master PIN codes**.

### Which one fits Bobobox (inference, HYP)

- If Bobobox **owns** the locks and the igloohome account: **User/Individual** account with client credentials is the documented path. It is self-service and has a trial.
- If Bobobox wants to manage locks **owned by other operators/franchisees**: **Partner** (iglooconnect) is required, which needs a business partnership.
- If Bobobox needs **departments, audit-trail grants, access listing, and ekey revocation**: those exist only on **iglooworks**, which is a separate enterprise product and account type, contracted via BD.

This decision is a user/business decision and is listed as a blocker.

## 2. Token flows

### Client credentials (DOC)

```
POST https://auth.igloohome.co/oauth2/token          (iglooworks: https://auth.iglooworks.co/oauth2/token)
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&scope=igloohomeapi/get-devices igloohomeapi/get-properties
```

Documented response: `{"access_token":"<JWT>","expires_in":86400,"token_type":"Bearer"}`. No refresh token in this flow; request a new token before expiry. Access tokens last **24 hours**.

### Authorization code (iglooconnect / iglooworks code flow) (DOC)

1. Redirect user to `https://auth.igloohome.co/login?response_type=code&client_id=…&redirect_uri=…&scope=…&state=…` (iglooworks: `auth.iglooworks.co/login`, no `state` documented).
2. Callback receives `?code=…&state=…`. Redirect URI must be static, HTTPS, exact match.
3. Exchange at `/oauth2/token` with `grant_type=authorization_code`. igloohome: with Basic auth header. iglooworks example: **no** Basic header shown (public client?).
4. Response adds `id_token` (name, email claims) and `refresh_token`.
5. Access token 24 h; **refresh token expires 365 days after initial login** and cannot be extended — user must re-login. Vendor recommends prompting 30 days before.
6. `state` must not be URL-encoded JSON; base64 it instead.

### REST token wrapper (DOC-PARTIAL)

`POST /token` and `POST /token/revoke` exist in the reference, with a JSON body and an example `expires_in: 3600`. Relationship to the `auth.igloohome.co` endpoint is undocumented. Backend is AWS Cognito. Treat as unconfirmed; use `auth.igloohome.co/oauth2/token`, which is documented in both guides and used by the third-party library.

### Token handling rules we must implement (from CLAUDE.md §7 + vendor guidance)

- Store `expires_at = now + expires_in`; refresh early (vendor suggests 1 h before).
- Client secret and tokens server-side only. Tokens are JWTs; never log them.
- For iglooconnect: store refresh token encrypted, track the 365-day hard expiry per end-user.

## 3. Scopes (least-privilege)

Omitting `scope` grants **all** scopes (DOC). A token lacking a scope gets `403` on the gated endpoint (DOC). We should always request explicit scopes.

### igloohome API — 18 scopes (+2 OIDC for iglooconnect)

| Scope | Grants | Mutating? |
|---|---|---|
| `igloohomeapi/get-devices` | List/get devices, devices per property | No |
| `igloohomeapi/get-properties` | List/get properties | No |
| `igloohomeapi/get-device-activity` | Activity log history | No |
| `igloohomeapi/get-job-status` | Job status | No |
| `igloohomeapi/get-master-pin` | **Read master PIN** | No, but secret |
| `igloohomeapi/get-battery-level-bridge-proxied-job` | Bridge job 9 | Contacts lock |
| `igloohomeapi/get-device-status-bridge-proxied-job` | Bridge job 10 **and** Bridge-targeted status job | Contacts device |
| `igloohomeapi/get-activity-logs-bridge-proxied-job` | Bridge job 15 | Deletes logs on lock |
| `igloohomeapi/algopin-onetime` / `-permanent` / `-hourly` / `-daily` | algoPIN generation | Yes |
| `igloohomeapi/create-pin-bridge-proxied-job` | Bridge job 4 | Yes |
| `igloohomeapi/delete-pin-bridge-proxied-job` | Bridge job 5 | Yes |
| `igloohomeapi/lock-bridge-proxied-job` | Bridge job 1 | **Physical** |
| `igloohomeapi/unlock-bridge-proxied-job` | Bridge job 2 | **Physical** |
| `igloohomeapi/update-device` | `PUT /devices/{id}` | Yes |
| `igloohomeapi/create-ekey-access` | Generate Bluetooth guest key | Yes, secret |
| `openid`, `profile` | iglooconnect identity | — |

Gaps (DOC-CONFLICT / DOC-PARTIAL): `store-device-activity` is required by `POST /devices/{id}/activity` but is **not** in the igloohome scope list. No scope is listed for algoPIN **passage** or for iglooKey `/pass` endpoints.

**Update 2026-09-27 (E21, `experiments/EXP-20260927-01-scope-ceiling.md`, API):** a token requested without `scope`, then `server-health`, lists **20** scopes for our client: the 18 above plus `store-device-activity` (so it exists and is granted) and `edit-pin-bridge-proxied-job`. There is still no iglooKey or passage scope.

### iglooworks API — 28 scopes

Adds, relative to igloohome: `create-custom-pin-permanent-job`, `create-custom-pin-duration-job`, `create-custom-pin-onetime-job`, `edit-pin-bridge-proxied-job` (but job 3 is "not supported"), `delete-pin-job`, `get-access`, `store-device-activity`, `get-jobs`, `get-job-detail`, `update-job-status`, `algopin-duration`, `algopin-otp`, `get-departments`, `get-account-detail`. The iglooworks guide's own "Example 3: PMS" uses `iglooworksapi/algopin-onetime` and `iglooworksapi/algopin-daily`, which are **not** in its scope list (list says `algopin-otp`, `algopin-duration`). (DOC-CONFLICT)

iglooworks algoPIN endpoints are **double-gated**: token needs the broad algoPIN scope *and* the type-specific scope. (DOC)

## 4. Roles and permission granularity

| Question | Finding | Evidence |
|---|---|---|
| Roles (admin / manager / staff) exposed via API? | Not found. iglooworks `GET /users` lists users; role fields NF. | NF |
| Device-level permission scoping for an API client? | Not found on igloohome. Token scopes are **operation-level**, not device-level: a token with `unlock-bridge-proxied-job` can unlock **every** Bridge-connected lock on the account. | DOC (scopes) + NF |
| Department-level scoping | iglooworks only: most calls accept `departmentId`; 409 if the lock is not in that department. Whether a token can be *restricted* to a department is NF. | DOC-PARTIAL |
| Delegated access to another company's account | Yes, via iglooconnect partner flow: each owner logs in and grants chosen scopes to our app; owner can revoke (server-health returns `403` "user has revoked access"). | DOC |
| Revocation detection | `GET /server-health` → `403` when revoked/removed (igloohome); iglooworks 403 with body "The user has revoked access for this application…". | DOC |
| Multi-user access to same lock | Handled in igloohome app; not in API. ekeys carry `permissions`. | NF (API) |

**Implication (HYP):** least privilege per device must be enforced **in our application** (property/room → user role mapping), because the vendor token cannot express it.

## 5. Subscription and billing constraints

| Fact | Evidence |
|---|---|
| 30-day free trial (User and Partner) | DOC, support article |
| After trial: **USD 2 per active lock per month** | Official support article (read via summarising fetch; re-verify wording) |
| Trial ended → every call `402 {"error":"30 days igloohome API trial has ended"}` | DOC |
| iglooworks: `402 account.payment.is.suspended` (billing suspended or past trial grace) | DOC |
| `server-health` returns `tier` (e.g. `paid`) and `endsAt` | DOC-PARTIAL |
| Definition of "active lock" (paired? used via API in month?) | NF |
| Whether Bridges/keypads count as billable | NF |

## 6. Rate limits

| Limit | Evidence |
|---|---|
| Bridge-targeted job: **1 request per 5 minutes**, `429` with `Retry-After` seconds | DOC |
| Any other endpoint | NF — must be discovered empirically, carefully |
| BLE: one operation at a time per lock | DOC (SDK) |

## 7. Open questions for this area

1. Which product and account type does Bobobox have (or intend to buy)?
2. Is the portal at `web.igloohome.co/api/…` or `access.igloocompany.co/api-access`? (Both documented.)
3. What is the real `expires_in` and JWT `scope` claim format?
4. Does requesting a scope the account is not entitled to fail with `invalid_scope` or silently drop it?
5. How is an iglooworks API key issued and what can it do (no scope checks)?
