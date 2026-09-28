import { auth } from "@/auth";
import { getActivityFeed } from "@/server/application/dashboard";

// Polled by the Activity screen. Reads stored webhook events only; never calls igloohome.
export async function GET(request: Request) {
  if (!(await auth())?.user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const after = Number(params.get("after") ?? 0);
  const feed = await getActivityFeed({
    afterRowId: Number.isSafeInteger(after) && after > 0 ? after : 0,
    includeSystem: params.get("system") === "1",
  });
  return Response.json(feed, { headers: { "Cache-Control": "no-store" } });
}
