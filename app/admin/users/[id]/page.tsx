"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  ArrowLeft, Loader2, Shield, User, Mail, Calendar, LogOut, Key, Trash2, Ban, CheckCircle2,
  ShieldCheck, ShieldOff, ShieldAlert, Copy, Check, CreditCard, Activity, FileText, Lock, Zap
} from "lucide-react";
import Link from "next/link";

interface DetailData {
  user: {
    id: number;
    email: string;
    fullName: string | null;
    role: string;
    accountStatus: string;
    emailVerified: number;
    twoFactorEnabled: number;
    twoFactorMethod: string | null;
    createdAt: string;
    lastLoginAt: string | null;
  };
  billing: {
    teamId: number;
    teamName: string;
    memberRole: string;
    joinedAt: string;
    billingPlan: string;
    billingStatus: string;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
  } | null;
  credits: { totalRemaining: number };
  recentActivity: Array<{
    id: number;
    action: string;
    resource: string | null;
    severity: string;
    ipAddress: string | null;
    createdAt: string;
  }>;
  recentLogins: Array<{
    id: number;
    success: number;
    failureReason: string | null;
    ipAddress: string;
    userAgent: string | null;
    country: string | null;
    city: string | null;
    browser: string | null;
    os: string | null;
    deviceType: string | null;
    createdAt: string;
  }>;
  articleCount: number;
}

function getAuthHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? sessionStorage.getItem("auth_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function RoleBadge({ role }: { role: string }) {
  return (
    <Badge variant={role === "admin" ? "default" : "secondary"} className="capitalize">
      {role}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    pending_approval: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    suspended: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium capitalize ${colors[status] ?? "bg-muted text-muted-foreground"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    info: "bg-muted text-muted-foreground",
    warning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    error: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    critical: "bg-red-200 text-red-900 dark:bg-red-900/50 dark:text-red-300",
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${colors[severity] ?? colors.info}`}>
      {severity}
    </span>
  );
}

function fmt(date: string | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtDate(date: string | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function UserAvatar({ name, email }: { name: string | null; email: string }) {
  const initials = name
    ? name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : email[0].toUpperCase();
  return (
    <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
      <span className="text-xl font-semibold text-primary">{initials}</span>
    </div>
  );
}

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const userId = params?.id;

  const [resetUrlDialog, setResetUrlDialog] = useState(false);
  const [resetUrl, setResetUrl] = useState("");
  const [copied, setCopied] = useState(false);

  const { data, isLoading, refetch } = useQuery<DetailData>({
    queryKey: ["/api/admin/users", userId, "detail"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/${userId}/detail`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load user details");
      return res.json();
    },
    enabled: !!userId,
  });

  async function runAction(path: string, method = "POST", body?: object) {
    try {
      await apiRequest(path, { method, body: body ? JSON.stringify(body) : undefined });
      refetch();
      return true;
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      return false;
    }
  }

  const changeRoleMutation = useMutation({
    mutationFn: async (newRole: string) => {
      return apiRequest(`/api/admin/users/${userId}/change-role`, {
        method: "POST",
        body: JSON.stringify({ newRole }),
      });
    },
    onSuccess: () => {
      toast({ title: "Role updated" });
      refetch();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/admin/users/${userId}/reset-password`, { method: "POST" });
    },
    onSuccess: (data: any) => {
      setResetUrl(data?.resetUrl ?? "");
      setResetUrlDialog(true);
      refetch();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function copyResetUrl() {
    navigator.clipboard.writeText(resetUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">User not found.</p>
        <Link href="/admin/users">
          <Button variant="outline" className="mt-4">Back to Users</Button>
        </Link>
      </div>
    );
  }

  const { user, billing, credits, recentActivity, recentLogins } = data;
  const isSuspended = user.accountStatus === "suspended";

  const creditTotal = credits?.totalRemaining ?? 0;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Back */}
      <Link href="/admin/users">
        <Button variant="ghost" size="sm" className="text-muted-foreground" data-testid="button-back-to-users">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Users
        </Button>
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-center gap-4">
        <UserAvatar name={user.fullName} email={user.email} />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold" data-testid="text-user-name">
            {user.fullName ?? user.email}
          </h1>
          <p className="text-sm text-muted-foreground" data-testid="text-user-email">{user.email}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <RoleBadge role={user.role} />
            <StatusBadge status={user.accountStatus} />
            {user.twoFactorEnabled ? (
              <Badge variant="outline" className="text-xs">
                <ShieldCheck className="w-3 h-3 mr-1 text-green-600" /> 2FA on
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Zap className="w-3.5 h-3.5" />
              <span className="text-xs">Credits Balance</span>
            </div>
            <div className="text-2xl font-bold tabular-nums" data-testid="text-credits-balance">{creditTotal.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <FileText className="w-3.5 h-3.5" />
              <span className="text-xs">Content Events</span>
            </div>
            <div className="text-2xl font-bold tabular-nums" data-testid="text-article-count">{data.articleCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Activity className="w-3.5 h-3.5" />
              <span className="text-xs">Last Login</span>
            </div>
            <div className="text-sm font-semibold" data-testid="text-last-login">
              {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : "Never"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Calendar className="w-3.5 h-3.5" />
              <span className="text-xs">Member Since</span>
            </div>
            <div className="text-sm font-semibold" data-testid="text-member-since">
              {new Date(user.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main content + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tabs */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="overview">
            <TabsList className="w-full">
              <TabsTrigger value="overview" className="flex-1">Overview</TabsTrigger>
              <TabsTrigger value="activity" className="flex-1">Activity</TabsTrigger>
              <TabsTrigger value="security" className="flex-1">Security</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <User className="w-4 h-4" /> Account Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-0">
                  {[
                    ["Email", user.email],
                    ["Full Name", user.fullName ?? "—"],
                    ["Role", <RoleBadge key="role" role={user.role} />],
                    ["Status", <StatusBadge key="status" status={user.accountStatus} />],
                    ["Email Verified", user.emailVerified ? "Yes" : "No"],
                    ["2FA", user.twoFactorEnabled ? `Enabled (${user.twoFactorMethod ?? "totp"})` : "Disabled"],
                    ["Member Since", fmtDate(user.createdAt)],
                    ["Team", billing?.teamName ?? "—"],
                    ["Team Role", billing?.memberRole ?? "—"],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="flex items-center justify-between py-2 border-b last:border-b-0">
                      <span className="text-sm text-muted-foreground">{label}</span>
                      <span className="text-sm font-medium">{value}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {billing && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <CreditCard className="w-4 h-4" /> Billing
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-0">
                    {[
                      ["Plan", billing.billingPlan],
                      ["Status", billing.billingStatus],
                      ["Customer ID", billing.stripeCustomerId ?? "—"],
                      ["Subscription ID", billing.stripeSubscriptionId ?? "—"],
                      ["Renews / Cancels", billing.cancelAtPeriodEnd ? `Cancels ${fmtDate(billing.currentPeriodEnd)}` : billing.currentPeriodEnd ? `Renews ${fmtDate(billing.currentPeriodEnd)}` : "—"],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="flex items-center justify-between py-2 border-b last:border-b-0">
                        <span className="text-sm text-muted-foreground">{label}</span>
                        <span className="text-sm font-medium font-mono">{value}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="activity" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Recent Activity</CardTitle>
                  <CardDescription>Last 20 events for this user</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  {recentActivity.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No activity recorded</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Action</TableHead>
                          <TableHead>Resource</TableHead>
                          <TableHead>Severity</TableHead>
                          <TableHead>IP</TableHead>
                          <TableHead>When</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {recentActivity.map((a) => (
                          <TableRow key={a.id}>
                            <TableCell className="font-mono text-xs">{a.action}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{a.resource ?? "—"}</TableCell>
                            <TableCell><SeverityBadge severity={a.severity} /></TableCell>
                            <TableCell className="text-xs text-muted-foreground font-mono">{a.ipAddress ?? "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(a.createdAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="security" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Login History</CardTitle>
                  <CardDescription>Last 10 login attempts</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  {recentLogins.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No login history</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Status</TableHead>
                          <TableHead>IP</TableHead>
                          <TableHead>Browser / OS</TableHead>
                          <TableHead>When</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {recentLogins.map((l) => (
                          <TableRow key={l.id}>
                            <TableCell>
                              {l.success ? (
                                <Badge variant="outline" className="text-xs text-green-700 border-green-300 dark:text-green-400 dark:border-green-700">
                                  <CheckCircle2 className="w-3 h-3 mr-1" /> Success
                                </Badge>
                              ) : (
                                <Badge variant="destructive" className="text-xs">
                                  <Ban className="w-3 h-3 mr-1" /> {l.failureReason ?? "Failed"}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-xs font-mono">{l.ipAddress}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {[l.browser, l.os].filter(Boolean).join(" / ") || (l.userAgent?.slice(0, 40) + "…") || "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(l.createdAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Quick Actions */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {/* Change Role */}
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Change Role</p>
                <Select
                  value={user.role}
                  onValueChange={(val) => changeRoleMutation.mutate(val)}
                  disabled={changeRoleMutation.isPending}
                >
                  <SelectTrigger className="w-full" data-testid="select-change-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="team_member">Team Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5 pt-1">
                {/* Suspend / Unsuspend */}
                {isSuspended ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" className="w-full" data-testid="button-unsuspend">
                        <CheckCircle2 className="w-4 h-4 mr-2 text-green-600" /> Unsuspend Account
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Unsuspend {user.email}?</AlertDialogTitle>
                        <AlertDialogDescription>They will regain access to their account immediately.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => runAction(`/api/admin/users/${userId}/unsuspend`)}>
                          Confirm
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" className="w-full text-destructive border-destructive/30" data-testid="button-suspend">
                        <Ban className="w-4 h-4 mr-2" /> Suspend Account
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Suspend {user.email}?</AlertDialogTitle>
                        <AlertDialogDescription>They will be immediately logged out and unable to sign in.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground"
                          onClick={() => runAction(`/api/admin/users/${userId}/suspend`)}
                        >
                          Suspend
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                {/* Force Logout */}
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => runAction(`/api/admin/users/${userId}/force-logout`).then((ok) => ok && toast({ title: "Sessions revoked" }))}
                  data-testid="button-force-logout"
                >
                  <LogOut className="w-4 h-4 mr-2" /> Force Logout
                </Button>

                {/* Reset Password */}
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => resetPasswordMutation.mutate()}
                  disabled={resetPasswordMutation.isPending}
                  data-testid="button-reset-password"
                >
                  {resetPasswordMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Key className="w-4 h-4 mr-2" />}
                  Reset Password
                </Button>

                {/* Delete */}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" className="w-full text-destructive border-destructive/30" data-testid="button-delete-user">
                      <Trash2 className="w-4 h-4 mr-2" /> Delete Account
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {user.email}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently deletes the account. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground"
                        onClick={() =>
                          runAction(`/api/admin/users/${userId}/delete`, "DELETE").then(
                            (ok) => ok && router.push("/admin/users")
                          )
                        }
                      >
                        Delete Permanently
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Reset Password URL Dialog */}
      <Dialog open={resetUrlDialog} onOpenChange={setResetUrlDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Password Reset Link</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            A reset link has been emailed to {user.email}. You can also copy it manually:
          </p>
          <div className="flex items-center gap-2 mt-2">
            <code className="flex-1 text-xs bg-muted px-3 py-2 rounded-md font-mono break-all" data-testid="text-reset-url">
              {resetUrl}
            </code>
            <Button size="icon" variant="outline" onClick={copyResetUrl} data-testid="button-copy-reset-url">
              {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Expires in 24 hours.</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
