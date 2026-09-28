import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

import { LoginRateLimiter, isGoogleSignInAllowed, roleForGoogleEmail, verifyFallbackLogin } from "@/server/auth-policy";
import { getAuthConfig } from "@/server/config";
import { atLeast, type Role } from "@/server/domain/models";
import { audit, findUserByEmail, findUserById, recordLogin, verifyPassword } from "@/server/users";

// Dashboard login (plan F2). Accounts live in Postgres; the super-admin creates them.
// The .env fallback account is the bootstrap super-admin and the break-glass login (Q7).
// Google (@bobobox.com) when configured. Config is read lazily per request so `next build` does not need secrets.

declare module "next-auth" {
  interface User {
    role?: Role;
    uid?: number;
    mustChangePassword?: boolean;
  }
  interface Session {
    user: { role: Role; uid?: number; mustChangePassword: boolean } & DefaultSession["user"];
  }
}

// `next-auth/jwt` only re-exports `@auth/core/jwt`; augmentation must target the original module.
declare module "@auth/core/jwt" {
  interface JWT {
    role?: Role;
    uid?: number; // database user id; absent for the break-glass .env account
    mustChangePassword?: boolean;
    checkedAt?: number;
  }
}

const RECHECK_MS = 60_000; // a disabled account or a role change takes effect within a minute
const limiter = new LoginRateLimiter();

function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const config = getAuthConfig();

  return {
    secret: config.secret,
    trustHost: true, // served on localhost / internal network only
    session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
    pages: { signIn: "/login", error: "/login" },
    providers: [
      ...(config.google ? [Google({ clientId: config.google.clientId, clientSecret: config.google.clientSecret })] : []),
      Credentials({
        id: "password",
        name: "Username and password",
        credentials: { username: {}, password: {} },
        async authorize(credentials, request) {
          const username = typeof credentials.username === "string" ? credentials.username.trim() : "";
          const password = typeof credentials.password === "string" ? credentials.password : "";
          if (!username || !password) return null;
          const key = `${clientKey(request)}|${username.toLowerCase()}`;
          if (limiter.isBlocked(key)) return null;

          const user = await verifyPassword(username, password);
          if (user) {
            limiter.reset(key);
            await recordLogin(user.id);
            await audit(user.username, "sign_in", user.username);
            return { id: `user:${user.id}`, uid: user.id, name: user.displayName, role: user.role, mustChangePassword: user.mustChangePassword };
          }
          // Break-glass: the .env account always works as super-admin, even if the database account changed.
          const env = await verifyFallbackLogin(username, password, config, limiter, clientKey(request));
          if (env) {
            await audit(env.username, "sign_in.break_glass", env.username, ".env fallback account");
            return { id: `env:${env.username}`, name: env.username, role: "super_admin", mustChangePassword: false };
          }
          if (!config.fallback) limiter.recordFailure(key); // verifyFallbackLogin already counted it otherwise
          return null;
        },
      }),
    ],
    callbacks: {
      signIn({ account, profile }) {
        if (account?.provider === "google") return isGoogleSignInAllowed(profile ?? {}, config);
        return account?.provider === "password";
      },
      async jwt({ token, user, account }) {
        const now = Date.now();
        if (user) {
          if (account?.provider === "google" && user.email) {
            const dbUser = await findUserByEmail(user.email);
            if (dbUser && dbUser.status !== "active") return null;
            token.uid = dbUser?.id;
            token.role = dbUser?.role ?? roleForGoogleEmail(user.email, config);
            token.mustChangePassword = false;
          } else {
            token.uid = user.uid;
            token.role = user.role;
            token.mustChangePassword = user.mustChangePassword ?? false;
          }
          token.checkedAt = now;
          return token;
        }
        // Re-read the account so a disabled user or a role change applies without waiting for the 8 h session to end.
        if (token.uid && now - (token.checkedAt ?? 0) > RECHECK_MS) {
          const dbUser = await findUserById(token.uid);
          if (!dbUser || dbUser.status !== "active") return null; // signs the session out
          token.role = dbUser.role;
          token.name = dbUser.displayName;
          token.mustChangePassword = dbUser.mustChangePassword;
          token.checkedAt = now;
        }
        return token;
      },
      session({ session, token }) {
        session.user.role = token.role ?? "viewer";
        session.user.uid = token.uid;
        session.user.mustChangePassword = token.mustChangePassword ?? false;
        return session;
      },
      // Used by src/proxy.ts: every matched route needs a session.
      // A temporary password blocks everything except changing it, including direct server-action POSTs
      // (the dashboard layout redirect alone only covers page renders; F6 review).
      authorized({ auth: session, request }) {
        if (!session?.user) return false;
        if (session.user.mustChangePassword && !request.nextUrl.pathname.startsWith("/account/password")) {
          return Response.redirect(new URL("/account/password", request.nextUrl));
        }
        return true;
      },
    },
  };
});

/** Server-side guard for server actions / route handlers. Never rely on the proxy alone. */
export async function requireRole(required: Role) {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in");
  if (!atLeast(session.user.role, required)) throw new Error(`${required === "super_admin" ? "Super-admin" : "Operator"} role required`);
  return session;
}

/** Name recorded in audit and job rows. */
export function actorOf(session: { user?: { name?: string | null; email?: string | null } } | null): string {
  return session?.user?.email ?? session?.user?.name ?? "unknown";
}
