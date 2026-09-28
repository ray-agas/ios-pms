import { KeySquare } from "lucide-react";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { getAuthConfig } from "@/server/config";

import { FadeIn } from "@/components/motion";

import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const changed = (await searchParams).changed === "1";
  if ((await auth())?.user) redirect("/");
  const config = getAuthConfig();

  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      <FadeIn className="relative flex w-full max-w-sm flex-col gap-8 rounded-3xl border bg-card/80 p-6 shadow-xl shadow-primary/5 backdrop-blur md:p-8">
        <header className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
            <KeySquare className="size-7" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">iot-pms</h1>
            <p className="text-sm text-muted-foreground">igloohome integration dashboard · internal use</p>
          </div>
        </header>
        {changed && (
          <p role="status" className="rounded-xl bg-success/10 px-3 py-2 text-center text-sm text-success">
            Password changed. Sign in with the new one.
          </p>
        )}
        <LoginForm googleEnabled={Boolean(config.google)} fallbackEnabled />
      </FadeIn>
    </main>
  );
}
