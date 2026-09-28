import { NextResponse, type NextRequest } from "next/server";

import { getWebhookConfig } from "@/server/config";
import { getDb } from "@/server/storage/db";
import { receiveWebhook } from "@/server/webhook-intake";

// Public endpoint for igloohome webhooks (only this path is exposed by the Cloudflare tunnel; not behind login).
// Never log the body: activity logs contain PINs.
export async function POST(request: NextRequest) {
  try {
    const result = await receiveWebhook(
      {
        method: request.method,
        host: request.headers.get("host"),
        forwardedHost: request.headers.get("x-forwarded-host"),
        path: request.nextUrl.pathname,
        contentType: request.headers.get("content-type"),
        date: request.headers.get("date"),
        signature: request.headers.get("x-igloocompany-sha256"),
        rawBody: await request.text(),
      },
      { db: await getDb(), config: getWebhookConfig() },
    );
    console.info(`[webhook] ${result.status} verification=${result.body.verification ?? "-"} duplicate=${result.body.duplicate ?? false}`);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    // Storage failure: return 5xx so a sender that retries (undocumented) gets another chance.
    console.error("[webhook] intake failed:", (error as Error).name);
    return NextResponse.json({ ok: false, error: "intake failed" }, { status: 500 });
  }
}
