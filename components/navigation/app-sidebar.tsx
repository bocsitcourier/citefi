"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Zap, LogOut, User } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { NAV_SECTIONS } from "./nav-config";
import { NotificationBell } from "@/components/NotificationBell";
import { CreditMeter } from "@/components/credit-meter";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function AppSidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const isAdmin = user?.role === "admin";

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard" || pathname.startsWith("/dashboard");
    if (href === "/content") return pathname === "/content" || pathname.startsWith("/batches") || pathname.startsWith("/content/");
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <TooltipProvider delayDuration={300}>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Zap className="w-4 h-4" />
            </div>
            {!isCollapsed && (
              <div className="flex flex-col min-w-0">
                <span className="font-semibold text-sm leading-tight truncate">Citefi</span>
                <span className="text-xs text-muted-foreground truncate">Engine</span>
              </div>
            )}
          </div>
        </SidebarHeader>

        <SidebarSeparator />

        {/* Credit meter — only shown when expanded */}
        {!isCollapsed && (
          <div className="px-2 py-1">
            <CreditMeter collapsed={false} />
          </div>
        )}
        {isCollapsed && (
          <div className="flex justify-center py-1">
            <CreditMeter collapsed={true} />
          </div>
        )}

        <SidebarSeparator />

        <SidebarContent>
          {NAV_SECTIONS.map((section) => {
            if (section.adminOnly && !isAdmin) return null;
            return (
              <SidebarGroup key={section.label}>
                <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {section.items.map((item) => {
                      if (item.adminOnly && !isAdmin) return null;
                      const active = isActive(item.href);
                      return (
                        <SidebarMenuItem key={item.href}>
                          <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                            <Link href={item.href} data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                              <item.icon />
                              <span>{item.title}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            );
          })}
        </SidebarContent>

        <SidebarSeparator />

        <SidebarFooter>
          {isCollapsed ? (
            // Collapsed: show avatar + action icons centered
            <div className="flex flex-col items-center gap-1 py-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted cursor-default">
                    <User className="w-4 h-4 text-muted-foreground" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p className="font-medium">{user?.email}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {user?.role === "admin" ? "Admin" : "Team Member"}
                  </p>
                </TooltipContent>
              </Tooltip>
              <div className="flex flex-col items-center gap-0.5">
                <NotificationBell />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={logout}
                      data-testid="button-sidebar-logout"
                      aria-label="Sign out"
                    >
                      <LogOut className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Sign out</TooltipContent>
                </Tooltip>
              </div>
            </div>
          ) : (
            // Expanded: show full user info + action buttons in a row
            <div className="flex items-center gap-2 px-2 py-1">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                <User className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex flex-1 flex-col min-w-0">
                <span className="text-xs font-medium truncate">{user?.email}</span>
                <span className="text-xs text-muted-foreground truncate capitalize">
                  {user?.role === "admin" ? "Admin" : "Team Member"}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <NotificationBell />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={logout}
                      data-testid="button-sidebar-logout"
                      aria-label="Sign out"
                    >
                      <LogOut className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Sign out</TooltipContent>
                </Tooltip>
              </div>
            </div>
          )}
        </SidebarFooter>
      </Sidebar>
    </TooltipProvider>
  );
}
