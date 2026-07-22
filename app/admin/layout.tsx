"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";
import { 
  Users, 
  Activity, 
  Shield, 
  BarChart3, 
  Clock, 
  Settings, 
  Heart,
  FileText,
  LogOut,
  Home,
  Trash2,
  AlertTriangle,
  Send,
  Coins,
  ThumbsUp,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { PENDING_COUNT_KEY } from "@/hooks/use-invalidate-pending-count";

const adminNavItems = [
  {
    title: "Dashboard",
    href: "/admin",
    icon: Home,
    description: "Overview & Quick Actions"
  },
  {
    title: "Publishing Dashboard",
    href: "/settings/publishing",
    icon: Send,
    description: "Connections, Jobs & Status"
  },
  {
    title: "User Management",
    href: "/admin/users",
    icon: Users,
    description: "Invites, Roles, Force Logout",
    badgeKey: "pendingApprovals",
  },
  {
    title: "Active Sessions",
    href: "/admin/sessions",
    icon: Shield,
    description: "Monitor Active Sessions"
  },
  {
    title: "Login History",
    href: "/admin/login-history",
    icon: Clock,
    description: "Success/Failure Tracking"
  },
  {
    title: "Activity Logs",
    href: "/admin/activity-logs",
    icon: Activity,
    description: "Admin Actions & Events"
  },
  {
    title: "Usage Quotas",
    href: "/admin/quotas",
    icon: FileText,
    description: "Limits & Tracking"
  },
  {
    title: "Credits",
    href: "/admin/credits",
    icon: Coins,
    description: "Balances, Grants & Ledger"
  },
  {
    title: "Cost & Margin",
    href: "/admin/cost-telemetry",
    icon: BarChart3,
    description: "AI COGS & Credit Anchor Validation"
  },
  {
    title: "System Health",
    href: "/admin/health",
    icon: Heart,
    description: "Memory, CPU, DB, Queue"
  },
  {
    title: "Cleanup Manager",
    href: "/admin/cleanup",
    icon: Trash2,
    description: "Retention & Cleanup Jobs"
  },
  {
    title: "Error Logs",
    href: "/admin/error-logs",
    icon: AlertTriangle,
    description: "Generation & AI Failures"
  },
  {
    title: "Content Feedback",
    href: "/admin/feedback",
    icon: ThumbsUp,
    description: "User Ratings & Comments"
  },
  {
    title: "Analytics",
    href: "/admin/analytics",
    icon: BarChart3,
    description: "Trends & Charts"
  },
  {
    title: "Settings",
    href: "/admin/settings",
    icon: Settings,
    description: "Maintenance Mode"
  }
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const { user, isLoading } = useAuth();

  // Auth guard — redirect unauthenticated or non-admin users
  useEffect(() => {
    if (isLoading) return;
    if (!user) { router.replace("/login"); return; }
    if (user.role !== "admin") { router.replace("/home"); return; }
  }, [isLoading, user, router]);

  // ALL hooks must be called unconditionally before any early return.
  // This satisfies React Rules of Hooks even during the loading/redirect state.
  const isAdmin = !isLoading && !!user && user.role === "admin";

  const { data: pendingData } = useQuery<{ count: number }>({
    queryKey: PENDING_COUNT_KEY,
    queryFn: async () => {
      const token = (() => { try { return sessionStorage.getItem("auth_token"); } catch { return null; } })();
      const res = await fetch("/api/admin/pending-count", {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return { count: 0 };
      return res.json();
    },
    enabled: isAdmin,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    staleTime: 20000,
  });

  const pendingCount = pendingData?.count ?? 0;

  // Show spinner while auth resolves or while redirecting
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        router.push("/login");
      } else {
        toast({
          title: "Logout failed",
          description: "Please try again",
          variant: "destructive"
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to logout",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-72 border-r bg-card flex flex-col">
        <div className="p-6 border-b">
          <h1 className="text-2xl font-bold text-primary">Admin Panel</h1>
          <p className="text-sm text-muted-foreground mt-1">Citefi</p>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {adminNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== "/admin" && pathname?.startsWith(item.href));
            const showBadge = item.badgeKey === "pendingApprovals" && pendingCount > 0;
            
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex items-start gap-3 px-3 py-3 rounded-lg transition-colors hover-elevate",
                    isActive ? "bg-primary/10 text-primary" : "text-foreground"
                  )}
                  data-testid={`nav-link-${item.href.replace("/admin", "").replace("/", "") || "dashboard"}`}
                >
                  <Icon className={cn("w-5 h-5 mt-0.5 flex-shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
                  <div className="flex-1 min-w-0">
                    <div className={cn("font-medium text-sm flex items-center gap-2", isActive && "text-primary")}>
                      {item.title}
                      {showBadge && (
                        <Badge
                          variant="destructive"
                          className="text-xs px-1.5 py-0 h-5 min-w-5"
                          data-testid="badge-pending-approvals"
                        >
                          {pendingCount > 99 ? "99+" : pendingCount}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {item.description}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t space-y-2">
          <Link href="/home">
            <Button variant="outline" className="w-full" data-testid="button-back-to-app">
              <Home className="w-4 h-4 mr-2" />
              Back to App
            </Button>
          </Link>
          <Button 
            variant="outline" 
            className="w-full" 
            onClick={handleLogout}
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
