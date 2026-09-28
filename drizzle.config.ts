import { defineConfig } from "drizzle-kit";

// Plan F1b. `bun run db:generate` turns schema changes into SQL in db/migrations; the app applies them at startup.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/storage/schema.ts",
  out: "./db/migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
