import "server-only";

import { desc, eq } from "drizzle-orm";
import { cache } from "react";

import { effectiveScopes, READ_SCOPES, SCOPE_BY_NAME, shortScope } from "@/lib/scopes";

import { getIgloohomeConfig } from "../config";
import { atLeast, type Role } from "../domain/models";
import { getDb, type Db } from "../storage/db";
import { scopeSyncs, userScopes, users } from "../storage/schema";
import { audit } from "../users";

// Per-user igloohome scopes (plan F3).
// - Ceiling: what igloohome grants our client (synced from server-health). A super-admin always has all of it.
// - Everyone else: the read scopes (Q5) plus what a super-admin assigned, never beyond the ceiling.
// iot-pms checks these before every operation, and the call itself uses a token requested with exactly these
// scopes, so igloohome enforces them too.

export interface Ceiling {
  scopes: string[];
  source: "sync" | "env";
  syncedAt?: string;
  syncedBy?: string;
}

/** The latest sync, or IGLOOHOME_SCOPES until the first one. */
export async function getCeiling(db?: Db): Promise<Ceiling> {
  const [row] = await (db ?? (await getDb())).select().from(scopeSyncs).orderBy(desc(scopeSyncs.id)).limit(1);
  if (row) return { scopes: row.scopes, source: "sync", syncedAt: row.syncedAt.toISOString(), syncedBy: row.syncedBy };
  return { scopes: getIgloohomeConfig()?.scopes ?? [], source: "env" };
}

/** Stores a ceiling read from igloohome and records what changed. */
export async function recordSync(scopes: string[], actor: string, db?: Db): Promise<{ added: string[]; removed: string[] }> {
  const d = db ?? (await getDb());
  const before = (await getCeiling(d)).scopes;
  const next = [...new Set(scopes)].sort();
  await d.insert(scopeSyncs).values({ scopes: next, syncedBy: actor });
  const added = next.filter((x) => !before.includes(x));
  const removed = before.filter((x) => !next.includes(x));
  await audit(actor, "scopes.sync", undefined, `${next.length} granted${diffText(added, removed)}`, d);
  return { added, removed };
}

export async function assignedScopes(userId: number, db?: Db): Promise<string[]> {
  const rows = await (db ?? (await getDb())).select({ scope: userScopes.scope }).from(userScopes).where(eq(userScopes.userId, userId));
  return rows.map((r) => r.scope).sort();
}

export async function allAssignedScopes(db?: Db): Promise<Record<number, string[]>> {
  const rows = await (db ?? (await getDb())).select().from(userScopes);
  const out: Record<number, string[]> = {};
  for (const r of rows) (out[r.userId] ??= []).push(r.scope);
  return out;
}

export type ScopeResult = { ok: true; scopes: string[] } | { ok: false; reason: string };

/** Replaces a user's assigned scopes. Read scopes are implicit; super-admins always have the whole ceiling. */
export async function setUserScopes(userId: number, scopes: string[], actor: string, db?: Db): Promise<ScopeResult> {
  const d = db ?? (await getDb());
  const [user] = await d.select().from(users).where(eq(users.id, userId));
  if (!user) return { ok: false, reason: "No such user" };
  if (user.role === "super_admin") return { ok: false, reason: "A super-admin always has every scope igloohome grants us" };
  const unknown = scopes.filter((x) => !SCOPE_BY_NAME.has(x));
  if (unknown.length) return { ok: false, reason: `Unknown scope: ${unknown.map(shortScope).join(", ")}` };

  const next = [...new Set(scopes)].filter((x) => !READ_SCOPES.includes(x)).sort();
  const before = await assignedScopes(userId, d);
  const added = next.filter((x) => !before.includes(x));
  const removed = before.filter((x) => !next.includes(x));
  if (!added.length && !removed.length) return { ok: true, scopes: next };

  await d.transaction(async (tx) => {
    await tx.delete(userScopes).where(eq(userScopes.userId, userId));
    if (next.length) await tx.insert(userScopes).values(next.map((scope) => ({ userId, scope, grantedBy: actor })));
    await audit(actor, "user.scopes", user.username, diffText(added, removed).replace(/^ · /, ""), tx as unknown as Db);
  });
  return { ok: true, scopes: next };
}

export interface Caller {
  role?: Role;
  /** What this user may use (and what their igloohome token will carry). */
  scopes: string[];
  ceiling: string[];
  /** Plan G1: super-admin with IGLOOHOME_ENABLE_EXPERIMENTS=true. */
  experiments?: boolean;
}

/** The signed-in user's role and scopes, once per request. The break-glass .env account (no uid) is a super-admin. */
export const callerOf = cache(async (role: Role | undefined, uid: number | undefined): Promise<Caller> => {
  const ceiling = (await getCeiling()).scopes;
  const assigned = uid && !atLeast(role, "super_admin") ? await assignedScopes(uid) : [];
  const experiments = atLeast(role, "super_admin") && Boolean(getIgloohomeConfig()?.enableExperiments);
  return { role, scopes: effectiveScopes(role, assigned, ceiling), ceiling, experiments };
});

function diffText(added: string[], removed: string[]) {
  const parts = [added.length && `+${added.map(shortScope).join(", +")}`, removed.length && `-${removed.map(shortScope).join(", -")}`].filter(Boolean);
  return parts.length ? ` · ${parts.join(" ")}` : "";
}
