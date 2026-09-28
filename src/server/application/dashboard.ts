import "server-only";

import { and, desc, eq, gt, inArray, max } from "drizzle-orm";
import { cache } from "react";

import { getIgloohomeConfig } from "../config";
import type { ConnectionStatus, DeviceSnapshot, Evidence } from "../domain/models";
import { CATALOG_BY_ID, decodeStatus } from "../igloohome/catalog";
import { IgloohomeClient, type ApiCallRecord } from "../igloohome/client";
import type { VendorDevice } from "../igloohome/schemas";
import { JOB_STATUS_WEBHOOK, LOG_TYPES, type LogTone, type LogTypeInfo } from "../igloohome/codes";
import { ProviderError } from "../igloohome/errors";
import { toConnectionStatus, toDeviceSnapshot } from "../igloohome/mapping";
import { redactDeviceId, redactDeviceIdsInJson } from "../igloohome/redaction";
import { eventOf } from "../igloohome/webhooks";
import { TokenProvider } from "../igloohome/token";
import { listApiCalls, recordApiCall, type ApiCallView, type CallSource } from "../storage/api-calls";
import { getDb, type Db } from "../storage/db";
import { deviceState, webhookEvents } from "../storage/schema";
import { backfillFromAccount, listManaged, listSpaces, type DeviceRole, type SpaceKind } from "./device-registry";
import { READ_SCOPES, tokenScopes } from "@/lib/scopes";

import { runTryIt } from "./try-it";

// Read-only use cases for the dashboard (slice 1). No job endpoints are called from here.

export interface LoadError {
  code: ProviderError["code"] | "not_configured";
  message: string;
}

// Plan F3: one token per scope set, each requested with exactly those scopes, so igloohome enforces what iot-pms
// allows. Tokens live in memory only (a day each); a handful of distinct sets in practice.
const tokenCache = new Map<string, TokenProvider>();
const clientCache = new Map<string, IgloohomeClient>();
const keyOf = (scopes: string[]) => [...new Set(scopes)].sort().join(" ");

function tokensFor(scopes: string[]): TokenProvider {
  const key = keyOf(scopes);
  let tokens = tokenCache.get(key);
  if (!tokens) {
    tokens = new TokenProvider({ ...getIgloohomeConfig()!, scopes: key.split(" ") });
    tokenCache.set(key, tokens);
  }
  return tokens;
}

function newClient(source: CallSource, onRecord?: (record: ApiCallRecord) => void, tokens?: TokenProvider): IgloohomeClient | undefined {
  const config = getIgloohomeConfig();
  if (!config) return undefined;
  tokens ??= tokensFor(appScopes());
  return new IgloohomeClient({
    baseUrl: config.apiBaseUrl,
    tokens,
    timeoutMs: config.timeoutMs,
    onCall: (record) => {
      onRecord?.(record);
      // Inspector log is best effort: a failed insert must never fail the screen.
      void getDb()
        .then((db) => recordApiCall(db, record, source))
        .catch((error) => console.error("api_calls insert failed", (error as Error).message));
    },
  });
}

/** Scopes of the shared app client: reads only (Q5). Falls back to IGLOOHOME_SCOPES if none of them is listed there. */
function appScopes(): string[] {
  const configured = getIgloohomeConfig()?.scopes ?? [];
  const reads = READ_SCOPES.filter((x) => configured.includes(x));
  return reads.length ? reads : configured;
}

/** Shared app client for reads (calls logged with source "app"). Jobs and credentials use `igloohomeAs`. */
export function igloohome(): IgloohomeClient | undefined {
  return igloohomeAs(appScopes());
}

/**
 * Client whose token carries the caller's scopes (plan F3), minus any scope no iot-pms feature uses (master PIN,
 * eKey…): a token never holds a permission iot-pms cannot exercise. Physical scopes (lock/unlock) are left out too,
 * unless `physical` is set: only the emergency flow (plan F4b) asks for them, in a token of their own.
 */
export function igloohomeAs(scopes: string[], { physical = false } = {}): IgloohomeClient | undefined {
  const usable = tokenScopes(scopes, physical);
  if (!getIgloohomeConfig() || usable.length === 0) return undefined;
  const key = keyOf(usable);
  let client = clientCache.get(key);
  if (!client) {
    client = newClient("app", undefined, tokensFor(usable));
    if (client) clientCache.set(key, client);
  }
  return client;
}

/**
 * E21 / scope sync (plan F3): requests ONE token without `scope` (documented: every permission our client has),
 * uses it only for server-health, and drops it. Nothing else ever runs on that token.
 */
export async function readCeilingFromIgloohome(): Promise<string[]> {
  const config = getIgloohomeConfig();
  if (!config) throw new ProviderError("unavailable", "igloohome credentials are not set");
  const tokens = new TokenProvider({ ...config, scopes: [] }, fetch, Date.now, true);
  const health = await newClient("app", undefined, tokens)!.serverHealth();
  return health.scopes ?? [];
}

/**
 * Short in-process cache for account-wide lists (plan F7b): with many devices, re-reading them on every live refresh
 * would hit igloohome's rate limits. Failures are not cached.
 * ponytail: per process; a second app instance keeps its own copy (move to Postgres or Redis if we scale out).
 */
function ttlCache<T>(ms: number, load: () => Promise<T>): () => Promise<T> {
  let hit: { at: number; value: Promise<T> } | undefined;
  return () => {
    if (!hit || Date.now() - hit.at > ms) {
      const value = load();
      hit = { at: Date.now(), value };
      value.catch(() => {
        if (hit?.value === value) hit = undefined;
      });
    }
    return hit.value;
  };
}

export const LIST_TTL_MS = 60_000;
const accountDevices = ttlCache(LIST_TTL_MS, async () => ({ devices: await igloohome()!.listAllDevices(), fetchedAt: new Date().toISOString() }));
const accountProperties = ttlCache(LIST_TTL_MS, () => igloohome()!.listProperties({ limit: 300 }));

/** The account's device list, at most 60 s old; shared by the topology and health-check options. */
export const listAllDevicesOnce = cache(async () => (await accountDevices()).devices);

function toLoadError(error: unknown): LoadError {
  if (error instanceof ProviderError) return { code: error.code, message: error.message };
  return { code: "unavailable", message: "Unexpected error while contacting igloohome" };
}

// --- Connection -----------------------------------------------------------------

export interface ConnectionView extends ConnectionStatus {
  trialDaysLeft?: number;
}

export const getConnection = cache(async (): Promise<{ data?: ConnectionView; error?: LoadError }> => {
  const api = igloohome();
  if (!api) return { error: { code: "not_configured", message: "igloohome credentials are not set" } };
  try {
    const health = await api.serverHealth();
    const status = toConnectionStatus(health, getIgloohomeConfig()!.scopes, new Date().toISOString());
    const ends = status.subscriptionEndsAt ? Date.parse(status.subscriptionEndsAt) : NaN;
    return {
      data: {
        ...status,
        ok: true,
        trialDaysLeft: Number.isFinite(ends) ? Math.max(0, Math.ceil((ends - Date.now()) / 86_400_000)) : undefined,
      },
    };
  } catch (error) {
    return { error: toLoadError(error) };
  }
});

// --- Site: properties, devices, Bridges ----------------------------------------------

export type BridgeStatus = { online: boolean; since: string; evidence: Evidence } | undefined;

// Views are sent to the browser, so they carry display IDs only (CLAUDE.md §11). `id` = redacted device ID.
// ponytail: display IDs could collide (same prefix + last 2 chars); switch to an opaque server-side key if they ever do.
type PublicSnapshot = Omit<DeviceSnapshot, "providerDeviceId" | "linkedDeviceIds"> & { id: string; linked: string[] } & Freshness;

/**
 * Where lock state and last sync come from: `live` = GET /devices/{id} just now (watched cabins only),
 * `last_known` = the stored result of an earlier detail call (`stateAt`), `list` = the device list only (no lock state).
 */
type Freshness = { freshness: "live" | "last_known" | "list"; stateAt?: string };

/** Registry entry (plan F7); undefined = on the igloohome account but not managed by iot-pms. */
export type ManagedInfo = { status: "enabled" | "disabled"; role?: DeviceRole } | undefined;

export interface DeviceView extends PublicSnapshot {
  bridgeId?: string;
  bridgeName?: string;
  managed: ManagedInfo;
}

export interface BridgeView extends PublicSnapshot {
  status: BridgeStatus;
  managed: ManagedInfo;
}

export interface RoomView {
  id: string;
  name: string;
  kind?: SpaceKind; // registry spaces only
  spaceId?: number; // registry spaces only
  subtitle?: string; // e.g. the linked igloohome property
  timezone?: string;
  devices: DeviceView[];
  bridges: BridgeView[];
}

export interface SiteView {
  rooms: RoomView[]; // igloohome properties
  unassigned: DeviceView[];
  /** Registry cabins and rooms (plan F7), then "No cabin or room yet" when managed devices have none. */
  spaces: RoomView[];
  /** On the account, not managed by iot-pms. */
  unmanaged: (DeviceView | BridgeView)[];
  devices: DeviceView[];
  bridges: BridgeView[];
  fetchedAt: string;
}

async function latestBridgeStatus(): Promise<Map<string, BridgeStatus>> {
  const db = await getDb();
  // Latest connection event (type 10) per Bridge.
  const latest = db.select({ id: max(webhookEvents.id) }).from(webhookEvents).where(eq(webhookEvents.eventType, 10)).groupBy(webhookEvents.productId);
  const rows = await db.select().from(webhookEvents).where(and(eq(webhookEvents.eventType, 10), inArray(webhookEvents.id, latest)));
  const map = new Map<string, BridgeStatus>();
  for (const row of rows) {
    const online = eventOf(row.body)?.data?.isOnline;
    if (typeof online === "boolean" && row.productId) {
      map.set(row.productId, {
        online,
        since: row.receivedAt.toISOString(),
        evidence: row.verification === "valid" ? "API" : "UNVERIFIED",
      });
    }
  }
  return map;
}

// Live detail for watched cabins: reused for 30 s unless the device sent an event since (then the lock state may differ).
const DETAIL_TTL_MS = 30_000;
const detailCache = new Map<string, { at: number; device: VendorDevice }>();

/** Exported for tests. Writes every fresh result to device_state (the last-known store). */
export async function liveDetails(api: IgloohomeClient, ids: string[], database?: Db): Promise<Map<string, VendorDevice>> {
  const out = new Map<string, VendorDevice>();
  if (ids.length === 0) return out;
  const db = database ?? (await getDb());
  const events = await db
    .select({ deviceId: webhookEvents.productId, at: max(webhookEvents.receivedAt) })
    .from(webhookEvents)
    .where(inArray(webhookEvents.productId, ids))
    .groupBy(webhookEvents.productId);
  const lastEvent = new Map(events.map((e) => [e.deviceId, e.at ? new Date(e.at).getTime() : 0]));
  await Promise.all(
    ids.map(async (id) => {
      const hit = detailCache.get(id);
      if (hit && Date.now() - hit.at < DETAIL_TTL_MS && hit.at > (lastEvent.get(id) ?? 0)) {
        out.set(id, hit.device);
        return;
      }
      try {
        const device = await api.getDevice(id);
        detailCache.set(id, { at: Date.now(), device });
        out.set(id, device);
        const state = { battery: device.batteryLevel ?? null, lockState: toDeviceSnapshot(device, "").lockState ?? null, lastSyncAt: device.lastSync ?? null, fetchedAt: new Date() };
        await db.insert(deviceState).values({ deviceId: id, ...state }).onConflictDoUpdate({ target: deviceState.deviceId, set: state });
      } catch {
        // unreachable for now: the last-known state is shown instead
      }
    }),
  );
  return out;
}

/**
 * The site: devices, Bridges, igloohome properties and our cabins/rooms (plan F7b). Account lists come from a 60 s
 * cache and lock state from the last-known store, so an ordinary render makes no per-device igloohome call.
 * `watch` = comma-separated space ids whose devices get live detail (Devices page, at most IOT_PMS_MONITOR_MAX).
 */
export const getSite = cache(async (watch: string = ""): Promise<{ data?: SiteView; error?: LoadError }> => {
  const api = igloohome();
  if (!api) return { error: { code: "not_configured", message: "igloohome credentials are not set" } };
  try {
    const [{ devices: list, fetchedAt }, properties, bridgeStatus, spaceRows, states] = await Promise.all([
      accountDevices(),
      accountProperties(),
      latestBridgeStatus(),
      listSpaces(),
      getDb().then((db) => db.select().from(deviceState)),
    ]);
    await backfillFromAccount(list); // rows imported from the env list get their name and kind
    const registry = new Map((await listManaged()).map((m) => [m.deviceId, m]));
    const managedOf = (s: DeviceSnapshot): ManagedInfo => {
      const m = registry.get(s.providerDeviceId);
      return m ? { status: m.status, role: m.role ?? undefined } : undefined;
    };
    const spaceOf = new Map([...registry.values()].map((m) => [m.deviceId, m.spaceId]));
    // Detail (lockStatus, lastSync) only for the watched cabins' devices; everyone else shows the last-known state.
    const watched = new Set(watch.split(",").filter(Boolean).map(Number));
    const details = await liveDetails(
      api,
      [...registry.values()].filter((m) => m.spaceId !== null && watched.has(m.spaceId)).map((m) => m.deviceId),
    );
    const known = new Map(states.map((row) => [row.deviceId, row]));
    const snapshots = list.map((device): DeviceSnapshot & Freshness => {
      const live = details.get(device.deviceId);
      if (live) return { ...toDeviceSnapshot(live, fetchedAt), freshness: "live" };
      const s = toDeviceSnapshot(device, fetchedAt);
      const last = known.get(device.deviceId);
      if (!last) return { ...s, freshness: "list" };
      return {
        ...s,
        lockState: s.lockState ?? (last.lockState as DeviceSnapshot["lockState"]) ?? undefined,
        lastSyncAt: s.lastSyncAt ?? last.lastSyncAt ?? undefined,
        freshness: "last_known",
        stateAt: last.fetchedAt.toISOString(),
      };
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped on purpose: full IDs stay on the server
    const toPublic = ({ providerDeviceId, linkedDeviceIds, ...rest }: DeviceSnapshot & Freshness): PublicSnapshot => ({
      ...rest,
      id: rest.displayId,
      linked: linkedDeviceIds.map(redactDeviceId),
    });

    // Links are reported on Bridge/keypad records, not on locks (EXP-20260925-01).
    const bridges: BridgeView[] = snapshots
      .filter((s) => s.kind === "bridge")
      .map((s) => ({ ...toPublic(s), status: bridgeStatus.get(s.providerDeviceId), managed: managedOf(s) }));
    const bridgeOf = new Map<string, BridgeView>();
    for (const bridge of bridges) for (const id of bridge.linked) bridgeOf.set(id, bridge);

    const devices: DeviceView[] = snapshots
      .filter((s) => s.kind !== "bridge")
      .map((s) => {
        const view = toPublic(s);
        const bridge = bridgeOf.get(view.id);
        return { ...view, bridgeId: bridge?.id, bridgeName: bridge?.name, managed: managedOf(s) };
      });

    const rooms: RoomView[] = properties.payload.map((property) => {
      const roomDevices = devices.filter((d) => d.propertyIds.includes(property.id));
      const roomBridges = bridges.filter((b) => b.linked.some((id) => roomDevices.some((d) => d.id === id)));
      return { id: property.id, name: property.name ?? "Unnamed property", timezone: property.timezone, devices: roomDevices, bridges: roomBridges };
    });

    // Registry grouping. A Bridge shows in every space where it serves a device, even if it is placed elsewhere.
    const inSpace = (spaceId: number | null) => {
      const ids = new Set(snapshots.filter((s) => registry.has(s.providerDeviceId) && spaceOf.get(s.providerDeviceId) === spaceId).map((s) => s.displayId));
      const spaceDevices = devices.filter((d) => ids.has(d.id));
      const spaceBridges = bridges.filter((b) => ids.has(b.id) || b.linked.some((id) => spaceDevices.some((d) => d.id === id)));
      return { devices: spaceDevices, bridges: spaceBridges };
    };
    const propertyName = new Map(properties.payload.map((p) => [p.id, p]));
    const spaces: RoomView[] = spaceRows.map((row) => {
      const property = row.propertyId ? propertyName.get(row.propertyId) : undefined;
      return {
        id: `space-${row.id}`,
        spaceId: row.id,
        name: row.name,
        kind: row.kind,
        subtitle: property ? `igloohome property ${property.name ?? "unnamed"}` : undefined,
        timezone: row.timeZone ?? property?.timezone,
        ...inSpace(row.id),
      };
    });
    const loose = inSpace(null);
    if (loose.devices.length || loose.bridges.length) spaces.push({ id: "no-space", name: "No cabin or room yet", ...loose });

    return {
      data: {
        rooms,
        spaces,
        unmanaged: [...bridges, ...devices].filter((d) => !d.managed),
        unassigned: devices.filter((d) => d.propertyIds.length === 0),
        devices,
        bridges,
        fetchedAt,
      },
    };
  } catch (error) {
    return { error: toLoadError(error) };
  }
});

/** Display ID → cabin/room name, from the registry grouping (for device pickers). */
export function placesOf(site: SiteView | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const space of site?.spaces ?? []) {
    if (!space.kind) continue; // "No cabin or room yet" is not a place
    for (const d of [...space.devices, ...space.bridges]) out.set(d.id, space.name);
  }
  return out;
}

// --- Activity (from stored webhook events) --------------------------------------------

export type FeedKind = "log" | "job" | "bridge";

export interface FeedItem {
  key: string;
  eventRowId: number;
  kind: FeedKind;
  occurredAt: string;
  receivedAt: string;
  deviceDisplay: string; // redacted; the full device ID never leaves the server
  bridgeDisplay?: string;
  label: string;
  tone: LogTone | "job" | "online" | "offline";
  method?: LogTypeInfo["method"];
  logType?: number;
  pinFingerprint?: string;
  jobStatus?: number;
  verification: string;
}

export interface FeedQuery {
  afterRowId?: number;
  limit?: number;
  includeSystem?: boolean;
}

export async function getActivityFeed(
  query: FeedQuery = {},
  db?: Db,
): Promise<{ items: FeedItem[]; lastRowId: number; hiddenSystem: number }> {
  db ??= await getDb();
  const rows = await db
    .select()
    .from(webhookEvents)
    .where(gt(webhookEvents.id, query.afterRowId ?? 0))
    .orderBy(desc(webhookEvents.id))
    .limit(Math.min(query.limit ?? 100, 500));

  const items: FeedItem[] = [];
  const seen = new Set<string>();
  let hiddenSystem = 0;
  for (const row of rows) {
    const event = eventOf(row.body);
    const deviceId = row.productId ?? undefined;
    const base = {
      eventRowId: row.id,
      receivedAt: row.receivedAt.toISOString(),
      deviceDisplay: deviceId ? redactDeviceId(deviceId) : "unknown device",
      bridgeDisplay: row.bridgeId ? redactDeviceId(row.bridgeId) : undefined,
      verification: row.verification,
    };

    if (row.eventType === 5 && Array.isArray(event.data?.activityLogs)) {
      event.data.activityLogs.forEach((log: Record<string, unknown>) => {
        const logType = Number(log.logType);
        const info = LOG_TYPES[logType] ?? { label: `Lock event (type ${logType})`, tone: "system" as const };
        if (info.tone === "system" && !query.includeSystem) {
          hiddenSystem++;
          return;
        }
        // Content key, not row key: after a Bridge reconnect the same log is re-sent with a new event id
        // (EXP-20260926-03), so identical device + type + time + PIN is one entry.
        const key = `${base.deviceDisplay}:${logType}:${String(log.entryDate)}:${String(log.pinFingerprint ?? "")}`;
        if (seen.has(key)) return;
        seen.add(key);
        items.push({
          ...base,
          key,
          kind: "log",
          occurredAt: typeof log.entryDate === "number" ? new Date(log.entryDate * 1000).toISOString() : base.receivedAt,
          label: info.label,
          tone: info.tone,
          method: info.method,
          logType,
          pinFingerprint: typeof log.pinFingerprint === "string" ? log.pinFingerprint : undefined,
        });
      });
    } else if (row.eventType === 3) {
      const status = typeof event.data?.jobStatus === "number" ? event.data.jobStatus : undefined;
      items.push({
        ...base,
        key: `${row.id}`,
        kind: "job",
        occurredAt: typeof event.date === "string" ? event.date : base.receivedAt,
        label: status === 0 ? "Remote job completed" : `Remote job finished: ${JOB_STATUS_WEBHOOK[status ?? -1]?.meaning ?? "unknown result"}`,
        tone: "job",
        jobStatus: status,
      });
    } else if (row.eventType === 10) {
      const online = event.data?.isOnline === true;
      items.push({
        ...base,
        key: `${row.id}`,
        kind: "bridge",
        occurredAt: typeof event.date === "string" ? event.date : base.receivedAt,
        label: online ? "Bridge came online" : "Bridge went offline",
        tone: online ? "online" : "offline",
      });
    }
  }
  items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return { items, lastRowId: rows.length ? rows[0].id : (query.afterRowId ?? 0), hiddenSystem };
}

/** Names for feed items, from the live device list; falls back to redacted IDs if igloohome is unreachable. */
export async function deviceNames(): Promise<Record<string, { name?: string; kind: string; modelName?: string }>> {
  const site = await getSite();
  const out: Record<string, { name?: string; kind: string; modelName?: string }> = {};
  for (const d of [...(site.data?.devices ?? []), ...(site.data?.bridges ?? [])]) {
    out[d.id] = { name: d.name, kind: d.kind, modelName: d.modelName };
  }
  return out;
}

// --- Developer mode ----------------------------------------------------------------

export interface CallRow extends ApiCallView {
  decoded?: string;
  docUrl?: string;
  inventoryRef?: string;
}

/** GET /jobs polls all return 200; the job state is in the body (D23: 1 pending, 0 completed). */
function jobState(call: ApiCallView): string | undefined {
  if (call.operation !== "getJob" || call.status !== 200 || !call.responseExcerpt) return undefined;
  if (call.responseExcerpt.includes('"completed":false')) return "Success · job still pending at the Bridge (jobStatus 1)";
  if (call.responseExcerpt.includes('"completed":true')) return "Success · job completed, result in opResult";
  return undefined;
}

export async function recentApiCalls(query: { limit?: number; operations?: string[] } = {}): Promise<CallRow[]> {
  const calls = await listApiCalls(await getDb(), query);
  return calls.map((call) => {
    const entry = CATALOG_BY_ID.get(call.operation);
    return { ...call, decoded: jobState(call) ?? decodeStatus(call.operation, call.status), docUrl: entry?.docUrl, inventoryRef: entry?.inventoryRef };
  });
}

export interface TryItResult {
  ok: boolean;
  operation: string;
  status?: number;
  latencyMs?: number;
  outcome: string;
  decoded?: string;
  message?: string;
  body?: string; // redacted, device IDs masked
  jobUrl?: string; // R1 runs create a health-check job
}

/** One Try-it run. Caller must have checked the operator role. Every attempt is logged with source "try-it". */
export async function tryOperation(operation: string, params: Record<string, unknown>): Promise<TryItResult> {
  let last: ApiCallRecord | undefined;
  const api = newClient("try-it", (record) => (last = record));
  if (!api) return { ok: false, operation, outcome: "not_configured", message: "igloohome credentials are not set" };

  const resolveDevice = async (displayId: string) =>
    (await listAllDevicesOnce()).find((d) => redactDeviceId(d.deviceId) === displayId)?.deviceId;
  try {
    const body = await runTryIt(api, resolveDevice, operation, params);
    return { ok: true, operation, status: last?.status, latencyMs: last?.latencyMs, outcome: "ok", decoded: decodeStatus(operation, last?.status), body };
  } catch (error) {
    const e = toLoadError(error);
    return {
      ok: false,
      operation,
      status: last?.status,
      latencyMs: last?.latencyMs,
      outcome: e.code,
      decoded: decodeStatus(operation, last?.status),
      message: e.message,
      body: last?.responseExcerpt ? redactDeviceIdsInJson(last.responseExcerpt) : undefined,
    };
  }
}

/** Latest non-system event per device (display ID), for "last event" lines on device cards. Local store only. */
export async function latestEventByDevice(): Promise<{ lastRowId: number; events: Record<string, Pick<FeedItem, "label" | "tone" | "occurredAt" | "kind">> }> {
  const feed = await getActivityFeed({ limit: 300 });
  const events: Record<string, Pick<FeedItem, "label" | "tone" | "occurredAt" | "kind">> = {};
  for (const item of feed.items) {
    if (!events[item.deviceDisplay]) events[item.deviceDisplay] = { label: item.label, tone: item.tone, occurredAt: item.occurredAt, kind: item.kind };
  }
  return { lastRowId: feed.lastRowId, events };
}
