import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { DevPanel } from "@/components/developer/dev-panel";
import { FadeIn } from "@/components/motion";
import { PeopleConsole } from "@/components/people-console";
import { CeilingCard } from "@/components/user-scopes";
import { allAssignedScopes, getCeiling } from "@/server/application/scopes";
import { atLeast } from "@/server/domain/models";
import { listAudit, listUsers } from "@/server/users";

import { createUserAction, resetPasswordAction, setUserScopesAction, syncScopesAction, updateUserAction } from "./actions";

export const metadata: Metadata = { title: "People · iot-pms" };

export default async function PeoplePage() {
  const session = await auth();
  if (!atLeast(session?.user?.role, "super_admin")) notFound(); // hidden from operators and viewers
  const [users, events, ceiling, scopes] = await Promise.all([listUsers(), listAudit(25), getCeiling(), allAssignedScopes()]);

  return (
    <div className="flex flex-col gap-6">
      <FadeIn>
        <p className="text-sm font-medium text-primary">Super-admin</p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">People</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Accounts that can sign in to iot-pms. New accounts get a temporary password that must be changed on first sign-in.
        </p>
      </FadeIn>
      <PeopleConsole
        users={users}
        events={events}
        selfId={session?.user?.uid}
        create={createUserAction}
        update={updateUserAction}
        reset={resetPasswordAction}
        scopes={scopes}
        ceiling={ceiling.scopes}
        saveScopes={setUserScopesAction}
        aside={<CeilingCard key="ceiling" ceiling={ceiling} sync={syncScopesAction} />}
      />
      <DevPanel operations={["serverHealth"]}
        note="Accounts, scopes and the audit trail are stored in Postgres (users, user_scopes, scope_syncs, audit_events). Sync calls server-health with a token requested without a scope list." />
    </div>
  );
}
