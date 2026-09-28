// Next.js 16 `proxy` (formerly middleware). Redirects signed-out users to /login via Auth.js `authorized`.
// Server actions and route handlers still check the role themselves (requireRole) — this is only the first gate.
export { auth as proxy } from "@/auth";

export const config = {
  // api/webhooks is public on purpose (igloohome posts events there); it has its own signature check.
  matcher: ["/((?!api/auth|api/webhooks|login|_next/static|_next/image|favicon.ico).*)"],
};
