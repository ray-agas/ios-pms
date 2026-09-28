import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { PASSWORD_MIN } from "@/server/users";

import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Change password · iot-pms" };

// Outside the dashboard layout on purpose: users with a temporary password are sent here first.
export default async function PasswordPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-3xl border bg-card p-6 shadow-xl shadow-primary/5 md:p-8">
        <header className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <KeyRound className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold">{session.user.mustChangePassword ? "Set your own password" : "Change password"}</h1>
            <p className="text-sm text-muted-foreground">
              {session.user.mustChangePassword ? "Your account has a temporary password. Choose your own to continue." : `Signed in as ${session.user.name}`}
            </p>
          </div>
        </header>
        <PasswordForm minLength={PASSWORD_MIN} />
      </div>
    </main>
  );
}
