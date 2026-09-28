import "server-only";

import { z } from "zod";

// Vendor response shapes from the docs snapshot (docs.igloohome.co primary, Stoplight for field rules).
// Loose on purpose: unknown fields are kept, conditional fields are optional (Stoplight "Conditional Presence").
// Replace doc-based fixtures with real redacted captures after experiments E1–E4 and tighten where proven.

export const tokenResponseSchema = z.looseObject({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  token_type: z.string(),
});

export const serverHealthSchema = z.looseObject({
  clientId: z.string().optional(),
  clientName: z.string().optional(),
  endsAt: z.string().optional(),
  flow: z.string().optional(),
  isAdminLogin: z.boolean().optional(),
  scopes: z.array(z.string()).optional(),
  status: z.string().optional(),
  tier: z.string().optional(),
  userRef: z.string().optional(),
});

const linkedDeviceSchema = z.looseObject({
  deviceId: z.string().optional(),
  type: z.string().optional(),
});

export const deviceSchema = z.looseObject({
  id: z.string().optional(),
  deviceId: z.string().min(1),
  type: z.string(),
  deviceName: z.string().optional(),
  batteryLevel: z.number().optional(),
  pairedAt: z.string().optional(),
  homeId: z.array(z.string()).optional(),
  linkedDevices: z.array(linkedDeviceSchema).optional().default([]),
  lastSync: z.string().nullable().optional(),
  lockStatus: z.string().optional(),
});

export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.looseObject({
    nextCursor: z.string().optional().default(""),
    payload: z.array(item),
  });

export const devicePageSchema = pageSchema(deviceSchema);

export const propertySchema = z.looseObject({
  id: z.string(),
  name: z.string().optional(),
  timezone: z.string().optional(),
});

export const propertyPageSchema = pageSchema(propertySchema);
export const propertyDetailSchema = z.looseObject({ payload: propertySchema });

export const activitySchema = z.looseObject({
  activityTimeAt: z.string().optional(),
  activityType: z.string().optional(),
  description: z.string().optional(),
});

export const activityPageSchema = pageSchema(activitySchema);

export const jobCreatedSchema = z.looseObject({ jobId: z.string().min(1) });

// H17–H20 success: {"pin":"7541869","pinId":"EE4421C77G9F512D"} (DOC). The PIN never leaves the use case unredacted.
export const algoPinCreatedSchema = z.looseObject({ pin: z.string().regex(/^\d{4,12}$/), pinId: z.string().optional() });

export const jobStatusSchema = z.looseObject({
  jobId: z.string(),
  completed: z.boolean().optional(),
  expiryDate: z.string().optional(),
  jobType: z.union([z.string(), z.number()]).optional(),
  // D12: opResult is `{ result: 0 }` in one doc and `0` in another.
  jobResponse: z
    .looseObject({
      jobStatus: z.number().optional(),
      opResult: z.union([z.number(), z.looseObject({ result: z.number().optional() })]).optional(),
    })
    .optional(),
});

export type VendorDevice = z.infer<typeof deviceSchema>;
export type VendorProperty = z.infer<typeof propertySchema>;
export type VendorActivity = z.infer<typeof activitySchema>;
export type VendorServerHealth = z.infer<typeof serverHealthSchema>;
export type VendorJobStatus = z.infer<typeof jobStatusSchema>;
