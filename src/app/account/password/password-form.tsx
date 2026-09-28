"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { changePasswordAction, type PasswordState } from "./actions";

const input =
  "h-11 rounded-xl border border-input bg-background px-3 text-base outline-none transition-shadow focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40";

export function PasswordForm({ minLength }: { minLength: number }) {
  const [state, submit, pending] = useActionState<PasswordState, FormData>(changePasswordAction, {});
  return (
    <form action={submit} className="flex flex-col gap-4" aria-describedby={state.error ? "pw-error" : undefined}>
      {(["current", "next", "confirm"] as const).map((name) => (
        <label key={name} className="flex flex-col gap-1.5 text-sm font-medium">
          {name === "current" ? "Current or temporary password" : name === "next" ? `New password (at least ${minLength} characters)` : "Repeat the new password"}
          <input
            name={name}
            type="password"
            required
            minLength={name === "current" ? undefined : minLength}
            autoComplete={name === "current" ? "current-password" : "new-password"}
            className={input}
          />
        </label>
      ))}
      {state.error && (
        <p id="pw-error" role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending} className="h-11">
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}
