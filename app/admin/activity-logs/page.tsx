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
import { Loader2, Activity, Shield, User, LogOut, Key, Trash2, UserPlus, Search, Filter, Download } from "lucide-react";
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
  adminUserId: number;
  adminEmail: string | null;
  adminName: string | null;
  action: string;
  targetUserId: number | null;
  targetUserEmail: string | null;
  ipAddress: string;
  metadata: any;
  createdAt: string;
}

export default function AdminActivityLogsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
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

  if (actionFilter !== "all") {
    queryParams.set("action", actionFilter);
  }

  const { data: logs, isLoading } = useQuery<ActivityLogData[]>({
    queryKey: ["/api/admin/activity-logs", page, actionFilter],
    enabled: user.role === "admin",
  });

  const getActionBadge = (action: string) => {
    const actionConfig: Record<string, { icon: any; label: string; className: string }> = {
      role_changed: { icon: Shield, label: "Role Changed", className: "bg-blue-500" },
      force_logout: { icon: LogOut, label: "Force Logout", className: "bg-orange-500" },
      password_reset_override: { icon: Key, label: "Password Reset", className: "bg-purple-500" },
      user_deleted: { icon: Trash2, label: "User Deleted", className: "bg-destructive" },
      user_invited: { icon: UserPlus, label: "User Invited", className: "bg-green-500" },
      "2fa_enforcement_toggled": { icon: Shield, label: "2FA Toggled", className: "bg-indigo-500" },
      invite_revoked: { icon: UserPlus, label: "Invite Revoked", className: "bg-yellow-500" },
    };

    const config = actionConfig[action] || { icon: Activity, label: action, className: "bg-gray-500" };
    const Icon = config.icon;

    return (
      <Badge variant="default" className={config.className}>
        <Icon className="h-3 w-3 mr-1" />
        {config.label}
      </Badge>
    );
  };

  const filteredLogs = logs?.filter(log => 
    !searchQuery || 
    log.adminEmail?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    log.targetUserEmail?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleExport = (format: 'csv' | 'json') => {
    const params = new URLSearchParams({
      format,
      type: 'admin_actions',
    });

    if (actionFilter !== 'all') {
      params.set('action', actionFilter);
    }

    window.open(`/api/admin/export/audit-logs?${params.toString()}`, '_blank');
  };

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
        <p className="text-muted-foreground">Monitor all administrative actions and user management activities</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Actions</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{logs?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unique Admins</CardTitle>
            <User className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {new Set(logs?.map(l => l.adminUserId)).size || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Critical Actions</CardTitle>
            <Trash2 className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">
              {logs?.filter(l => l.action === 'user_deleted' || l.action === 'force_logout').length || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <CardTitle>Admin Actions</CardTitle>
              <CardDescription>Complete audit trail of all administrative activities</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 w-[200px]"
                  data-testid="input-search-logs"
                />
              </div>
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger className="w-[180px]" data-testid="select-action-filter">
                  <SelectValue placeholder="Filter by action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="role_changed">Role Changed</SelectItem>
                  <SelectItem value="force_logout">Force Logout</SelectItem>
                  <SelectItem value="password_reset_override">Password Reset</SelectItem>
                  <SelectItem value="user_deleted">User Deleted</SelectItem>
                  <SelectItem value="user_invited">User Invited</SelectItem>
                  <SelectItem value="2fa_enforcement_toggled">2FA Toggled</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={() => handleExport('csv')}
                data-testid="button-export-csv"
              >
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!filteredLogs || filteredLogs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No activity logs found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead>Target User</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.map((log) => (
                  <TableRow key={log.id} data-testid={`row-log-${log.id}`}>
                    <TableCell>{getActionBadge(log.action)}</TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{log.adminName || "Unknown"}</div>
                        <div className="text-sm text-muted-foreground">{log.adminEmail}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {log.targetUserEmail ? (
                        <span className="text-sm">{log.targetUserEmail}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-mono">{log.ipAddress}</span>
                    </TableCell>
                    <TableCell>{format(new Date(log.createdAt), "PPpp")}</TableCell>
                    <TableCell>
                      {log.metadata && Object.keys(log.metadata).length > 0 ? (
                        <div className="text-xs text-muted-foreground max-w-[200px] truncate">
                          {JSON.stringify(log.metadata)}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
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
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">Page {page + 1}</span>
            <Button
              variant="outline"
              onClick={() => setPage(page + 1)}
              disabled={!logs || logs.length < pageSize}
            >
              Next
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
