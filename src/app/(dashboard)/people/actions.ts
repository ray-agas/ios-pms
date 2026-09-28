"use server";

import { actorOf, auth } from "@/auth";
import { atLeast, type Role } from "@/server/domain/models";
import { readCeilingFromIgloohome } from "@/server/application/dashboard";
import { recordSync, setUserScopes, type ScopeResult } from "@/server/application/scopes";
import { createUser, resetPassword, updateUser, type AccountResult } from "@/server/users";

// Super-admin only (plan F2). Each action re-checks the session; the guards in users.ts refuse self-changes and
// removing the last active super-admin.

async function superAdmin() {
  const session = await auth();
  return session?.user && atLeast(session.user.role, "super_admin") ? session : undefined;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const DENIED = { ok: false, reason: "Super-admin role required" } as const;

export async function createUserAction(input: { username: string; displayName: string; role: Role; email?: string }): Promise<AccountResult> {
  const session = await superAdmin();
  if (!session) return DENIED;
  return createUser(
    { username: str(input?.username), displayName: str(input?.displayName), role: str(input?.role) as Role, email: str(input?.email) || undefined },
    actorOf(session),
  );
}

export async function updateUserAction(id: number, change: { role?: Role; status?: "active" | "disabled" }): Promise<AccountResult> {
  const session = await superAdmin();
  if (!session) return DENIED;
  const safe = {
    role: change?.role ? (str(change.role) as Role) : undefined,
    status: change?.status === "active" || change?.status === "disabled" ? change.status : undefined,
  };
  return updateUser(Number(id), safe, { id: session.user.uid, name: actorOf(session) });
}

export async function resetPasswordAction(id: number): Promise<AccountResult> {
  const session = await superAdmin();
  if (!session) return DENIED;
  if (session.user.uid === Number(id)) return { ok: false, reason: "Use Change password for your own account" };
  return resetPassword(Number(id), actorOf(session));
}

// --- igloohome scopes (plan F3) ------------------------------------------------------------------

export type SyncResult = { ok: true; count: number; added: string[]; removed: string[] } | { ok: false; reason: string };

/** Reads the ceiling from igloohome (one token without `scope`, used only for server-health) and stores it. */
export async function syncScopesAction(): Promise<SyncResult> {
  const session = await superAdmin();
  if (!session) return DENIED;
  try {
    const scopes = await readCeilingFromIgloohome();
    if (scopes.length === 0) return { ok: false, reason: "igloohome returned no scopes; the ceiling was not changed" };
    const { added, removed } = await recordSync(scopes, actorOf(session));
    return { ok: true, count: scopes.length, added, removed };
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
}

export async function setUserScopesAction(id: number, scopes: string[]): Promise<ScopeResult> {
  const session = await superAdmin();
  if (!session) return DENIED;
  return setUserScopes(Number(id), Array.isArray(scopes) ? scopes.map(str).filter(Boolean) : [], actorOf(session));
}
