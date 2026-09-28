import { KeyRound, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";

import { auth } from "@/auth";
import { callerOf } from "@/server/application/scopes";
import { AccessCodeList } from "@/components/access-code-list";
import { AlgoPinForm } from "@/components/algopin-form";
import { PinJobForm } from "@/components/pin-job-form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DevPanel } from "@/components/developer/dev-panel";
import { FadeIn } from "@/components/motion";
import { EvidenceBadge } from "@/components/visuals";
import { algoPinTargets, listAccessCodes } from "@/server/application/access-codes";
import { pinJobTargets } from "@/server/application/pin-jobs";
import { listVault, vaultEnabled } from "@/server/application/pin-vault";
import { atLeast } from "@/server/domain/models";
import { PinVaultList } from "@/components/pin-vault-list";
import { deviceNames } from "@/server/application/dashboard";
import { getIgloohomeConfig } from "@/server/config";

import { createAlgoPinAction, createCustomPinAction, deletePinAction, revealPinAction, revokePinAction, vaultStatusesAction } from "./actions";

export const metadata: Metadata = { title: "Access · iot-pms" };

export default async function AccessPage() {
  const session = await auth();
  const caller = await callerOf(session?.user?.role, session?.user?.uid);
  const [targets, pinTargets, codes, names, vault] = await Promise.all([
    algoPinTargets(caller),
    pinJobTargets(caller),
    listAccessCodes(100), // filtered in the browser; ponytail: per-code log lookups, move filters server-side past a few hundred
    deviceNames(),
    listVault(),
  ]);
  const enabled = getIgloohomeConfig()?.enableAlgoPin;

  return (
    <div className="flex flex-col gap-6">
      <FadeIn>
        <p className="flex items-center gap-2 text-sm font-medium text-primary">
          <KeyRound className="size-4" aria-hidden /> M5 · credential experiments
        </p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Access codes</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          algoPINs are computed by igloohome and checked by the lock offline: no Bridge needed. Rules from the docs <EvidenceBadge level="DOC" />
        </p>
      </FadeIn>

      {!enabled && (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p>
            Creating algoPINs is off. Set <span className="font-mono">IGLOOHOME_ENABLE_ALGOPIN=true</span> and restart; each person also needs the{" "}
            <span className="font-mono">algopin-*</span> scopes (People → Scopes).
          </p>
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <Tabs defaultValue="algopin" className="min-w-0 gap-4">
          <div className="-mx-4 overflow-x-auto px-4 py-1 [scrollbar-width:none] md:mx-0 md:px-1">
            <TabsList className="h-10! w-max">
              <TabsTrigger value="algopin" className="h-8 px-3">algoPIN · no Bridge</TabsTrigger>
              <TabsTrigger value="custom" className="h-8 px-3">Custom PIN · Bridge</TabsTrigger>
              <TabsTrigger value="delete" className="h-8 px-3">Delete PIN · Bridge</TabsTrigger>
              <TabsTrigger value="vault" className="h-8 px-3">
                PIN vault · {vault.length}
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="algopin">
            <AlgoPinForm targets={targets} issue={createAlgoPinAction} />
          </TabsContent>
          <TabsContent value="custom">
            <PinJobForm mode="create" targets={pinTargets} create={createCustomPinAction} remove={deletePinAction} />
          </TabsContent>
          <TabsContent value="delete">
            <PinJobForm mode="delete" targets={pinTargets} create={createCustomPinAction} remove={deletePinAction} />
          </TabsContent>
          <TabsContent value="vault">
            <PinVaultList
              entries={vault}
              names={names}
              superAdmin={atLeast(session?.user?.role, "super_admin")}
              enabled={vaultEnabled()}
              reveal={revealPinAction}
              revoke={revokePinAction}
              poll={vaultStatusesAction}
            />
          </TabsContent>
        </Tabs>
        <AccessCodeList codes={codes} names={names} />
      </div>

      <DevPanel operations={["listPinCapableDevices", "createAlgoPin", "createPinJob", "getJob"]} />
    </div>
  );
}
