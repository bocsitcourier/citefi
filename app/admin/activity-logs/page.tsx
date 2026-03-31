"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  Loader2,
  Activity,
  AlertTriangle,
  User,
  LogOut,
  LogIn,
  Key,
  UserPlus,
  Search,
  Filter,
  FileText,
  Shield,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";

interface ActivityLogData {
  id: number;
  userId: number | null;
  teamId: number | null;
  userEmail: string | null;
  userName: string | null;
  action: string;
  resource: string | null;
  resourceId: number | null;
  targetType: string | null;
  targetPublicId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  details: any;
  severity: string;
  createdAt: string;
}

export default function AdminActivityLogsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  useEffect(() => {
    if (!isAuthLoading && user && user.role !== "admin") {
      router.replace("/home");
    }
  }, [user, isAuthLoading, router]);

  if (isAuthLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return null;
  }

  const queryParams = new URLSearchParams({
    limit: pageSize.toString(),
    offset: (page * pageSize).toString(),
  });

  if (actionFilter !== "all") queryParams.set("action", actionFilter);
  if (severityFilter !== "all") queryParams.set("severity", severityFilter);

  const { data: logs, isLoading } = useQuery<ActivityLogData[]>({
    queryKey: ["/api/admin/activity-logs", page, actionFilter, severityFilter],
    enabled: user.role === "admin",
  });

  const getActionBadge = (action: string, severity: string) => {
    const actionConfig: Record<string, { icon: any; label: string }> = {
      login: { icon: LogIn, label: "Login" },
      login_failed: { icon: LogIn, label: "Login Failed" },
      logout: { icon: LogOut, label: "Logout" },
      signup: { icon: UserPlus, label: "Sign Up" },
      password_change: { icon: Key, label: "Password Changed" },
      forgot_password: { icon: Key, label: "Forgot Password" },
      reset_password: { icon: Key, label: "Password Reset" },
      totp_setup: { icon: Shield, label: "2FA Setup" },
      totp_disabled: { icon: Shield, label: "2FA Disabled" },
      totp_verified: { icon: Shield, label: "2FA Verified" },
      email_code_sent: { icon: Key, label: "Email Code Sent" },
      content_generate: { icon: FileText, label: "Content Generated" },
      article_complete: { icon: FileText, label: "Article Complete" },
      user_approved: { icon: User, label: "User Approved" },
      user_suspended: { icon: User, label: "User Suspended" },
    };

    const severityColors: Record<string, string> = {
      info: "bg-blue-500",
      warning: "bg-yellow-600",
      error: "bg-destructive",
      critical: "bg-destructive",
    };

    const config = actionConfig[action] || { icon: Activity, label: action.replace(/_/g, " ") };
    const Icon = config.icon;
    const colorClass = severityColors[severity] || "bg-muted-foreground";

    return (
      <Badge variant="default" className={colorClass}>
        <Icon className="h-3 w-3 mr-1" />
        {config.label}
      </Badge>
    );
  };

  const getSeverityBadge = (severity: string) => {
    const colors: Record<string, string> = {
      info: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
      warning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
      error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
      critical: "bg-red-200 text-red-900 dark:bg-red-950 dark:text-red-100",
    };
    return (
      <Badge variant="outline" className={colors[severity] || ""}>
        {severity}
      </Badge>
    );
  };

  const filteredLogs = logs?.filter((log) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      log.userEmail?.toLowerCase().includes(q) ||
      log.userName?.toLowerCase().includes(q) ||
      log.action.toLowerCase().includes(q) ||
      log.ipAddress?.toLowerCase().includes(q)
    );
  });

  const warningCount = logs?.filter((l) => l.severity === "warning" || l.severity === "error" || l.severity === "critical").length || 0;
  const uniqueUsers = new Set(logs?.filter(l => l.userId).map(l => l.userId)).size;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-admin-activity-logs-title">Activity Logs</h1>
        <p className="text-muted-foreground">Monitor user activity, authentication events, and platform actions</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Events</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-events">{logs?.length || 0}</div>
            <p className="text-xs text-muted-foreground">on this page</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unique Users</CardTitle>
            <User className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-unique-users">{uniqueUsers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Warnings &amp; Errors</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive" data-testid="text-warning-count">{warningCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <CardTitle>Event Log</CardTitle>
              <CardDescription>All platform activity — logins, content generation, auth events</CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by user or IP..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 w-[200px]"
                  data-testid="input-search-logs"
                />
              </div>
              <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(0); }}>
                <SelectTrigger className="w-[180px]" data-testid="select-action-filter">
                  <SelectValue placeholder="Filter by action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="login">Login</SelectItem>
                  <SelectItem value="login_failed">Login Failed</SelectItem>
                  <SelectItem value="logout">Logout</SelectItem>
                  <SelectItem value="signup">Sign Up</SelectItem>
                  <SelectItem value="password_change">Password Changed</SelectItem>
                  <SelectItem value="reset_password">Password Reset</SelectItem>
                  <SelectItem value="forgot_password">Forgot Password</SelectItem>
                  <SelectItem value="totp_setup">2FA Setup</SelectItem>
                  <SelectItem value="totp_disabled">2FA Disabled</SelectItem>
                  <SelectItem value="content_generate">Content Generated</SelectItem>
                  <SelectItem value="article_complete">Article Complete</SelectItem>
                  <SelectItem value="user_approved">User Approved</SelectItem>
                  <SelectItem value="user_suspended">User Suspended</SelectItem>
                </SelectContent>
              </Select>
              <Select value={severityFilter} onValueChange={(v) => { setSeverityFilter(v); setPage(0); }}>
                <SelectTrigger className="w-[140px]" data-testid="select-severity-filter">
                  <SelectValue placeholder="Severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Severities</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!filteredLogs || filteredLogs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-logs">
              No activity logs found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.map((log) => (
                  <TableRow key={log.id} data-testid={`row-log-${log.id}`}>
                    <TableCell>{getActionBadge(log.action, log.severity)}</TableCell>
                    <TableCell>{getSeverityBadge(log.severity)}</TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{log.userName || "System"}</div>
                        <div className="text-sm text-muted-foreground">{log.userEmail || "—"}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-mono">{log.ipAddress || "—"}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {format(new Date(log.createdAt), "PPp")}
                    </TableCell>
                    <TableCell>
                      {log.details && Object.keys(log.details).length > 0 ? (
                        <div className="text-xs text-muted-foreground max-w-[200px] truncate">
                          {JSON.stringify(log.details)}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="flex items-center justify-between mt-4">
            <Button
              variant="outline"
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              data-testid="button-prev-page"
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">Page {page + 1}</span>
            <Button
              variant="outline"
              onClick={() => setPage(page + 1)}
              disabled={!logs || logs.length < pageSize}
              data-testid="button-next-page"
            >
              Next
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
