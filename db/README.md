# Database

Postgres 17 on Docker (Colima), `docker-compose.yml` at the repo root.

- Start: `colima start` (once per boot), then `docker compose up -d db`.
- The app connects with `DATABASE_URL` (in `.env`, as role `iot_pms`, database `iot_pms`).
- The schema is Drizzle ORM (`src/server/storage/schema.ts`). To change it: edit `schema.ts`, run `bun run db:generate` (writes SQL into `db/migrations/`), and review that SQL before committing it.
- Migrations run automatically when the app opens the database, and with `bun run db:migrate`. Drizzle records them in `drizzle.__drizzle_migrations`.
- `bunx drizzle-kit check` checks the migration files for consistency. Tests use PGlite with the same migrations (`tests/helpers/db.ts`).
- `db/init/*.sh` runs only when the data volume is empty.

## Adding another app's database later (e.g. Bobobox AU)

The server is shared, but every app gets its own database and role, and no app reads another app's tables. As the superuser:

```sql
CREATE ROLE bobobox_au LOGIN PASSWORD '…';
CREATE DATABASE bobobox_au OWNER bobobox_au;
REVOKE ALL ON DATABASE bobobox_au FROM PUBLIC;
```

## Reset (deletes all data)

`docker compose down -v`, then `docker compose up -d db`.
