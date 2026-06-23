"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { AppBreadcrumbs } from "./app-breadcrumbs";
import { PUBLIC_ROUTES } from "./nav-config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Moon, Sun, Loader2, Coins, AlertTriangle } from "lucide-react";
import { useTheme } from "next-themes";
import { useQuery } from "@tanstack/react-query";
import { NotificationBell } from "@/components/NotificationBell";

function CreditBalancePill() {
  const { data, isLoading } = useQuery<{ balance: number }>({
    queryKey: ["/api/credits/balance"],
    refetchInterval: 60000,
    staleTime: 30000,
  });

  if (isLoading || data === undefined) return null;

  const balance = data.balance;
  const isLow = balance <= 20;
  const isCritical = balance <= 0;

  return (
    <div
      className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border ${
        isCritical
          ? "bg-destructive/10 border-destructive/30 text-destructive"
          : isLow
          ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-600 dark:text-yellow-400"
          : "bg-muted border-border text-muted-foreground"
      }`}
      title={`Credit balance: ${balance}`}
      data-testid="text-credit-balance"
    >
      {isCritical || isLow ? (
        <AlertTriangle className="w-3 h-3 shrink-0" />
      ) : (
        <Coins className="w-3 h-3 shrink-0" />
      )}
      <span>{balance.toLocaleString()} cr</span>
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="w-9 h-9" />;
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      data-testid="button-theme-toggle"
      aria-label="Toggle theme"
    >
      {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isPublicRoute =
    !pathname ||
    PUBLIC_ROUTES.some(
      (route) => pathname === route || pathname.startsWith(route + "/")
    ) ||
    pathname.startsWith("/embed/") ||
    pathname.startsWith("/accept-invite/") ||
    pathname.startsWith("/examples/");

  // Client-side auth guard — redirect unauthenticated users on protected routes
  useEffect(() => {
    if (!mounted || isLoading || isPublicRoute) return;
    if (!user) {
      router.replace("/login");
    }
  }, [mounted, isLoading, isPublicRoute, user, router]);

  // While auth is resolving, show a spinner for protected routes
  if (!mounted || isLoading) {
    if (isPublicRoute) return <>{children}</>;
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Public routes — render without shell
  if (isPublicRoute) {
    return <>{children}</>;
  }

  // Not logged in — blank while redirect happens
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full overflow-hidden">
        <AppSidebar />
        <SidebarInset className="flex flex-col overflow-hidden">
          <header className="sticky top-0 z-50 flex h-11 shrink-0 items-center gap-2 border-b bg-background/95 backdrop-blur-sm px-3">
            <SidebarTrigger data-testid="button-sidebar-trigger" />
            <div className="h-4 w-px bg-border" />
            <div className="flex-1 min-w-0">
              <AppBreadcrumbs />
            </div>
            <div className="flex items-center gap-2 ml-auto shrink-0">
              <CreditBalancePill />
              <NotificationBell />
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
