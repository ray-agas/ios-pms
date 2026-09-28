# Slice 2 plan — Guest stay access for one room

- **Status:** **SUPERSEDED 2026-09-26.** Reservations and stays belong to the separate Bobobox AU app; iot-pms stays the device/lock platform. See `iot-pms-platform-foundation-plan.md`. Kept for the M5 evidence summary in §2, which still holds
- **Builds on:** Slice 1 (M1–M4, complete) and M5 credential experiments: EXP-20260926-02 (algoPIN), -03 (Bridge PIN jobs), -04 (PIN reuse, algoPIN delete)
- **Source of truth for vendor behaviour:** `docs/research/igloohome/` + the experiment records above. Nothing below relies on an untested capability unless marked **HYP**
- **Deadline:** igloohome API trial ends **2026-10-17**. Slice 2 must be built and verified on hardware before then, or the subscription question must be answered by igloohome support

## 1. Goal

An operator can give a guest a PIN for a stay in one room, see when the guest first uses it, and cut access at early check-out or cancellation, with every state backed by an igloohome answer or a lock log.

Scope: **one room** (Doorlock `IGB4••••••d0`, room `oc-bbx`, Bridge `bridge`). The data model supports many rooms; only one is configured and tested.

## 2. What M5 proved (and what it changes)

| Question from research §9.4 | Answer | Evidence | Consequence |
|---|---|---|---|
| Can algoPINs be issued without a Bridge? | Yes, ~350 ms, lock validates offline | API + HW (EXP-02) | Issue works even if the Bridge is down at check-in |
| Is issue idempotent? | Identical request → same PIN and `pinId` | API (EXP-02 A2) | Safe to retry after a lost response |
| Can an unactivated algoPIN be deleted? | Yes, job 5 → 0, lock log 31, PIN refused afterwards | API + HW (EXP-04 R6) | Early check-out / cancellation is possible **if the PIN value is known** |
| How do we know the guest arrived? | Lock log (type 19/20/22) arrives by webhook in 3–6 s, matched to the credential by PIN fingerprint | HW (EXP-02 A8) | "Activated" state is real, not assumed |
| Does the lock enforce the window? | Start enforced to the second (custom PIN); one-time consumed on first use | HW (EXP-03 P2, EXP-04 R1) | Windows can be trusted |
| Custom PIN via Bridge as fallback? | Works, but Bridge must be online, a duplicate is refused with 406, and igloohome reserves a PIN value until it is deleted | API + HW (EXP-03/04) | Fallback only, and always a new PIN per stay |
| Does a delete that answers "not found" do anything? | It still releases igloohome's reservation | API + HW 3/3 (EXP-04 R3), cause HYP | Treat `jobStatus 3` on revoke as "already gone" = success |
| Can a job vanish? | One delete job expired with no result and had not run | API 1 sample (EXP-04 R5) | "Expired" = unknown; offer a re-send; never show "revoked" without `jobStatus 0/3` |
| Webhook duplicates? | Same log re-sent with a new event id after a Bridge reconnect | API (EXP-03 P6) | Match logs by content, not event id (already done) |

## 3. Credential strategy (recommended)

| Situation | Credential | Why |
|---|---|---|
| Default stay (≤ 28 days) | **Hourly algoPIN**, window = check-in hour (rounded down) → check-out hour (rounded up) | No Bridge needed at issue; idempotent; expires by itself at check-out |
| Stay > 28 days | Daily algoPIN (29–367 days, same hour) | Only algoPIN type that long |
| Operator needs minute precision, or algoPIN cannot be deleted later | Custom PIN via Bridge (job 4) | Needs the Bridge online; new value per stay |
| Guest phone instead of a PIN | iglooKey (E13, not tested) | Revocable by id without storing a secret; guest UX unknown. Candidate for Slice 3 |

Rules the stay flow enforces (reusing `lib/algopin-rules.ts`):
- **Issue just in time**: the start must be ≤ 256 h ahead (otherwise the PIN can never be deleted), and ideally within a week (deletion window for unactivated algoPINs). The system refuses to issue earlier and lists the stay as "issue due on …".
- **24 h activation**: a stay longer than 24 h must see its first entry within 24 h of the start. If not, the credential shows **Activation missed**, and the operator can re-issue with the next variance (1–3).
- **Revocation**: normal check-out needs **no job** (the window ends). Early check-out, cancellation and extension use **job 5** with the stored PIN.

## 4. Workflows

1. **Map a room.** Operator names a room and picks its lock from the discovered, allowlisted, algoPIN-capable devices (Bridge taken from the topology).
2. **Create a stay.** Room, booking reference (no guest name or phone in Slice 2), check-in, check-out. Timezone = the property's (Asia/Jakarta).
3. **Issue access.** A button on the stay ("Issue PIN") with a typed confirmation, when the stay is within the issue window. The PIN is shown once, and stored encrypted (see §10, D1).
4. **Guest arrives.** The first matching lock log turns the credential to **Active (used at hh:mm)**; later uses are listed.
5. **Early check-out / cancellation.** "Revoke now" sends job 5 and follows the job to 0 / 3 (revoked) or failure / unknown (retry offered). The Bridge must be online; if it is offline (406), the stay shows "Revoke blocked: Bridge offline" and the PIN still expires at its end.
6. **Extension.** Issue a new PIN for the new window, then revoke the old one (algoPINs cannot be edited). The operator must give the guest the new PIN.
7. **Normal check-out.** No action; at the end hour the credential shows **Expired**.

## 5. States (only from evidence)

`planned` → `issued` → `active` (first use seen) → `expired` at the end.
Side paths: `activation_missed`; `revoke_requested` → `revoked` (job 5 → 0 or 3) | `revoke_failed` (4xx/5xx or other status) | `revoke_unknown` (job expired without a result); `issue_failed`.

Anything derived from a webhook carries the evidence label `UNVERIFIED` until the signature public key is configured (§9).

## 6. Data (SQLite, local)

| Table | Fields | Notes |
|---|---|---|
| `rooms` | id, name, device_id, bridge_id, time_zone, created_at | device IDs full (local file), UI shows display IDs |
| `stays` | id, room_id, booking_ref, check_in, check_out, status, created_by, created_at, cancelled_at | booking_ref only, no guest PII |
| `stay_credentials` | id, stay_id, kind (algopin_hourly / algopin_daily / custom), window start/end, variance, pin_id, pin_fingerprint, **pin_ciphertext** (D1), state, issued_at, first_use_at, revoke_job_id, updated_at | PIN only as AES-256-GCM ciphertext (key `IOT_PMS_PIN_KEY` in `.env`), never in logs or API-call excerpts |
| `audit_events` | id, at, actor, stay_id, action, result, detail (redacted) | every issue, reveal, revoke, cancel, extend |

Reuses `provider_jobs` for job 5, `webhook_events` for first use, and `access_codes` logic for fingerprint matching.

## 7. Screens

- **Rooms**: list and map (room → lock → Bridge); health from Slice 1 (battery, last event, Bridge status).
- **Stays**: a timeline per room (today and the next 14 days) plus a list; filters: arriving today, in house, departing, needs action.
- **Stay detail**: window, credential card with state timeline (issued → used → expired/revoked), actions: Issue, Reveal again (reason required, audited), Revoke now, Extend, Cancel.
- **Needs action**: activation missed, revoke failed/unknown, issue due, Bridge offline for a room with a revoke pending.
- All codes use the `<Code>` hints; every screen gets a Developer panel.

## 8. Milestones

| # | Milestone | Exit criteria |
|---|---|---|
| S2.1 | Rooms and mapping | Room mapped to Doorlock from discovered devices; guards reused (allowlist, algoPIN-capable, Bridge link) |
| S2.2 | Stays (create, edit, cancel, timeline) | Window rules from §3 enforced in form and server; tests |
| S2.3 | Issue PIN for a stay (+ encryption, reveal with reason, audit) | E17: issue for a 2 h stay, enter on the lock, becomes Active |
| S2.4 | Activation tracking and "needs action" | E18: a > 24 h stay not entered in time → Activation missed → re-issue v2 |
| S2.5 | Revoke: early check-out and cancellation (job 5), retry, unknown handling | E19: revoke an active stay → PIN refused on the lock; revoke with Bridge unplugged → blocked, then retry |
| S2.6 | Extension | E20: extend → new PIN works, old PIN refused |
| S2.7 | Review and experiment records | All states seen on hardware or marked untested; plan progress log |

Estimate: about 4–5 working days plus door-side test time (≈ 1 hour per experiment). Fits before 2026-10-17 if started this week.

## 9. Security and safety

- Operator role for every mutating action; viewers see stays and states only.
- Flags: `IGLOOHOME_ENABLE_ALGOPIN` and `IGLOOHOME_ENABLE_PIN_JOBS` (existing); allowlist (existing).
- PIN at rest: AES-256-GCM, 32-byte key from `IOT_PMS_PIN_KEY` (fail fast if missing when stays are enabled); decrypted only for revoke and for an audited "reveal". Never logged; the redaction tests are extended to ciphertext columns.
- **Webhook signature is still not verified** (public key pending from igloohome support). The webhook URL is public, so a forged "PIN used" event could fake an arrival. Slice 2 shows webhook-derived states as `UNVERIFIED`; before any real guest use, `IGLOOHOME_WEBHOOK_REQUIRE_VALID_SIGNATURE=true` is mandatory.
- Test devices only; no lock/unlock jobs; no real guests.

## 10. Decisions needed from you

| # | Decision | Recommendation |
|---|---|---|
| D1 | Store the PIN encrypted (needed to revoke early and to re-show it to a guest who lost it)? | **Yes**, AES-256-GCM with a key in `.env` |
| D2 | Default credential | **Hourly algoPIN**; custom PIN only as fallback |
| D3 | When is the PIN issued? | **Operator clicks "Issue PIN"** when due (a "due" list helps); automatic scheduling later (it needs a background job, which Slice 2 avoids) |
| D4 | Guest data | **Booking reference only**; no names or phone numbers until there is a real need and a retention rule |
| D5 | Normal check-out | **No job**; rely on expiry. Job 5 only for early check-out, cancellation, extension |
| D6 | Unverified webhooks in the lab | **Allowed for Slice 2 testing**, shown as UNVERIFIED; mandatory signature before real guests |

## 11. Out of scope (Slice 2)

Integration with a real PMS or booking engine; sending PINs by SMS/e-mail/WhatsApp; guest names and contact data; housekeeping and maintenance codes; iglooKey; multiple rooms in production; automatic scheduling; lock/unlock; the switch and keypad jobs (E15/E16); deployment beyond the lab.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Trial ends before Slice 2 is verified | Ask igloohome support now; S2.3–S2.5 first |
| Revoke impossible when the Bridge is offline at check-out | Algo window still expires; state "Revoke blocked" + retry; Bridge health visible |
| Guest arrives > 24 h after start on a long stay | Activation-missed detection + re-issue with next variance |
| A job expires with no result | `revoke_unknown`, re-send offered; never shown as revoked |
| Forged webhook events | UNVERIFIED label; signature mandatory before real use |
| Lost encryption key | PINs cannot be revoked early (they still expire); document key backup |
