# EXP-20260928-01 — Switch (SW1X) and keypad (EK2X): every supported Bridge job (G1: E10b, E15, E16, U20)

- **Date:** 2026-09-27, 22:39–23:59 Asia/Jakarta
- **Operator:** the user, as super-admin, with `IGLOOHOME_ENABLE_EXPERIMENTS=true`. Runs came from the Emergency panel, Access (algoPIN and custom PIN) and Developer → Try it; each experiment had a reason and a password.
- **Target:** `switch-bedlock` `SW1X••••••30` and `Keypad-Bedlock` `EK2X••••••81`, both on Bridge `EB1X••••••32` (bench, not fitted). The keypad is linked to the switch.
- **Evidence:** `provider_jobs` #74–#99 (`experimental = true`), job-complete webhooks, activity logs (webhook type 5), vault rows 2–7, and the user's observations.
- **Background:** igloohome documents Bridge proxied jobs for locks only. SW1X is not algoPIN-capable per the docs; EK2X is missing from the docs' device table but listed by `support-pins` (U19).

## 1. Results

| Job | Switch SW1X | Keypad EK2X |
|---|---|---|
| 9 battery | **works** (#94, result 0) | **works** (#86, result 0) |
| 10 status | **works** (#95, 0) | no result (#87, #88 expired) |
| 2 unlock | **works**: the bedlock opens (#74, #81, #96) | result 0 but **nothing moves** (#76, #90) |
| 1 lock | **works** (#75, #97) | result 0 but **nothing moves** (#77, #91) |
| 15 pull logs | **works** (#99, 0) | no result (#92 expired) |
| 4 custom PIN | no result (#83 expired, #84 never answered) | **works** (#82, #85, #93: log 27) |
| 5 delete PIN | no result (#98 expired) | **works** (#89: result 0, log 31) |
| algoPIN (one-time, E10b) | not capable (docs: 418) | **works**: typing it opened the switch (keypad log 20) |

## 2. Findings

| ID | Finding | Evidence |
|---|---|---|
| K1 | **The keypad holds and checks PINs; the switch is the motor.** A PIN typed on the keypad produces keypad log 19 "Unlocked with PIN" (20 for a one-time PIN), then **switch log 11** "Unlocked via Bluetooth", then **switch log 48** "Auto-relocked". The keypad commands the switch over Bluetooth. | API (logs) + HW |
| K2 | **The switch re-locks by itself 4–6 s after every unlock** (15 of 15 log pairs), whether opened remotely or with a PIN. A remote lock on the switch works, but is rarely needed. | API (logs) + HW |
| K3 | **PIN management for the bedlock = PINs on its keypad.** Custom PINs (job 4/5) and algoPINs go to EK2X. The igloohome app says the same when you create a PIN ("stored in the keypad"). The switch cannot hold PINs: jobs 4/5 to it never answer. | API + HW + app |
| K4 | **Keypad lock/unlock is accepted but does nothing physical.** The Bridge answers result 0 and the keypad logs 11 / 37 "via Bluetooth", but the keypad has no motor and the linked switch does not move. | API + HW |
| K5 | The keypad gives **no result for status (10) or pull logs (15)**; the switch answers both. The keypad's logs still arrive through the webhook. | API |
| K6 | Job-complete webhooks came 4–38 s after the POST (keypad PIN jobs about 4–5 s). | API |
| K7 | **iot-pms bug found:** the vault's revoke refused with "Give a reason" without showing a field, because deleting a keypad PIN was still treated as an experiment. Fixed (see §3). | code |

## 3. What iot-pms does with this (the user's rule: "if it works, we keep it")

- `src/lib/device-support.ts` records the table above.
  - **Works** becomes a regular feature, with no experiment flag and the normal role and scope rules. On the switch: 9, 10, 1, 2, 15. On the keypad: 4, 5, 9.
  - **No result / no effect** is refused, with the reason on hover: switch PIN jobs ("put the PIN on its keypad"), keypad lock/unlock ("no motor"), keypad 10/15 ("no result"). A super-admin with the experiment flag can still re-test these.
- Experiment badges show **No effect** for keypad lock/unlock instead of "Works".
- The vault's revoke **always** asks for a reason and the password, in visible fields, because revoking is irreversible. PINs that never reached a device show **"Not created · Never reached the device"**.
- The Overview emergency list counts a lock-type log after an unlock (e.g. the switch's auto-relock, 48) as "locked again", and is collapsible.

## 3b. Follow-up tests (2026-09-28 morning, keypad)

| Test | Result | Evidence |
|---|---|---|
| Vault revoke of a keypad PIN | works (after the K7 fix) | user |
| algoPIN hourly / daily / permanent on the keypad | all three **activated on first use** (logs 22, 22, 21 at 07:16–07:17), opened the switch | API (logs) + HW |
| Delete those algoPINs (job 5) | daily and permanent deleted (log 31 at 07:18 / 07:19), then **refused** when typed (log 16 at 07:20) | API (logs) + HW |
| Re-issue daily / permanent with the **same start hour** | igloohome returned the **same PIN** (same fingerprint) as the deleted ones. The re-issued daily was not typed afterwards | API |

| ID | Finding | Evidence |
|---|---|---|
| K8 | **algoPINs are deterministic:** the same device, type, start hour and variance give the same PIN. After a delete, re-issuing with the same parameters returns the deleted PIN, and **the device refuses it** (user, 2026-09-28, twice: a never-used PIN deleted then re-issued, and a used PIN deleted then re-issued; both "not valid"). **A deleted algoPIN is gone for good on that device**: change the start hour or variance to get a working one. | API + HW |
| K9 | **iot-pms bug:** deletes and first uses were matched by fingerprint only (any device, any time), so a re-issued code showed "Deleted from lock" / expired immediately. **Fixed:** only deletes and uses on the same device after the code was issued count. A code whose PIN was deleted from the device earlier shows **"Same PIN deleted before"**, with the explanation. Issuing such a PIN warns right away ("change the start hour or variance"). In the vault, an algoPIN deleted from the device shows **Revoked**, not Expired. | code |

**Job 15 on the Doorlock** (documented for locks): works (user, 2026-09-28). HW.

## 4. Not tried yet

- Deleting an algoPIN from the keypad **before** its first use (after first use: done, works).
- The keypad's **PIN capacity** and a **wrong-PIN lockout** (log 16 streaks), if relevant for guests.
