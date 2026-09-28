// Runs once when the Next.js server starts. Fail fast on unsafe or missing configuration
// (explicit igloohome scopes, AUTH_SECRET, a login method, the database) instead of failing on the first request.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ConfigError, getAuthConfig, getIgloohomeConfig, getMonitorMax, getPinKey, getWebhookConfig, parseScopes } = await import("@/server/config");
  parseScopes(process.env);
  getMonitorMax();
  // Plan F4: PINs created without the vault would be lost for good, so creating them requires the key.
  const pinFlags = getIgloohomeConfig();
  if ((pinFlags?.enableAlgoPin || pinFlags?.enablePinJobs) && !getPinKey()) {
    throw new ConfigError("IOT_PMS_PIN_KEY is required while IGLOOHOME_ENABLE_ALGOPIN or IGLOOHOME_ENABLE_PIN_JOBS is true (see .env.example)");
  }
  getAuthConfig();
  // e.g. REQUIRE_VALID_SIGNATURE=true without a public key: refuse to start instead of 500-ing every webhook.
  getWebhookConfig();
  // Postgres (plan F1): connect and apply migrations now, so a missing or wrong DATABASE_URL stops the start.
  const { getDb } = await import("@/server/storage/db");
  await getDb();
  // Plan F2 (Q7): empty users table → the .env fallback account becomes the first super-admin.
  const { ensureBootstrap } = await import("@/server/users");
  if ((await ensureBootstrap(getAuthConfig())) === "created") console.info("[iot-pms] first super-admin created from the .env fallback account");
  if (process.env.AUTH_FALLBACK_ROLE) console.warn("[iot-pms] AUTH_FALLBACK_ROLE is ignored: the .env account is always super-admin (break-glass). You can remove it.");
  // Plan F7: the env allowlist is copied into the device registry once; after that the registry is the only source.
  const allowed = getIgloohomeConfig()?.allowedDeviceIds;
  if (allowed) {
    const { importAllowlist } = await import("@/server/application/device-registry");
    const imported = await importAllowlist(allowed);
    if (imported !== "done_before") console.info(`[iot-pms] device registry: imported ${imported} device(s) from IGLOOHOME_ALLOWED_DEVICE_IDS`);
    else if (allowed.length) console.warn("[iot-pms] IGLOOHOME_ALLOWED_DEVICE_IDS is ignored: the device registry (Devices → Manage) is the allowlist now. You can remove it.");
  }
  if (!getIgloohomeConfig()) {
    console.warn("[iot-pms] igloohome credentials not set — dashboard runs without API access (see .env.example)");
  }
}
