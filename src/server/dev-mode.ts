import "server-only";

import { cookies } from "next/headers";

// Developer panels are a per-browser preference (integration-architecture.md §8a), off by default.
export const DEV_MODE_COOKIE = "iot-devmode";

export async function isDeveloperMode(): Promise<boolean> {
  return (await cookies()).get(DEV_MODE_COOKIE)?.value === "1";
}
