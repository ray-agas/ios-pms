"use client";

import { Activity, Cpu, KeyRound, KeySquare, LayoutDashboard, LockKeyhole, LogOut, SquareTerminal, Users, type LucideIcon } from "lucide-react";
import { MotionConfig, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { DevModeSwitch } from "@/components/developer/dev-mode-switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ROLE_LABEL, type Role } from "@/server/domain/models";

const NAV: { href: string; label: string; icon: LucideIcon; superAdmin?: boolean }[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/devices", label: "Devices", icon: Cpu },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/access", label: "Access", icon: KeyRound },
  { href: "/developer", label: "Developer", icon: SquareTerminal },
  { href: "/people", label: "People", icon: Users, superAdmin: true },
];

interface ShellProps {
  user: { name: string; role: string };
  signOutAction: () => Promise<void>;
  devMode: boolean;
  setDevMode: (on: boolean) => Promise<void>;
  children: React.ReactNode;
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      <span className="relative flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/30">
        <KeySquare className="size-5" aria-hidden />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold tracking-tight">iot-pms</span>
        <span className="text-[11px] text-muted-foreground">igloohome lab</span>
      </span>
    </Link>
  );
}

function SignOut({ action, compact }: { action: () => Promise<void>; compact?: boolean }) {
  return (
    <form action={action}>
      {compact ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="submit" variant="ghost" size="icon-lg" aria-label="Sign out">
              <LogOut />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Sign out</TooltipContent>
        </Tooltip>
      ) : (
        <Button type="submit" variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
          <LogOut /> Sign out
        </Button>
      )}
    </form>
  );
}

export function AppShell({ user, signOutAction, devMode, setDevMode, children }: ShellProps) {
  const pathname = usePathname();
  const nav = NAV.filter((item) => !item.superAdmin || user.role === "super_admin");

  return (
    <MotionConfig reducedMotion="user">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <div className="flex min-h-dvh flex-1">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-8 border-r bg-sidebar px-4 py-6 md:flex">
          <div className="px-2">
            <Brand />
          </div>
          <nav aria-label="Main" className="flex flex-col gap-1">
            {nav.map(({ href, label, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                    active ? "text-sidebar-accent-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-lg bg-sidebar-accent"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                  <Icon className="relative size-4" aria-hidden />
                  <span className="relative">{label}</span>
                </Link>
              );
            })}
          </nav>

          <DevModeSwitch on={devMode} action={setDevMode} className="mt-auto" />

          <div className="flex flex-col gap-2 rounded-xl border bg-card p-3">
            <div className="flex items-center gap-3">
              <span aria-hidden className="flex size-9 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
                {user.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <Badge variant="secondary" className="mt-0.5">
                  {ROLE_LABEL[user.role as Role] ?? user.role}
                </Badge>
              </div>
            </div>
            <Link href="/account/password" className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[0.8rem] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
              <LockKeyhole className="size-3.5" aria-hidden /> Change password
            </Link>
            <SignOut action={signOutAction} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile header */}
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-md md:hidden">
            <Brand />
            <div className="flex items-center gap-1">
              <Badge variant="secondary">
                {ROLE_LABEL[user.role as Role] ?? user.role}
              </Badge>
              <Button asChild variant="ghost" size="icon-lg" aria-label="Change password">
                <Link href="/account/password">
                  <LockKeyhole />
                </Link>
              </Button>
              <SignOut action={signOutAction} compact />
            </div>
          </header>

          <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-28 md:px-8 md:pt-8 md:pb-10">
            {children}
          </main>
        </div>
      </div>

      {/* Mobile bottom tabs */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        <ul className={cn("mx-auto grid max-w-xl", nav.length > 5 ? "grid-cols-6" : "grid-cols-5")}>
          {nav.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium outline-none focus-visible:bg-accent",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="tab-active"
                      className="absolute top-0 h-0.5 w-10 rounded-full bg-primary"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                  <Icon className="size-5" aria-hidden />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </MotionConfig>
  );
}
