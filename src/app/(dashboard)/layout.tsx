import { redirect } from "next/navigation";

import { auth, signOut } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { isDeveloperMode } from "@/server/dev-mode";

import { setDeveloperMode } from "./developer/actions";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const session = await auth();
  if (!session?.user) redirect("/login"); // proxy already guards; this keeps the layout safe on its own
  if (session.user.mustChangePassword) redirect("/account/password"); // temporary password (created or reset by a super-admin)

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <AppShell
      user={{ name: session.user.name ?? session.user.email ?? "Signed in", role: session.user.role }}
      signOutAction={signOutAction}
      devMode={await isDeveloperMode()}
      setDevMode={setDeveloperMode}
    >
      {children}
    </AppShell>
  );
}
