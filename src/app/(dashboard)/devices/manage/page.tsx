import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { DevPanel } from "@/components/developer/dev-panel";
import { DeviceRegistryConsole } from "@/components/device-registry-console";
import { FadeIn } from "@/components/motion";
import { getSite } from "@/server/application/dashboard";
import { listManaged, listSpaces } from "@/server/application/device-registry";
import { atLeast, type DeviceKind } from "@/server/domain/models";
import { redactDeviceId } from "@/server/igloohome/redaction";
import { listAudit } from "@/server/users";

import { adoptBridgeAction, adoptDeviceAction, createSpaceAction, previewBridgeAction, revealDeviceIdAction, deleteSpaceAction, removeManagedAction, updateManagedAction } from "./actions";

export const metadata: Metadata = { title: "Manage devices · iot-pms" };

export default async function ManageDevicesPage() {
  const session = await auth();
  if (!atLeast(session?.user?.role, "super_admin")) notFound(); // Q9: registry changes are super-admin only
  const site = await getSite(); // first: fills name and kind for rows imported from the env list
  const [spaceRows, managedRows, audit] = await Promise.all([listSpaces(), listManaged(), listAudit(200)]);

  const properties = (site.data?.rooms ?? []).map((r) => ({ id: r.id, name: r.name, timezone: r.timezone }));
  const live = new Map([...(site.data?.devices ?? []), ...(site.data?.bridges ?? [])].map((d) => [d.id, d]));
  const managed = managedRows.map((m) => {
    const ref = redactDeviceId(m.deviceId);
    const view = live.get(ref);
    return {
      id: m.id,
      ref,
      name: view?.name ?? m.name ?? undefined,
      kind: (view?.kind ?? m.kind ?? "unknown") as DeviceKind,
      model: view?.modelName ?? m.model ?? undefined,
      spaceId: m.spaceId ?? undefined,
      role: m.role ?? undefined,
      status: m.status,
      onAccount: Boolean(view) || !site.data, // unknown while the live list is down
      addedBy: m.addedBy,
      addedAt: m.addedAt.toISOString(),
    };
  });
  const candidates = (site.data?.unmanaged ?? []).map((d) => ({ ref: d.id, name: d.name, kind: d.kind, model: d.modelName ?? d.modelPrefix, linked: d.linked.length }));
  const spaces = spaceRows.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    timeZone: s.timeZone ?? undefined,
    propertyName: properties.find((p) => p.id === s.propertyId)?.name,
    devices: s.devices,
    bridges: managedRows.filter((m) => m.spaceId === s.id && m.kind === "bridge").length,
  }));
  const events = audit.filter((e) => /^(device|space|registry)\./.test(e.action)).slice(0, 25);

  return (
    <div className="flex flex-col gap-6">
      <FadeIn>
        <Link href="/devices" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          <ArrowLeft className="size-3.5" aria-hidden /> Devices
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">Manage devices</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Cabins and rooms, and which paired devices iot-pms manages. Only managed, enabled devices can receive health checks, PIN jobs and algoPINs.
        </p>
      </FadeIn>
      <DeviceRegistryConsole
        spaces={spaces}
        managed={managed}
        candidates={candidates}
        properties={properties}
        events={events}
        liveError={site.error?.message}
        createSpace={createSpaceAction}
        deleteSpace={deleteSpaceAction}
        adopt={adoptDeviceAction}
        preview={previewBridgeAction}
        adoptBridge={adoptBridgeAction}
        update={updateManagedAction}
        remove={removeManagedAction}
        revealId={revealDeviceIdAction}
      />
      <DevPanel
        operations={["listDevices", "listProperties"]}
        note="The registry is stored in Postgres (spaces, managed_devices; changes in audit_events). Pairing itself happens in the igloohome app: the REST API has no pairing call."
      />
    </div>
  );
}
