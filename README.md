# iot-pms

Device-management service and showcase for the igloohome smart-lock ecosystem (locks, keypads, bedlock switches, Bridges) at Bobobox: cabins and rooms, Bridge jobs, algoPINs, an encrypted PIN vault, emergency lock/unlock and a developer view of the API.

**Start here: [docs/ai-context.md](docs/ai-context.md)**, the maintained system overview for engineers and AI agents. Plans: [docs/plans/](docs/plans/) · Research and experiments: [docs/research/igloohome/](docs/research/igloohome/README.md)

Stack: Next.js 16 (App Router, TypeScript) · Auth.js v5 · Postgres 17 + Drizzle ORM · Tailwind CSS 4 · zod · **Bun** (package manager, scripts, tests). Next.js itself runs on Node.js.

## Run locally

```bash
bun install
cp .env.example .env            # never commit .env
colima start && docker compose up -d db   # Postgres (see db/README.md); set DATABASE_URL
openssl rand -base64 32         # → AUTH_SECRET, and another for IOT_PMS_PIN_KEY
bun run hash-password           # → AUTH_FALLBACK_PASSWORD_HASH_B64 (password typed hidden, never stored)
# set AUTH_FALLBACK_USERNAME, and IGLOOHOME_CLIENT_ID / IGLOOHOME_CLIENT_SECRET when available
bun run dev                     # then open http://localhost:3000 (use localhost, not 127.0.0.1)
```

The server binds to `127.0.0.1` only. Migrations run at startup. Without igloohome credentials the dashboard still starts and shows "credentials not set".

## Checks

```bash
bun run check    # next typegen + tsc, eslint, bun test
bun run build
```

Tests never call the igloohome API; they use PGlite and documented or captured examples (`tests/fixtures/igloohome/`).

## Safety

- Every Bridge job passes one server-side guard (role, feature flag, scope, device registry, device kind, one job at a time, rate limits). Risky actions (lock/unlock, pull logs, experiments, vault revoke) also need a reason and the person's password.
- Each job family has its own client method (1/2 lock/unlock, 4/5 PINs, 9/10/15 checks and logs); job types documented as "not supported" are never sent.
- Tokens, secrets and PINs are redacted from every log and call record; screens show masked device IDs. PINs are stored only encrypted (vault).
- Details: [docs/ai-context.md §13](docs/ai-context.md#13-business-rules-and-invariants-do-not-break).
