# Research Sources

All accessed 2026-09-25 unless stated. Priority follows CLAUDE.md §4.

## Official documentation (priority 1)

| Source | URL | Notes |
|---|---|---|
| Docs home (igloohome) | https://docs.igloohome.co/home | Entry point |
| Docs home (iglooworks) | https://docs.igloohome.co/works | |
| Full docs corpus | https://docs.igloohome.co/llms-full.txt | 22,314 lines; all pages inlined. Snapshot: `sources/2026-09-25/llms-full.txt` (SHA-256 `b88348de…c311e`) |
| Docs index | https://docs.igloohome.co/llms.txt | Snapshot included |
| Sitemap | https://docs.igloohome.co/sitemap.xml | 64 URLs, all on `docs.igloodeveloper.co` host; snapshot included |
| Markdown source of any page | append `.md` to page URL | Per `llms.txt` |

Pages read (all within the corpus), igloohome: `api_algopin`, `api_bridge_jobs`, `api_devices`, `api_ekey`, `api_iglookey`, `api_properties`, `api_server_health`, `api_token`, `bridge-jobs-proxied`, `bridge-jobs-targeted`, `getting-started-iglooconnect`, `getting-started-igloohome-api`, `supported-devices`, `what-is-algopin`, `webhook-job-specific-data`, `webhook-security`, `webhooks-bridge-event`, `sdk_*` (13 pages).

iglooworks: `api_access`, `api_account`, `api_activity`, `api_bridges`, `api_departments`, `api_devices`, `api_jobs`, `api_properties`, `api_users`, `bridge-overview`, `bridge-proxied-jobs`, `getting-started-client-credentials`, `getting-started-code-flow`, `supported-devices`, `what-is-algopin`, `webhook-automated-event`, `webhook-job-specific-data`, `webhook-security`, `sdk_*` (13 pages).

### Accessibility limitations

- Content was taken from the official `llms-full.txt` corpus rather than scraped HTML, so JavaScript rendering was not a barrier.
- `docs.igloodeveloper.co` (host used in sitemap and share links) did not connect from our network (curl status 000).
- Images in iglooworks "What is algoPIN" (24 h activation diagrams, hosted on stoplight.io) were not reviewed.
- The igloohome webhook-security page's Node.js example was reviewed via the identical iglooworks page.

## Official portals and support (priority 2–3)

| Source | URL | Notes |
|---|---|---|
| igloohome API portal (documented) | https://web.igloohome.co/api/api-access, https://access.igloocompany.co/api-access, https://web.igloohome.co/api/login | Not accessed (needs login) |
| iglooconnect | https://connect.igloocompany.co/ | Not accessed |
| iglooworks dashboard | https://dashboard.iglooworks.co/ | Not accessed |
| Support: "igloohome API (formerly iglooaccess)" | https://support.igloohome.co/support/solutions/articles/35000243522-igloohome-api-formerly-iglooaccess- | Updated 2026-09-07. Account types, trial, pricing, billing modes. Read through a summarising fetch tool; quotes should be re-verified before external use |
| Developers page | https://www.igloohome.co/developers | Search result only |
| Stoplight igloohome API docs (older official) | https://igloocompany.stoplight.io/docs/igloohome-api/1w1cuv56ge5xq-overview ; content via `https://stoplight.io/api/v1/projects/cHJqOjEzNjUyMA==/table-of-contents` and `/nodes/{id}` | **Read in full (28 nodes)**, public, no login. Snapshot: `sources/2026-09-25/stoplight-igloohome-api/`. Comparison: `12-stoplight-comparison.md` |
| Stoplight iglooworks docs | https://igloohome.stoplight.io/docs/iglooworks/ | Not read (iglooworks only relevant if B1 = iglooworks) |
| Support e-mail | dev+support@igloocompany.co (webhook key, iglooconnect webhooks); dev+support@igloohome.com (integration help) | Both documented |

## Unauthenticated probes (PROBE)

Read-only `GET`, no credentials, 2026-09-25:

| Request | Status | Body |
|---|---|---|
| `GET https://api.igloodeveloper.co/v1/server-health` | 403 | `{"message":"Forbidden"}` |
| `GET https://api.igloodeveloper.co/igloohome/server-health` | 401 | `Unauthorized` |
| `GET https://api.igloodeveloper.co/igloohome/devices` | 401 | `Unauthorized` |
| `GET https://api.igloohome.co/home/server-health` | 401 | `Unauthorized` |
| `GET https://api.iglooworks.co/v2/devices` | 401 | `Unauthorized` |
| `GET https://api.igloohome.co/works/account` | 500 | `{"message": "Internal server error"}` |
| `GET https://auth.igloohome.co/.well-known/openid-configuration` | 404 | `{"error":"This URL doesn't exist on the authorization server."}` |

## Third-party (priority 6, secondary evidence only)

| Source | URL | What it supports |
|---|---|---|
| `igloohome-api` Python library (keithle888), commit `cd228d3` (2026-07-19) | https://github.com/keithle888/igloohome-api | Production base URL `https://api.igloodeveloper.co/igloohome`; auth host `https://auth.igloohome.co`; uses devices, Bridge proxied jobs, job status |
| Home Assistant igloohome integration | https://www.home-assistant.io/integrations/igloohome/ | Lock/unlock via Bridge, battery polling; uses the library above |
| Seam igloohome integration | https://www.seam.co/manufacturers/igloohome | Exists; not reviewed |
