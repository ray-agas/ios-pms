"use server";

import { callerOf } from "@/server/application/scopes";

import { cookies } from "next/headers";

import { auth } from "@/auth";
import { atLeast } from "@/server/domain/models";
import { recentApiCalls, tryOperation, type CallRow, type TryItResult } from "@/server/application/dashboard";
import { startHealthCheck } from "@/server/application/health-check";
import { deletePin } from "@/server/application/pin-jobs";
import { runRemoteLock } from "@/server/application/remote-lock";

/** Supported proxied job types a super-admin may send from Try it. 4 (create PIN) lives on Access (needs dates);
 * types the docs mark "Not supported" (3, 14, 16, 18, 19, 24, 29) are never sent. */
const SUPER_ADMIN_JOB_TYPES = ["1", "2", "5", "9", "10", "15"];
import { DEV_MODE_COOKIE, isDeveloperMode } from "@/server/dev-mode";
import { CATALOG_BY_ID } from "@/server/igloohome/catalog";

export async function runTryIt(operation: string, params: Record<string, string>): Promise<TryItResult> {
  const session = await auth();
  if (!session?.user || !atLeast(session.user.role, "operator")) {
    return { ok: false, operation: String(operation), outcome: "forbidden_operation", message: "Operator role required" };
  }
  // Arguments come from the browser: pass on plain string values only; the catalog schema validates the rest.
  const clean = Object.fromEntries(
    Object.entries(params && typeof params === "object" ? params : {}).filter(([, value]) => typeof value === "string"),
  );
  // Job operations run through the same guarded use cases as the rest of the app (flags, registry, scopes, rates,
  // reason + password where needed). Operators: jobs 9/10. Super-admins: every supported proxied job (plan G1).
  if (operation === "createProxiedJob" || operation === "createBridgeDiagnosticsJob") {
    const caller = await callerOf(session.user.role, session.user.uid);
    const actor = session.user.email ?? session.user.name ?? "unknown";
    const deviceRef = String(clean.deviceId ?? "");
    const confirm = { reason: clean.reason ?? "", password: clean.password ?? "" };
    const superAdmin = atLeast(session.user.role, "super_admin");
    const type = operation === "createBridgeDiagnosticsJob" ? "diag" : clean.jobType;
    const allowedTypes = superAdmin ? SUPER_ADMIN_JOB_TYPES : ["9", "10"];
    if (type !== "diag" && !allowedTypes.includes(type ?? "")) {
      return { ok: false, operation, outcome: "validation", message: `jobType must be one of ${allowedTypes.join(", ")}` };
    }
    let result: { ok: true; id: number } | { ok: false; reason: string; id?: number };
    if (type === "1" || type === "2") {
      result = await runRemoteLock({ deviceRef, action: type === "1" ? "lock" : "unlock", reason: confirm.reason, password: confirm.password, caller, uid: session.user.uid, actor });
    } else if (type === "5") {
      result = await deletePin({ deviceRef, pin: clean.pin ?? "", caller, actor, confirm, uid: session.user.uid });
    } else {
      const kind = type === "diag" ? "bridge_diagnostics" : type === "9" ? "lock_battery" : type === "10" ? "lock_status" : "pull_logs";
      result = await startHealthCheck({ deviceRef, kind, caller, actor, confirm, uid: session.user.uid });
    }
    return result.ok
      ? { ok: true, operation, status: 200, outcome: "ok", decoded: "Queued at the Bridge (not done yet)", jobUrl: `/jobs/${result.id}` }
      : { ok: false, operation, outcome: "rejected", message: result.reason, jobUrl: result.id ? `/jobs/${result.id}` : undefined };
  }
  return tryOperation(String(operation), clean);
}

export async function setDeveloperMode(on: boolean) {
  if (!(await auth())?.user) return;
  (await cookies()).set(DEV_MODE_COOKIE, on ? "1" : "0", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
}

/** Latest calls for the "Behind this screen" panel. Signed-in users with Developer panels on; catalog ids only. */
export async function recentCallsAction(operations: string[]): Promise<CallRow[]> {
  if (!(await auth())?.user || !(await isDeveloperMode())) return [];
  const ops = (Array.isArray(operations) ? operations : []).filter((op) => typeof op === "string" && CATALOG_BY_ID.has(op)).slice(0, 20);
  return ops.length ? recentApiCalls({ operations: ops, limit: 8 }) : [];
}
