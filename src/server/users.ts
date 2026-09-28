import "server-only";

import bcrypt from "bcryptjs";

import type { AuthConfig } from "./config";
import type { Role } from "./domain/models";
import { and, count, desc, eq, ne, sql } from "drizzle-orm";

import { getDb, isUniqueViolation, iso, type Db } from "./storage/db";
import { auditEvents, users } from "./storage/schema";

// Accounts and audit trail (plan F2). Every function takes an optional Db so tests run on PGlite.

export const ROLES: Role[] = ["viewer", "operator", "super_admin"];
export const PASSWORD_MIN = 12;

export interface User {
  id: number;
  username: string;
  displayName: string;
  email?: string;
  role: Role;
  status: "active" | "disabled";
  mustChangePassword: boolean;
  createdAt: string;
  createdBy?: string;
  lastLoginAt?: string;
  hasPassword: boolean;
}

type UserRow = typeof users.$inferSelect;

function toUser(r: UserRow): User {
  return {
    id: r.id,
    username: r.username,
    displayName: r.displayName,
    email: r.email ?? undefined,
    role: r.role,
    status: r.status,
    mustChangePassword: r.mustChangePassword,
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdBy ?? undefined,
    lastLoginAt: iso(r.lastLoginAt),
    hasPassword: Boolean(r.passwordHash),
  };
}

export function checkPassword(password: string, username: string): string | undefined {
  if (password.length < PASSWORD_MIN) return `At least ${PASSWORD_MIN} characters`;
  if (password.toLowerCase().includes(username.toLowerCase())) return "Must not contain the username";
  return undefined;
}

export function checkUsername(username: string): string | undefined {
  return /^[a-z0-9][a-z0-9._-]{2,31}$/i.test(username) ? undefined : "3–32 characters: letters, digits, . _ -";
}

/** Short random password for resets; shown once to the super-admin, then must be changed. */
export function temporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; // no look-alikes
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export async function audit(actor: string, action: string, target?: string, detail?: string, db?: Db) {
  await (db ?? (await getDb())).insert(auditEvents).values({ actor, action, target: target ?? null, detail: detail ?? null });
}

export async function listAudit(limit = 50, db?: Db) {
  const rows = await (db ?? (await getDb())).select().from(auditEvents).orderBy(desc(auditEvents.at), desc(auditEvents.id)).limit(limit);
  return rows.map((r) => ({ id: r.id, at: r.at.toISOString(), actor: r.actor, action: r.action, target: r.target ?? undefined, detail: r.detail ?? undefined }));
}

export async function listUsers(db?: Db): Promise<User[]> {
  const rows = await (db ?? (await getDb())).select().from(users).orderBy(desc(users.role), sql`lower(${users.username})`);
  return rows.map(toUser);
}

export async function findUserById(id: number, db?: Db): Promise<User | undefined> {
  const [row] = await (db ?? (await getDb())).select().from(users).where(eq(users.id, id));
  return row ? toUser(row) : undefined;
}

export async function findUserByEmail(email: string, db?: Db): Promise<User | undefined> {
  const [row] = await (db ?? (await getDb())).select().from(users).where(sql`lower(${users.email}) = lower(${email})`);
  return row ? toUser(row) : undefined;
}

/** Username + password check. Always runs bcrypt, so timing does not reveal whether the username exists. */
export async function verifyPassword(username: string, password: string, db?: Db): Promise<User | undefined> {
  const [row] = await (db ?? (await getDb())).select().from(users).where(sql`lower(${users.username}) = lower(${username})`);
  const ok = await bcrypt.compare(password, row?.passwordHash ?? dummyHash());
  if (!ok || !row || row.status !== "active") return undefined;
  return toUser(row);
}
// Real bcrypt hash of a random value, made once: comparing against it costs the same as a real account.
let dummy: string | undefined;
const dummyHash = () => (dummy ??= bcrypt.hashSync(crypto.randomUUID(), 12));

export async function recordLogin(id: number, db?: Db) {
  await (db ?? (await getDb())).update(users).set({ lastLoginAt: sql`now()` }).where(eq(users.id, id));
}

export type AccountResult = { ok: true; user: User; temporaryPassword?: string } | { ok: false; reason: string };

export async function createUser(
  input: { username: string; displayName: string; role: Role; email?: string },
  actor: string,
  db?: Db,
): Promise<AccountResult> {
  const d = db ?? (await getDb());
  const username = input.username.trim();
  const invalid = checkUsername(username) ?? (ROLES.includes(input.role) ? undefined : "Unknown role");
  if (invalid) return { ok: false, reason: invalid };
  const password = temporaryPassword();
  try {
    const [row] = await d
      .insert(users)
      .values({
        username,
        displayName: input.displayName.trim() || username,
        email: input.email?.trim() || null,
        passwordHash: await bcrypt.hash(password, 12),
        role: input.role,
        mustChangePassword: true,
        createdBy: actor,
      })
      .returning();
    await audit(actor, "user.create", username, `role ${input.role}`, d);
    return { ok: true, user: toUser(row), temporaryPassword: password };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "That username or e-mail is already used" };
    throw error;
  }
}

async function activeSuperAdmins(d: Db, exceptId: number): Promise<number> {
  const [{ n }] = await d
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.role, "super_admin"), eq(users.status, "active"), ne(users.id, exceptId)));
  return n;
}

/** Role, status or name change. Refuses to lock the system out: nobody changes themselves, and one active super-admin always remains. */
export async function updateUser(
  id: number,
  change: { role?: Role; status?: User["status"]; displayName?: string },
  actor: { id?: number; name: string },
  db?: Db,
): Promise<AccountResult> {
  const d = db ?? (await getDb());
  const user = await findUserById(id, d);
  if (!user) return { ok: false, reason: "No such user" };
  if (actor.id === id && (change.role || change.status)) return { ok: false, reason: "You cannot change your own role or status" };
  if (change.role && !ROLES.includes(change.role)) return { ok: false, reason: "Unknown role" };
  const losesSuperAdmin = user.role === "super_admin" && ((change.role && change.role !== "super_admin") || change.status === "disabled");
  if (losesSuperAdmin && (await activeSuperAdmins(d, id)) === 0) return { ok: false, reason: "At least one active super-admin must remain" };

  const [row] = await d
    .update(users)
    .set({ role: change.role, status: change.status, displayName: change.displayName?.trim() || undefined, updatedAt: sql`now()` }) // undefined = unchanged
    .where(eq(users.id, id))
    .returning();
  const what = [change.role && `role ${user.role} → ${change.role}`, change.status && `status → ${change.status}`, change.displayName && "name"].filter(Boolean).join(", ");
  await audit(actor.name, "user.update", user.username, what, d);
  return { ok: true, user: toUser(row) };
}

export async function resetPassword(id: number, actor: string, db?: Db): Promise<AccountResult> {
  const d = db ?? (await getDb());
  const password = temporaryPassword();
  const [row] = await d
    .update(users)
    .set({ passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true, updatedAt: sql`now()` })
    .where(eq(users.id, id))
    .returning();
  if (!row) return { ok: false, reason: "No such user" };
  await audit(actor, "user.reset_password", row.username, undefined, d);
  return { ok: true, user: toUser(row), temporaryPassword: password };
}

export async function changeOwnPassword(id: number, current: string, next: string, db?: Db): Promise<AccountResult> {
  const d = db ?? (await getDb());
  const user = await findUserById(id, d);
  if (!user) return { ok: false, reason: "No such user" };
  if (!(await verifyPassword(user.username, current, d))) return { ok: false, reason: "Current password is wrong" };
  const weak = checkPassword(next, user.username) ?? (next === current ? "Choose a new password" : undefined);
  if (weak) return { ok: false, reason: weak };
  const [row] = await d
    .update(users)
    .set({ passwordHash: await bcrypt.hash(next, 12), mustChangePassword: false, updatedAt: sql`now()` })
    .where(eq(users.id, id))
    .returning();
  await audit(user.username, "user.change_password", user.username, undefined, d);
  return { ok: true, user: toUser(row) };
}

/** First start with an empty users table: the .env fallback account becomes the first super-admin (Q7). */
export async function ensureBootstrap(config: AuthConfig, db?: Db): Promise<"created" | "exists" | "no_fallback"> {
  const d = db ?? (await getDb());
  const [{ n }] = await d.select({ n: count() }).from(users);
  if (n > 0) return "exists";
  if (!config.fallback) return "no_fallback";
  await d
    .insert(users)
    .values({ username: config.fallback.username, displayName: config.fallback.username, passwordHash: config.fallback.passwordHash, role: "super_admin", createdBy: "bootstrap" })
    .onConflictDoNothing();
  await audit("bootstrap", "user.create", config.fallback.username, "role super_admin (from .env fallback)", d);
  return "created";
}
