"use client";

import { useActionState } from "react";

import { loginWithFallback, loginWithGoogle, type LoginState } from "./actions";

export function LoginForm({ googleEnabled, fallbackEnabled }: { googleEnabled: boolean; fallbackEnabled: boolean }) {
  const [state, submit, pending] = useActionState<LoginState, FormData>(loginWithFallback, {});

  return (
    <div className="flex flex-col gap-6">
      {googleEnabled && (
        <form action={loginWithGoogle}>
          <button
            type="submit"
            className="h-12 w-full rounded-xl border bg-background font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Continue with Google (@bobobox.com)
          </button>
        </form>
      )}

      {fallbackEnabled && (
        <form action={submit} className="flex flex-col gap-4" aria-describedby={state.error ? "login-error" : undefined}>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Username
            <input
              name="username"
              autoComplete="username"
              required
              className="h-12 rounded-xl border border-input bg-background px-3 text-base outline-none transition-shadow focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="h-12 rounded-xl border border-input bg-background px-3 text-base outline-none transition-shadow focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
            />
          </label>
          {state.error && (
            <p id="login-error" role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="h-12 rounded-xl bg-primary font-medium text-primary-foreground shadow-md shadow-primary/20 outline-none transition-[transform,background-color] hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      )}
    </div>
  );
}
