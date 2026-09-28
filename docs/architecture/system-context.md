# System context — iot-pms and Bobobox AU

Decided with the user on 2026-09-26 (foundation plan, `docs/plans/iot-pms-platform-foundation-plan.md`).

## 1. What iot-pms is

iot-pms is the **device management service** in front of the igloohome API, and a working **showcase of every igloohome device and API** we use. It is the system that knows, for every physical device:

- what it is (lock, keypad, switch/bed lock, Bridge), its health and its events;
- **which cabin or room** it belongs to;
- which **PINs** exist on it, who created them, and whether they are active, revoked or expired;
- which igloohome **jobs** were sent to it, and their results.

## 2. What iot-pms is not

Reservations, stays, guests, check-in/out, billing, deposits, housekeeping and notifications belong to **Bobobox AU**, a separate application. Its knowledge base is `Desktop/BOBOBOX/backend/Inter/bobobox-au-architecture`; the PRD is `knowledge/00-source-of-truth/bobobox-au-guest-journey-prd-v2.md`. Bobobox AU is a modular monolith with 15 bounded contexts, and DDD is mandatory there.

## 3. How the two relate

```
                  Bobobox AU (DDD)                              iot-pms                       igloohome
┌─────────────────────────────────────────┐        ┌────────────────────────────┐      ┌─────────────┐
│ C2 Reservation ──▶ C1 Access (core)     │  API   │ devices · cabins/rooms     │ REST │ igloohome   │
│                    CredentialSet        │──ACL──▶│ PIN vault · jobs · events  │─────▶│ API + Bridge│
│ C6 Commerce (bed PIN) · C14 Audit       │        │ (= X3 "LOCK PLATFORM")     │◀─────│ webhooks    │
└─────────────────────────────────────────┘        └────────────────────────────┘      └─────────────┘
```

- In Bobobox AU's context map, **X3 "LOCK PLATFORM" is upstream of C1 Access, marked "ACL required, tier-0"**. iot-pms is that platform.
- Bobobox AU owns the **meaning** of a credential: `PinIssued → PinActivated → PinRevoked` (FR-501), plus bed-lock PINs (FR-503) and invariants such as "full attribution for every PIN on any lock" (FR-504).
- iot-pms owns the **device truth**: what is really on each lock, what igloohome answered, what the lock logged.
- Bobobox AU talks to iot-pms **through its API only**, behind its own anti-corruption layer. The published API is designed once Bobobox AU's DDD work fixes the X3 contract (plan §8, option C).

## 4. Data

- One Postgres server on Docker (Colima), shared by both apps, with **separate databases and separate roles**: `iot_pms` now, and a database for Bobobox AU later.
- **No cross-database reads or shared tables.** A fact Bobobox AU needs from iot-pms comes through the API.
- PINs are stored in iot-pms only, encrypted (AES-256-GCM). Plain text is readable by the super-admin role only; every reveal is audited.

## 5. Internal structure

iot-pms is an integration service (a supporting subdomain from Bobobox AU's point of view). It keeps its layered structure:

```
igloohome adapter (client, schemas, redaction, errors) → application use cases → storage
```

This is deliberately **not** full DDD. Names that Bobobox AU's DDD work will settle ("admin" vs "operator", credential vocabulary) are kept as simple labels until then.
