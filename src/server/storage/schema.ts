import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import type { DeviceRole, SpaceKind } from "../../lib/device-roles";

// Drizzle schema (plan F1b). Matches the database created by the pre-Drizzle migrations 0001/0002 exactly, including
// index and constraint names, so the baseline migration produces no drift. Change the schema here, then
// `bun run db:generate` writes the SQL migration into db/migrations.

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Webhook events received from igloohome, sanitized (PINs → fingerprints). Full device ids: the database is local. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    receivedAt: ts("received_at").notNull(),
    dedupeKey: text("dedupe_key").notNull().unique("webhook_events_dedupe_key_key"), // event.id, or sha256 of the raw body
    eventId: text("event_id"),
    eventType: integer("event_type"), // 3 job complete, 5 activity log, 10 bridge connection
    eventDate: text("event_date"), // vendor timestamp, as sent
    productId: text("product_id"),
    productType: integer("product_type"),
    bridgeId: text("bridge_id"), // proxyId / accessoryId
    verification: text("verification").notNull(), // valid | invalid | no_key | no_signature | error
    body: jsonb("body").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [index("webhook_events_product").on(t.productId, t.eventType, t.receivedAt)],
);

/** Request inspector + Try-it evidence. Excerpts are redacted and device IDs masked before insert. */
export const apiCalls = pgTable("api_calls", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  at: ts("at").notNull(),
  source: text("source").notNull(), // app | try-it
  operation: text("operation").notNull(), // catalog id
  method: text("method").notNull(),
  pathTemplate: text("path_template").notNull(),
  deviceRef: text("device_ref"), // redacted display id
  status: integer("status"),
  latencyMs: integer("latency_ms").notNull(),
  outcome: text("outcome").notNull(), // ok | ProviderError code
  requestExcerpt: text("request_excerpt"),
  responseExcerpt: text("response_excerpt"),
});

/** Bridge jobs. Written BEFORE the POST so a crash mid-request shows "unknown", never nothing. */
export const providerJobs = pgTable(
  "provider_jobs",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    createdAt: ts("created_at").notNull(),
    actor: text("actor").notNull(),
    kind: text("kind").notNull(), // lock_battery | lock_status | bridge_diagnostics | pin_create | pin_delete
    jobType: integer("job_type").notNull(), // 9 | 10 | 4 | 5
    deviceId: text("device_id").notNull(),
    bridgeId: text("bridge_id").notNull(),
    state: text("state").notNull(), // requested | queued | unknown | completed | expired | rejected
    providerJobId: text("provider_job_id"),
    httpStatus: integer("http_status"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    retryAfterS: integer("retry_after_s"),
    expiresAt: ts("expires_at"),
    completed: integer("completed"), // 0/1 from GET /jobs
    rawJobStatus: integer("raw_job_status"), // jobResponse.jobStatus (D23: job state)
    rawJob: text("raw_job"), // last GET /jobs body, redacted, device ids masked
    polledAt: ts("polled_at"),
    polls: integer("polls").notNull().default(0),
    pinFingerprint: text("pin_fingerprint"), // PIN jobs; the PIN itself is never stored here
    experimental: boolean("experimental").notNull().default(false), // G1: undocumented device/job combination
  },
  (t) => [index("provider_jobs_bridge").on(t.bridgeId, t.kind, t.createdAt)],
);

/** algoPINs issued by iot-pms. Fingerprint only (the vault, plan F4, adds encrypted storage). */
export const accessCodes = pgTable("access_codes", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  createdAt: ts("created_at").notNull(),
  actor: text("actor").notNull(),
  deviceId: text("device_id").notNull(),
  pinType: text("pin_type").notNull(), // onetime | hourly | daily | permanent
  accessName: text("access_name").notNull(),
  variance: integer("variance").notNull(),
  startAt: text("start_at").notNull(), // as sent: YYYY-MM-DDTHH:00:00+hh:mm
  endAt: text("end_at"),
  startMs: bigint("start_ms", { mode: "number" }).notNull(),
  endMs: bigint("end_ms", { mode: "number" }),
  activateByMs: bigint("activate_by_ms", { mode: "number" }), // 24 h activation rule, when it applies
  state: text("state").notNull(), // requested | issued | rejected | unknown
  pinId: text("pin_id"),
  pinFingerprint: text("pin_fingerprint"),
  httpStatus: integer("http_status"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
});

/** Accounts (plan F2). The .env fallback account is copied in as the first super-admin. */
export const users = pgTable(
  "users",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email"), // for Google sign-in (optional)
    passwordHash: text("password_hash"), // bcrypt; null = Google only
    role: text("role").notNull().$type<"viewer" | "operator" | "super_admin">(),
    status: text("status").notNull().default("active").$type<"active" | "disabled">(),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
    createdBy: text("created_by"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    lastLoginAt: ts("last_login_at"),
  },
  (t) => [
    uniqueIndex("users_username").on(sql`lower(${t.username})`),
    uniqueIndex("users_email").on(sql`lower(${t.email})`).where(sql`${t.email} IS NOT NULL`),
    check("users_role_check", sql`${t.role} IN ('viewer', 'operator', 'super_admin')`),
    check("users_status_check", sql`${t.status} IN ('active', 'disabled')`),
  ],
);

/** Who did what. Never holds a PIN or a password; `detail` is short, redacted text. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    at: ts("at").notNull().defaultNow(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    target: text("target"),
    detail: text("detail"),
  },
  (t) => [index("audit_events_at").on(t.at.desc().nullsFirst())], // = Postgres default for DESC, as in the live DB
);

/** Cabins and rooms (plan F7, Q10): our own grouping of devices; an igloohome property can be linked for reference. */
export const spaces = pgTable(
  "spaces",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    name: text("name").notNull(),
    kind: text("kind").notNull().$type<SpaceKind>(),
    propertyId: text("property_id"), // igloohome property, optional
    timeZone: text("time_zone"), // IANA; falls back to the property's
    notes: text("notes"),
    createdAt: ts("created_at").notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [uniqueIndex("spaces_name").on(sql`lower(${t.name})`), check("spaces_kind_check", sql`${t.kind} IN ('cabin', 'room')`)],
);

/** Devices iot-pms manages (plan F7). Enabled rows ARE the allowlist the safety guards read (replaces IGLOOHOME_ALLOWED_DEVICE_IDS). */
export const managedDevices = pgTable(
  "managed_devices",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    deviceId: text("device_id").notNull().unique("managed_devices_device_id_key"), // full igloohome id: the database is local
    name: text("name"), // igloohome name when adopted
    kind: text("kind"), // DeviceKind when adopted; null for rows imported from the env list
    model: text("model"),
    spaceId: integer("space_id").references(() => spaces.id, { onDelete: "restrict" }),
    role: text("role").$type<DeviceRole>(),
    status: text("status").notNull().default("enabled").$type<"enabled" | "disabled">(),
    addedAt: ts("added_at").notNull().defaultNow(),
    addedBy: text("added_by").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("managed_devices_status_check", sql`${t.status} IN ('enabled', 'disabled')`),
    check("managed_devices_role_check", sql`${t.role} IN ('door_lock', 'bed_lock', 'keypad', 'switch', 'bridge')`),
  ],
);

/**
 * Last-known device state from GET /devices/{id} (plan F7b). The compact views read this instead of calling
 * igloohome for every device; only watched cabins fetch live detail (which also refreshes this row).
 */
export const deviceState = pgTable("device_state", {
  deviceId: text("device_id").primaryKey(),
  battery: integer("battery"),
  lockState: text("lock_state"), // locked | unlocked | unknown
  lastSyncAt: text("last_sync_at"), // vendor lastSync, as sent
  fetchedAt: ts("fetched_at").notNull(),
});

/**
 * The scope ceiling (plan F3): what igloohome grants our client, read from server-health with a token requested
 * without `scope`. One row per sync; the latest wins. Before the first sync, IGLOOHOME_SCOPES stands in.
 */
export const scopeSyncs = pgTable("scope_syncs", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  syncedAt: ts("synced_at").notNull().defaultNow(),
  syncedBy: text("synced_by").notNull(),
  scopes: text("scopes").array().notNull(),
});

/** Scopes a super-admin gave to an operator or viewer (plan F3). Read scopes are implicit and never stored. */
export const userScopes = pgTable(
  "user_scopes",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    grantedBy: text("granted_by").notNull(),
    grantedAt: ts("granted_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.scope], name: "user_scopes_pkey" })],
);


/**
 * PIN vault (plan F4): every PIN iot-pms creates, encrypted (src/server/crypto/pin-cipher.ts). Only a super-admin can
 * reveal one; reveals and revokes are audited. Status is derived from the linked access code or jobs.
 */
export const pins = pgTable(
  "pins",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    createdAt: ts("created_at").notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
    deviceId: text("device_id").notNull(),
    kind: text("kind").notNull().$type<"algopin" | "custom">(),
    pinType: text("pin_type").notNull(), // algoPIN: onetime | hourly | daily | permanent; custom: 1 one-time | 2 permanent | 4 duration
    accessName: text("access_name"),
    startAt: text("start_at"), // as sent to igloohome
    endAt: text("end_at"),
    ciphertext: text("ciphertext").notNull(),
    keyVersion: integer("key_version").notNull(),
    fingerprint: text("fingerprint").notNull(), // same HMAC as webhook_events, links activity logs
    accessCodeId: integer("access_code_id").references(() => accessCodes.id),
    createJobId: integer("create_job_id").references(() => providerJobs.id),
    revokeJobId: integer("revoke_job_id").references(() => providerJobs.id),
    revokedBy: text("revoked_by"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("pins_device_fingerprint").on(t.deviceId, t.fingerprint), check("pins_kind_check", sql`${t.kind} IN ('algopin', 'custom')`)],
);
