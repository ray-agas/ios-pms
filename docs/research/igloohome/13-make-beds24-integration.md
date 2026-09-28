# 13 — igloohome × Make.com × Beds24 integration (research, 2026-09-28)

> **Status: NOT USED by iot-pms.** A reference note on a third-party no-code integration, kept for its Bridge-limit and pricing evidence. iot-pms does not use Make.com, Beds24 or the Igloo Make app, and nothing here describes iot-pms code or its API. Rule: one writer per lock (§3).
>
> **Question:** what is the "Beds24 integration to Make.com" that igloohome publishes, is it like iot-pms, is it more powerful, and does it block or collide with what we built?
> **Labels:** DOC = igloohome support pages (fetched 2026-09-28); INF = inference; REC = recommendation.

## Sources

- [Beds24 Integration to Make.com](https://support.igloohome.co/support/solutions/articles/35000288497-beds24-integration-to-make-com)
- [Make.com: Onboarding Steps](https://support.igloohome.co/support/solutions/articles/35000279516-make-com-onboarding-steps)
- [FAQs (Make and Beds24 sections)](https://support.igloohome.co/support/solutions/articles/35000279547-faqs)
- [MAKE folder](https://support.igloohome.co/support/solutions/folders/35000247276) · [iglooconnect](https://www.igloohome.co/software/iglooconnect) · [Beds24 wiki: Igloohome](https://wiki.beds24.com/index.php?title=Igloohome&redirect=no)

## 1. What it is (DOC)

A **no-code recipe**, not a product:

```
Beds24 (a booking / property-management system)  →  Make.com scenario (automation glue)  →  "Igloo" app on Make  →  igloohome API  →  lock
```

- **Beds24** holds the bookings. Its "Watch Bookings" module starts the scenario.
- **Make.com** filters the booking and computes the dates.
- **The Igloo app on Make** is a private app, reachable **only through an invitation link from iglooconnect**; it is not listed on Make. Its modules:
  - **algoPIN:** one-time, permanent, duration daily, duration hourly;
  - **Bridge proxied jobs:** custom PIN duration, delete PIN, lock, unlock;
  - **reads:** get job status, get properties, get devices.
  - No triggers from igloohome into Make are documented.
- **Recipes in the article:**
  - hourly algoPIN for stays under 672 h (28 days), daily for longer;
  - same-day bookings start at the current hour;
  - or a **custom PIN via the Bridge** with a random 6-digit value (`floor(random*900000)+100000`).
  - Beds24 only has dates, so the check-in time and the lock's time zone are typed in by hand.
- **Not covered by the article:** revoking on cancellation, booking changes, how the PIN reaches the guest, privacy.
- **Cost:** "US$2/month per active lock", charged to the iglooconnect account (Stripe), described as an **"API subscription fee"**.
- **Bridge throughput:** "The bridge currently handles **2 jobs per minute**."

## 2. Compared with iot-pms (INF)

| | Beds24 + Make + Igloo app | iot-pms |
|---|---|---|
| What it is | A booking system plus no-code glue | The **lock platform + operations dashboard** (Bobobox AU's X3) |
| igloohome capability | **The same API** we call (a subset of the same modules) | Same API, plus health checks, Bridge diagnostics, pull logs, webhooks, scope sync |
| Booking logic | Beds24 (plays AU's role) | None by design (AU owns it) |
| Revoke on cancel / modify / early check-out | Possible with the delete-PIN module, but **not wired** in the recipe | Planned for the X3 contract (D1: duration PIN + delete) |
| Confirming a job ran | Only if you add "get job status" yourself | Job settles from the webhook; timeouts; "a 200 is not done" handled |
| Guards and safety | Make filters only | Role, scopes, registry allowlist, one job at a time, rate limits, step-up |
| PIN storage and attribution | Make run logs | Encrypted vault, audit of every action and person |
| Cabin/room mapping, bed lock (keypad + switch) | Manual per lock | Registry, proven keypad → switch behavior |
| Monitoring | None | Activity, Bridge status, emergency list, reconciliation (planned) |
| Time to a first integration | **Hours, no code** | Built already |

**Is it more powerful?** No. It is **the same igloohome API with less control**. What it adds is speed and hundreds of no-code connectors. What iot-pms adds is the control, safety, evidence and monitoring a PMS at Bobobox scale needs.

**Is it like our PMS?** Only the Beds24 part is a PMS, comparable to **Bobobox AU**, not to iot-pms. iot-pms sits where "Make + the Igloo app" sits, but as an owned, guarded service.

## 3. Blocker or collision? (INF)

| Point | Assessment |
|---|---|
| Technical blocker | **None.** It uses the same public API, the same PIN types and the same Bridge jobs |
| Collision | **Only if both run on the same locks.** Two writers would create PINs outside our vault and audit (this breaks AU's "full attribution for every PIN"), and could collide on PIN values (406) or on Bridge capacity. **Rule: one writer per lock.** |
| Commercial | The fee is an **API subscription per active device** (US$2/month via iglooconnect). Our own API trial ends **2026-10-17**; the price of *our* API plan after the trial is unknown. **Ask igloohome sales** whether the same per-device fee applies to direct API use |
| Bridge limit | **2 jobs per minute per Bridge (DOC, not yet verified by us).** This matters for Bobobox: every check-in sends a door PIN job, an extra-bed purchase sends a bed PIN job, and an extend sends delete + create for each PIN (up to 4). Our guards limit per device, not yet per Bridge |

## 3a. Is the Bridge limit documented? (checked 2026-09-28)

| Source | What it says | Status |
|---|---|---|
| FAQs and Make onboarding (support pages, both modified 2025-07-03) | "The bridge currently handles 2 jobs per minute"; Bridge jobs "will timeout in 2 minutes if the internet is unstable, the lock is too far from the bridge, or the lock's battery is low"; put a 15 s Sleep between Make modules | DOC (support, Make section only) |
| API reference (our snapshot of 2026-09-25, `sources/2026-09-25/`) | **No jobs-per-minute limit.** The only rate limit is Bridge-targeted jobs: 1 per 5 min, `429` + `Retry-After`. Job result `2` = "Another operation is in progress" on the device | DOC |
| Our job history (106 accepted jobs, 1 Bridge) | 12 pairs of jobs on the same Bridge 17–60 s apart: **all accepted (200, no 429)**. 10 completed; 2 expired with result 2, but both were jobs the device kind cannot run (switch PIN create, keypad pull logs), so the cause is unclear. **Never 3 jobs within 60 s** | API (our data) |
| "5 calls per minute total" (seen in web search) | This is **igloorooms**, a different company, not igloohome | Not applicable |

**Reading (INF):** "2 jobs per minute" looks like a practical limit of the Bridge and Bluetooth, not an API rate limit the API enforces with a 429. More jobs are likely accepted, then run late, time out after about 2 minutes, or return result 2. E-X8 must look at job results and timing, not only HTTP codes.

**Load impact (INF):** a door PIN whose end is check-out + grace expires on the lock by itself, even with the Bridge offline, so a normal check-out needs **no** job. Only early check-out, cancellation and extends need jobs. Issuing at online check-in (up to 2 h before arrival) spreads the check-in jobs over time. How many cabins share one Bridge on site is still unknown; ask AU.

## 4. What to take from it (REC)

1. **It confirms our direction.** igloohome itself recommends a custom PIN with a duration via the Bridge, or hourly/daily algoPINs, for bookings; same-day stays start at the current hour. This matches draft decision D1 in [`docs/plans/bobobox-au-x3-lock-platform-draft.md`](../../plans/bobobox-au-x3-lock-platform-draft.md) and our algoPIN rules.
2. **Add a per-Bridge job budget** (2/min, DOC) to the X3 design: queue jobs per Bridge rather than failing. Verify the number on the bench (**E-X8**: send 3 jobs within a minute through one Bridge).
3. **One writer per lock:** do not connect the Make app or Beds24 to Bobobox locks managed by iot-pms.
4. **Commercial:** ask igloohome about pricing for direct API use after the trial, and whether iglooconnect is needed at all for our account type.
5. **Nothing in iot-pms needs to change now.** The Make app offers nothing we cannot already do; it lacks the guards, vault, audit and monitoring.
