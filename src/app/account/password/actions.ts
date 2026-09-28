"use server";

import { auth, signOut } from "@/auth";
import { changeOwnPassword } from "@/server/users";

export interface PasswordState {
  error?: string;
}

/** Own password change. After success the user signs in again, so the new session carries the cleared flag. */
export async function changePasswordAction(_previous: PasswordState, form: FormData): Promise<PasswordState> {
  const session = await auth();
  if (!session?.user?.uid) return { error: "The .env break-glass account has no stored password; change it in .env" };
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  if (next !== String(form.get("confirm") ?? "")) return { error: "The new passwords do not match" };
  const result = await changeOwnPassword(session.user.uid, current, next);
  if (!result.ok) return { error: result.reason };
  await signOut({ redirectTo: "/login?changed=1" });
  return {};
}
