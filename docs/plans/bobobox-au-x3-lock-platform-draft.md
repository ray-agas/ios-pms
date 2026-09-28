# Draft: iot-pms as Bobobox AU's X3 Lock Platform (research, parked)

> **Status:** research and brainstorm only, **no code**. Parked on 2026-09-28 at the user's request; resume from "Open decisions".
> **Sources:** Bobobox AU repo `../bobobox-au-architecture/knowledge/` (read-only): `00-source-of-truth/bobobox-au-guest-journey-prd-v2.md`, `…flow-atlas-v2-1-dark.html`, `01-discovery/context-map-au-guest-journey.md`, event-storm, tactical-model, discovery and architecture-review documents. iot-pms facts: [`docs/ai-context.md`](../ai-context.md) and the experiment records.
> **Labels:** AU = stated in the Bobobox AU docs; EVID = iot-pms code or experiments (API/HW); INF = inference; REC = recommendation.

## 1. What the AU happy path needs from the lock platform (AU)

| Moment | Requirement | AU source |
|---|---|---|
| Booking / pre-arrival | No PIN exists yet ("no PIN, no deposit, no ID ever existed", born at check-in) | Atlas no-show card |
| Online check-in (opens 2 hours before check-in; same-day bookings: at confirmation) / kiosk check-in (DECA) | `PinIssued`: a door PIN, **not live yet**, sent by email (`pin-issued.guest.email`) or shown on the kiosk | FR-301/302, FR-405 |
| Arrival | `PinActivated` from a sweep at the **later of issue time and check-in time**; never a fixed-hour job, never tied to room or deposit state | FR-502 |
| In-stay extra bed | **Bed PIN active immediately**, shown on the website and in `order-confirmed.guest.email` | FR-702 |
| Extend stay | **Same PIN**, new window; the credential must *reference* the stay window, not copy it (review BLOCKER AB1) | FR-604, AB1 |
| Check-out, or cancel after check-in | `PinRevoked` for **all** credentials, door and bed; 15-minute grace period when the guest checks out | FR-801, FR-503, FR-605, FR-601 |
| PIN fails at the door | Re-push (idempotent) → re-issue → `CabinReassigned` to a clean vacant cabin (dead cabin marked out of order) → lockbox; every case creates an incident | FR-505 |
| Invariants | One valid door PIN per in-window checked-in reservation; no PIN valid outside its window; bounded time-to-revoke; **full attribution for every PIN on any lock** | FR-504, FR-1402 |
| Monitoring | Invariants checked against the actual lock state (door + bed); the only real-time escalation is `access-violation.cs.alert` | FR-1302/1303 |
| Deposit email | Timed from "first door unlock + 1 h" (fallback: `PinActivated` + offset). A door-unlock event is listed as **missing** in AU | FR-404 |
| Business rule | "The door is never hostage" | BR 1 |

**X3 in the AU context map:** "Upstream of C1 Access — ACL required, tier-0". Its jobs are credential push, credential revocation and access reporting. Lock calls use an outbox, retries and a human alert, and are idempotent. The platform tracks the PIN currently installed on every lock, and lock calls are synchronous.

**Phone numbers (AU):** FR-303 "No phone number is collected anywhere". The PIN reaches the guest by AU's email, website and kiosk, so iot-pms needs no phone number. Mentions to clean up on the AU side (none is guest collection):
- FR-1401 and FR-707: customer service captures a number over WhatsApp.
- Discovery #19 and Q14: emergency contact.
- The architecture review: "CS-issued credential over the phone".

## 2. What iot-pms already covers (EVID)

| AU need | iot-pms today |
|---|---|
| Door PIN with a window | Custom PIN job 4 (minute-precise; the start is enforced to the second, HW), or an algoPIN |
| Bed PIN | **The keypad stores the PIN and opens the bedlock switch**, which re-locks in 4–6 s (HW, EXP-20260928-01) |
| Revoke | Job 5; confirmed through the job-complete webhook (0 = deleted; 3 = already gone, still released) |
| PIN currently installed | Encrypted vault + job results; super-admin reveal |
| Attribution | Every job, PIN, reveal and emergency action is audited with its person |
| Door-unlock signal | Lock logs 19–22 matched to the PIN fingerprint (first use) |
| Door never hostage | Emergency remote unlock (reason + password), health checks, Bridge online status |
| Cabin → locks | Registry: cabin/room → door lock, keypad, switch, Bridge |

## 3. Constraints to design around (INF from EVID)

1. **A PIN's window cannot be edited** (job 3 is not supported; algoPIN windows are fixed). "Same PIN, new window" = delete + recreate the same value. Proven possible in EXP-20260926-04; it leaves a short gap.
2. **algoPINs:**
   - must be typed once within 24 h of their start;
   - starts are whole hours only;
   - they are deterministic, and a deleted one stays refused (K8).
   Fine as an offline fallback; risky as the main door PIN.
3. **A 200 means "sent", not "done".** With the Bridge dropping, a job can be accepted and never run (EXP-20260927-02 F5). Every command needs a confirmed outcome, plus a timeout and an alert.
4. **Revoke depends on the Bridge.** Setting the PIN's own end to check-out + grace makes the lock enforce "no PIN outside its window" even when offline; job 5 covers early check-out.
5. **No API lists the PINs on a lock**, so the iot-pms ledger is the source of truth. The status job's `pinsCurrentActive` count could be a coarse cross-check (to verify).
6. **Before a pilot:** the webhook signing key (unverified today), and the **igloohome trial ending 2026-10-17**.
7. **Bridge throughput:** igloohome's support FAQ says a Bridge "currently handles **2 jobs per minute**" (DOC, not yet verified; see [research 13](../research/igloohome/13-make-beds24-integration.md)). Every check-in sends a door PIN job; an extra-bed purchase (FR-702, in-stay only) sends a bed PIN job; an extend sends delete + create for each PIN. X3 needs a per-Bridge job queue. It is not in the API reference, and the API accepted 2 jobs within a minute without a 429, so it's a practical limit, not an enforced one (research 13 §3a). A normal check-out needs no job (the PIN's end enforces it); only early check-out, cancel and extend do.
8. **One writer per lock:** no Make.com / Beds24 (or other iglooconnect integration) on locks iot-pms manages, or PINs escape the vault and the audit.
9. **Lock PIN storage:** a full lock answers 12 "insufficient PIN storage" (DOC), and algoPINs share a 199-code list (DOC). Whether an expired custom PIN frees its slot is unknown. If it doesn't, each stay needs one clean-up delete job, which can run off-peak (E-X9).

## 3a. Bridge load projection (INF, 2026-09-28)

**What uses the Bridge.** iot-pms never talks to a Bridge directly. Every call goes to igloohome's cloud API, and the cloud forwards jobs to the Bridge, which reaches the lock over Bluetooth.

| Uses the Bridge (a job) | Cloud only (no Bridge) |
|---|---|
| Custom PIN create (4) and delete (5): door, bed, extend, early check-out, cancel, repush | algoPIN issue (the cloud computes it; the lock checks it offline) |
| Remote lock (1) / unlock (2): emergency | `GET /devices`, `/devices/{id}`, `/devices/support-pins`, `/properties/.../devices` |
| Battery (9), status (10), pull logs (15): health checks | `GET /jobs/{id}` (job polling) |
| Bridge diagnostics (10 on the Bridge): 1 per 5 min, 429 | Webhooks igloohome sends us (job results, logs) |

All jobs are started by a person today; nothing runs automatically. The Bridge uploading lock logs (webhook type 5) is Bridge traffic too, but igloohome does not call it a job. Whether it slows jobs down is unknown.

**Jobs per stay (per the PRD):**

| Event | Jobs | When |
|---|---|---|
| Check-in: door PIN | 1 | Spread over H-2 to arrival (FR-301) |
| Extra bed bought (FR-702) | 1 | In-stay, random |
| Extend (FR-604) | 2 per PIN (delete + create) | Near check-out; urgent |
| Early check-out / cancel after check-in | 1 per PIN | Random; urgent |
| Normal check-out | **0** (the PIN's end + 15 min is enforced by the lock) | — |
| Repush after a failure (FR-505) | 1 per retry | Urgent |
| Storage clean-up (only if E-X9 says expired PINs keep their slot) | 1 per PIN | Off-peak |

Typical stay: about 1–1.5 jobs. Worst normal case (extra bed + extend + clean-up): about 6.

**Topology (user decision, 2026-09-28):** **one Bridge per cabin**, linked to that cabin's door lock, bedlock switch and keypad, like Cabin-01 on the bench. The Bridge limit therefore only ever sees **one cabin's jobs**.

**Load per Bridge:** a cabin has about one stay a day (check-out 11:00, check-in 15:00), so about 1–6 jobs a day. At 2 jobs/min (DOC), the worst case inside one cabin is an extend with an extra bed: 4 jobs (door delete + create, bed delete + create), about 2 min. **The Bridge limit is not a scaling problem with this topology.** Ten cabins mean ten Bridges working in parallel. Kiosk share and extra-bed/extend rates no longer matter for the Bridge.

**What scales with cabins instead:**
- **igloohome cloud API volume** (calls iot-pms makes to igloohome, not calls to iot-pms). It grows with cabins × reservations. igloohome documents no cloud rate limit except the Bridge-targeted one, and no rate-limit headers were seen (U11). This needs real numbers later (check-ins per day ≈ cabins × about 1).
- **Cost:** **about US$9 per cabin per month** for the Cabin-01 setup (door lock, keypad, switch, Bridge), confirmed by the IoT team (user, 2026-09-28); no per-device breakdown. igloohome's support page quotes "US$2/month per active lock" for iglooconnect. Cost scales with cabins.

**Design (REC):** one queue per Bridge (= per cabin); urgent jobs (repush, unlock, revoke, extend) ahead of routine ones (issue ahead of time, clean-up, health checks); one job in flight per lock (already a guard); start the next job only after the previous result arrives or after a 2 min timeout (support pages); issue the door PIN as soon as online check-in happens so its start time does the waiting; algoPIN (no Bridge) as the fallback when the queue or the Bridge is down.

**Needed later (the user will bring numbers; AU has no benchmark yet and Indonesia works differently):** check-ins per day and the peak hour, for cloud API volume and cost only.

## 4. Recommendation (REC)

1. **Door credential:** a custom duration PIN (job 4), start = check-in time, end = check-out time + 15 min grace. iot-pms generates the value and keeps it in the vault.
   - **Extend:** delete + recreate the same value with the new end.
   - **Early check-out or cancel:** job 5.
   - **Bridge offline at issue:** fall back to an algoPIN, and report the new PIN to AU.
2. **Bed credential:** a custom PIN on the cabin's keypad, live immediately, revoked with the door PIN at check-out.
3. **iot-pms becomes X3 through a small service API:**
   - machine-to-machine auth;
   - external IDs (AU cabin ↔ space; AU credential ID ↔ PIN, used as the idempotency key);
   - a credential record with its own states (requested → installed → active → revoked; failed / unknown);
   - commands: issue/ensure, revoke, repush, reissue, extend, status, the cabin's locks;
   - events: `CredentialInstalled`, `CredentialFailed`, `CredentialRevoked`, **`DoorUnlocked`**, `LockOffline` / `BridgeOffline`, `AccessMismatch`;
   - "active" reported as logical (install confirmed and start passed);
   - reconciliation against the lock state.
4. **Not in iot-pms:** reservations, sweeps, emails, the kiosk, the lockbox. Staff and housekeeping access is not specified by AU yet; it's an open question for AU.

## 5. Phases

| Phase | Content |
|---|---|
| P0 Decisions | D1 door credential type · D2 how the PIN reaches AU (returned once, or fetched on demand) · D3 service authentication · D4 event delivery (push vs outbox poll) · D5 who generates the PIN value |
| P1 Experiments (bench) | E-X1 duration window enforced to the minute · E-X2 delete + recreate the same value (measure the gap) · E-X3 re-sending the same PIN → 406 = "already installed"? · E-X4 bed keypad PIN immediate + revoke · E-X5 `pinsCurrentActive` follows installs? · E-X6 Bridge offline at end time → the lock still refuses after the end? · E-X7 algoPIN fallback timing · E-X8 3 jobs within a minute on one Bridge (the 2/min limit) · E-X9 does an expired custom PIN free its storage slot? |
| P2 X3 core | External IDs, credential model, idempotency, service API v1 + machine auth, outbox |
| P3 Lifecycle | Issue / extend / revoke / repush / reissue for door + bed; emergency unlock as an attributed CS step |
| P4 Signals | `DoorUnlocked`, offline events, reconciliation, mismatch signal |
| P5 Hardening | Webhook key, retries and alerts, shared state for more than one instance, contract tests with AU, check-out wave load, licence after the trial |

## 6. Open decisions (resume here)

1. **D1:** a custom duration PIN for the door, an algoPIN only as the offline fallback, and delete + recreate on extend?
2. **D2:** does iot-pms return the PIN to AU, or does AU ask each time it has to show it (so AU never stores it)?
3. Run the P1 experiments first, or write the full plan first?
4. AU open questions that matter here:
   - M6/Q6: vendor not formally selected in AU;
   - Q1: can one reservation cover several cabins?
   - Q12: is the extra bed pre-staged in every cabin?
   - Q14: emergency obligations without phone numbers;
   - staff/housekeeping physical access;
   - engineer role scope.
