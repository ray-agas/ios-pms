// Applies pending Drizzle migrations to DATABASE_URL (they also run automatically when the app opens the database).
import { getDb } from "@/server/storage/db";

await getDb();
console.log("migrations up to date");
process.exit(0);
