import "server-only";

import { desc, inArray, lte, sql } from "drizzle-orm";

import type { ApiCallRecord } from "../igloohome/client";
import { redactDeviceIdsInJson } from "../igloohome/redaction";
import type { Db } from "./db";
import { apiCalls } from "./schema";

// API call log for the request inspector. Records arrive already redacted by the client; device IDs are masked here.

export type CallSource = "app" | "try-it";

// ponytail: keeps the newest rows only; add date-based retention if call logs must be kept as evidence long-term.
const KEEP_ROWS = 2000;

export interface ApiCallView {
  id: number;
  at: string;
  source: CallSource;
  operation: string;
  method: string;
  pathTemplate: string;
  deviceRef?: string;
  status?: number;
  latencyMs: number;
  outcome: string;
  requestExcerpt?: string;
  responseExcerpt?: string;
}

export async function recordApiCall(db: Db, record: ApiCallRecord, source: CallSource, now = new Date()) {
  const mask = (text?: string) => (text === undefined ? null : redactDeviceIdsInJson(text));
  await db.insert(apiCalls).values({
    at: now,
    source,
    operation: record.operation,
    method: record.method,
    pathTemplate: record.pathTemplate,
    deviceRef: record.deviceRef ?? null,
    status: record.status ?? null,
    latencyMs: record.latencyMs,
    outcome: record.outcome,
    requestExcerpt: mask(record.requestExcerpt),
    responseExcerpt: mask(record.responseExcerpt),
  });
  await db.delete(apiCalls).where(lte(apiCalls.id, sql`(SELECT MAX(${apiCalls.id}) FROM ${apiCalls}) - ${KEEP_ROWS}`));
}

export async function listApiCalls(db: Db, query: { limit?: number; operations?: string[] } = {}): Promise<ApiCallView[]> {
  const ops = query.operations ?? [];
  const rows = await db
    .select()
    .from(apiCalls)
    .where(ops.length ? inArray(apiCalls.operation, ops) : undefined)
    .orderBy(desc(apiCalls.at), desc(apiCalls.id)) // by time: imported rows keep older ids
    .limit(Math.min(query.limit ?? 100, 500));
  return rows.map((row) => ({
    id: row.id,
    at: row.at.toISOString(),
    source: row.source as CallSource,
    operation: row.operation,
    method: row.method,
    pathTemplate: row.pathTemplate,
    deviceRef: row.deviceRef ?? undefined,
    status: row.status ?? undefined,
    latencyMs: row.latencyMs,
    outcome: row.outcome,
    // Masked again on read: rows stored before a masking rule was added must not leak either.
    requestExcerpt: row.requestExcerpt ? redactDeviceIdsInJson(row.requestExcerpt) : undefined,
    responseExcerpt: row.responseExcerpt ? redactDeviceIdsInJson(row.responseExcerpt) : undefined,
  }));
}
