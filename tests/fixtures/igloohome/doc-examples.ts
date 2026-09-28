// Response examples copied verbatim from the vendor docs snapshot (docs/research/igloohome/sources/2026-09-25).
// Evidence: DOC only. Replace/extend with real redacted captures after experiments E1–E4 (plan M2).
// IDs below are the vendor's public sample values, not our devices.

/** docs.igloohome.co/home/getting-started-igloohome-api — token response */
export const tokenResponse = { access_token: "eyJraWQiOiJKc.....", expires_in: 86400, token_type: "Bearer" };

/** docs.igloohome.co/home/api_server_health — GET /server-health 200 */
export const serverHealth = {
  clientId: "7k8m9n0p1q2r3s4t5u6v7w8x",
  clientName: "igloohome-partners-app",
  endsAt: "2026-09-08T00:00:00Z",
  flow: "client_credentials",
  isAdminLogin: false,
  scopes: ["igloohomeapi/get-devices"],
  status: "active",
  tier: "paid",
  userRef: "user_abc123def456",
};

/** docs.igloohome.co/home/api_devices — GET /devices 200 */
export const deviceList = {
  nextCursor: "22j3230ids0idsa0d",
  payload: [
    {
      batteryLevel: 100,
      deviceId: "EK1X013f300d",
      deviceName: "Keypad",
      homeId: ["2rqQx4Riasw3Rs6db"],
      linkedDevices: [{ deviceId: "IGP102c1854a", type: "Lock" }],
      pairedAt: "2022-06-30T17:00:00+08:00",
      type: "Keypad",
    },
  ],
};

/** Stoplight OpenAPI example — GET /devices/{deviceId} 200 (note: no linkedDevices, lockStatus in caps) */
export const deviceDetailStoplight = {
  id: "1784534123000",
  type: "Lock",
  deviceId: "DLB10001a",
  deviceName: "Front Door Deadbolt",
  lockStatus: "LOCKED",
  lastSync: "2022-05-30T00:00:00+08:00",
  batteryLevel: 20,
  pairedAt: "2021-07-03T12:00:00+08:00",
};

/** docs.igloohome.co/home/api_bridge_jobs — GET /jobs/{jobId} 200 */
export const jobStatus = {
  completed: true,
  expiryDate: "2025-01-01T00:02:00.000Z",
  jobId: "6345191a82bcfc12a921bdb6",
  jobResponse: { jobStatus: 0, opResult: { result: 0 } },
  jobType: "UNLOCK",
};

/** docs.igloohome.co/home/api_devices — GET /devices/{deviceId}/activity 200 */
export const activityPage = {
  nextCursor: "65a7d4c8b2c9f1e2d3a4b5c6",
  payload: [
    { activityTimeAt: "2024-01-15T14:30:00+08:00", activityType: "UNLOCK", description: "Unlocked by keypad PIN" },
    { activityTimeAt: "2024-01-15T13:45:00+08:00", activityType: "LOCK", description: "Locked by bluetooth key" },
  ],
};

/** Documented error bodies */
export const errors = {
  trialEnded: { error: "30 days igloohome API trial has ended" },
  bridgeOffline: { error: "Unable to contact bridge as it appears to be offline" },
  lockNotLinked: { error: "Lock is not linked to bridge" }, // Stoplight
  timezoneMissing: { message: "timezone is not found on property" },
  unsupported: { error: "this device type does not support the feature." },
  tooManyRequests: { error: "Too many requests. Please try again after 45 seconds." },
};
