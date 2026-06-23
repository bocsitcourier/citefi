"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, KeyRound, User, ShieldCheck, ShieldOff, Copy, Check, Smartphone, CreditCard, Users, BarChart2, ChevronRight, CalendarDays, Trash2, TriangleAlert, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import Link from "next/link";

type TotpStep = "idle" | "setup" | "verify" | "backup";

interface TotpSetupData {
  qrCodeUrl: string;
  manualEntryKey: string;
  secret: string;
}

interface BillingStatus {
  plan: { id: string; name: string; monthlyCredits: number };
  billing: { status: string; hasActivePlan: boolean };
  credits: { totalRemaining: number };
}

function getAuthHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? sessionStorage.getItem("auth_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatMemberSince(date: string | Date | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function RoleBadge({ role }: { role: string }) {
  const color =
    role === "admin"
      ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
      : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium capitalize ${color}`}>
      {role}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "active"
      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
      : status === "pending"
      ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
      : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium capitalize ${color}`}>
      {status}
    </span>
  );
}

export default function AccountSettingsPage() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const [totpStep, setTotpStep] = useState<TotpStep>("idle");
  const [totpSetupData, setTotpSetupData] = useState<TotpSetupData | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [copiedKey, setCopiedKey] = useState(false);

  const { data: billing } = useQuery<BillingStatus>({
    queryKey: ["/api/billing/status"],
    queryFn: async () => {
      const res = await fetch("/api/billing/status", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    staleTime: 60_000,
  });

  const changePasswordMutation = useMutation({
    mutationFn: async (data: { currentPassword: string; newPassword: string }) => {
      return apiRequest("/api/auth/change-password", { method: "POST", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      toast({ title: "Password changed", description: "Your password has been updated successfully." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const generateTotpMutation = useMutation({
    mutationFn: async (): Promise<TotpSetupData> => {
      return apiRequest("/api/auth/setup-totp", {
        method: "POST",
        body: JSON.stringify({ action: "generate" }),
      });
    },
    onSuccess: (data) => {
      setTotpSetupData(data);
      setVerificationCode("");
      setTotpStep("setup");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const verifyTotpMutation = useMutation({
    mutationFn: async (): Promise<{ backupCodes: string[] }> => {
      return apiRequest("/api/auth/setup-totp", {
        method: "POST",
        body: JSON.stringify({ action: "verify", secret: totpSetupData?.secret, verificationCode }),
      });
    },
    onSuccess: (data) => {
      setBackupCodes(data.backupCodes);
      setTotpStep("backup");
      refreshUser?.();
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "2FA enabled", description: "Google Authenticator is now active on your account." });
    },
    onError: (err: Error) => {
      toast({ title: "Wrong code", description: err.message, variant: "destructive" });
    },
  });

  const disableTotpMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/auth/disable-totp", { method: "POST" });
    },
    onSuccess: () => {
      setTotpStep("idle");
      setTotpSetupData(null);
      setBackupCodes([]);
      refreshUser?.();
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "2FA disabled", description: "Two-factor authentication has been removed from your account." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/account/delete", { method: "POST" });
    },
    onSuccess: () => {
      sessionStorage.removeItem("auth_token");
      toast({ title: "Account deleted", description: "Your account has been permanently deleted." });
      window.location.href = "/login";
    },
    onError: (err: Error) => {
      toast({ title: "Could not delete account", description: err.message, variant: "destructive" });
    },
  });

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", description: "Please make sure both new password fields match.", variant: "destructive" });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: "Password too short", description: "New password must be at least 8 characters.", variant: "destructive" });
      return;
    }
    changePasswordMutation.mutate({ currentPassword, newPassword });
  }

  function copyManualKey() {
    if (totpSetupData?.manualEntryKey) {
      navigator.clipboard.writeText(totpSetupData.manualEntryKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  }

  const userAny = user as any;
  const planLabel = billing ? `${billing.plan.name} · ${billing.credits.totalRemaining.toLocaleString()} credits` : null;

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your profile and security preferences</p>
      </div>

      {/* Account Overview */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-3 pb-4">
          <User className="w-5 h-5 text-muted-foreground" />
          <div>
            <CardTitle className="text-base">Account Overview</CardTitle>
            <CardDescription>Your profile and plan at a glance</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-0">
          <div className="flex items-center justify-between py-2.5 border-b">
            <span className="text-sm text-muted-foreground">Name</span>
            <span className="text-sm font-medium">{userAny?.fullName || "—"}</span>
          </div>
          <div className="flex items-center justify-between py-2.5 border-b">
            <span className="text-sm text-muted-foreground">Email</span>
            <span className="text-sm font-medium">{user?.email}</span>
          </div>
          <div className="flex items-center justify-between py-2.5 border-b">
            <span className="text-sm text-muted-foreground">Role</span>
            <RoleBadge role={user?.role || "user"} />
          </div>
          <div className="flex items-center justify-between py-2.5 border-b">
            <span className="text-sm text-muted-foreground">Account Status</span>
            <StatusBadge status={userAny?.accountStatus || "active"} />
          </div>
          <div className="flex items-center justify-between py-2.5 border-b">
            <span className="text-sm text-muted-foreground flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5" /> Member Since
            </span>
            <span className="text-sm font-medium">{formatMemberSince(userAny?.createdAt)}</span>
          </div>

          <Separator className="my-1" />

          <Link href="/settings/billing" className="flex items-center justify-between py-2.5 border-b hover-elevate rounded-sm px-1 -mx-1 group">
            <span className="text-sm text-muted-foreground flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5" /> Plan &amp; Billing
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium">
                {planLabel ?? <Loader2 className="w-3 h-3 animate-spin inline" />}
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
          </Link>
          <Link href="/client/team" className="flex items-center justify-between py-2.5 border-b hover-elevate rounded-sm px-1 -mx-1 group">
            <span className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> Team
            </span>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          </Link>
          <Link href="/client/usage" className="flex items-center justify-between py-2.5 hover-elevate rounded-sm px-1 -mx-1 group">
            <span className="text-sm text-muted-foreground flex items-center gap-1.5">
              <BarChart2 className="w-3.5 h-3.5" /> Usage &amp; Analytics
            </span>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-3 pb-4">
          <KeyRound className="w-5 h-5 text-muted-foreground" />
          <div>
            <CardTitle className="text-base">Change Password</CardTitle>
            <CardDescription>Update your password to keep your account secure</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="currentPassword">Current Password</Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter your current password"
                autoComplete="current-password"
                data-testid="input-current-password"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newPassword">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                data-testid="input-new-password"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
                autoComplete="new-password"
                data-testid="input-confirm-password"
                required
              />
            </div>
            <Button type="submit" disabled={changePasswordMutation.isPending} data-testid="button-change-password" className="w-full">
              {changePasswordMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Updating...</> : "Change Password"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-3 pb-4">
          <Smartphone className="w-5 h-5 text-muted-foreground" />
          <div>
            <CardTitle className="text-base">Two-Factor Authentication</CardTitle>
            <CardDescription>Add an extra layer of security with Google Authenticator</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {user?.twoFactorEnabled && totpStep === "idle" ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 rounded-md bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800">
                <ShieldCheck className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" />
                <p className="text-sm text-green-700 dark:text-green-300">Google Authenticator is active on your account.</p>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => disableTotpMutation.mutate()}
                disabled={disableTotpMutation.isPending}
                data-testid="button-disable-2fa"
              >
                {disableTotpMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Disabling...</> : <><ShieldOff className="w-4 h-4 mr-2" />Disable 2FA</>}
              </Button>
            </div>
          ) : totpStep === "idle" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Two-factor authentication is not enabled. Enable it to require a code from Google Authenticator each time you log in.
              </p>
              <Button
                className="w-full"
                onClick={() => generateTotpMutation.mutate()}
                disabled={generateTotpMutation.isPending}
                data-testid="button-enable-2fa"
              >
                {generateTotpMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating...</> : <><ShieldCheck className="w-4 h-4 mr-2" />Enable Google Authenticator</>}
              </Button>
            </div>
          ) : totpStep === "setup" && totpSetupData ? (
            <div className="space-y-5">
              <div className="space-y-1">
                <p className="text-sm font-medium">Step 1 — Scan this QR code</p>
                <p className="text-sm text-muted-foreground">Open Google Authenticator on your phone and tap the + button, then scan the QR code below.</p>
              </div>
              <div className="flex justify-center">
                <img
                  src={totpSetupData.qrCodeUrl}
                  alt="Google Authenticator QR code"
                  className="w-44 h-44 rounded-md border"
                  data-testid="img-totp-qr"
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground text-center">Can't scan? Enter this key manually:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-muted px-3 py-2 rounded-md font-mono break-all" data-testid="text-manual-key">
                    {totpSetupData.manualEntryKey}
                  </code>
                  <Button size="icon" variant="outline" onClick={copyManualKey} data-testid="button-copy-key">
                    {copiedKey ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              <Separator />
              <div className="space-y-3">
                <p className="text-sm font-medium">Step 2 — Enter the 6-digit code</p>
                <Input
                  placeholder="000000"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  maxLength={6}
                  className="text-center text-lg tracking-widest font-mono"
                  data-testid="input-totp-code"
                  autoComplete="one-time-code"
                />
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setTotpStep("idle")} data-testid="button-cancel-2fa">
                    Cancel
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={() => verifyTotpMutation.mutate()}
                    disabled={verificationCode.length !== 6 || verifyTotpMutation.isPending}
                    data-testid="button-verify-totp"
                  >
                    {verifyTotpMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Verifying...</> : "Verify & Activate"}
                  </Button>
                </div>
              </div>
            </div>
          ) : totpStep === "backup" ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 rounded-md bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800">
                <ShieldCheck className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" />
                <p className="text-sm text-green-700 dark:text-green-300">Google Authenticator enabled successfully!</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Save your backup codes</p>
                <p className="text-sm text-muted-foreground">Store these in a safe place. Each can be used once to access your account if you lose your phone.</p>
                <div className="grid grid-cols-2 gap-1.5 p-3 bg-muted rounded-md" data-testid="list-backup-codes">
                  {backupCodes.map((code, i) => (
                    <code key={i} className="text-xs font-mono text-center py-1" data-testid={`text-backup-code-${i}`}>{code}</code>
                  ))}
                </div>
              </div>
              <Button className="w-full" onClick={() => setTotpStep("idle")} data-testid="button-done-2fa">
                Done
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Export My Data */}
      <ExportDataCard />

      {/* Danger Zone */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <TriangleAlert className="h-4 w-4" />
            Danger Zone
          </CardTitle>
          <CardDescription>
            Permanently delete your account and all associated data. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="space-y-1">
              <p className="text-sm font-medium">Delete account</p>
              <p className="text-xs text-muted-foreground">
                Cancels any active subscription, removes all your data, and signs you out permanently.
                Accounts that own content (batches, posts, teams) must delete that content first.
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteDialogOpen(true)}
              data-testid="button-delete-account"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Account
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately cancel any active subscription, delete all your data, and sign you
              out. <strong>This action cannot be undone.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-account">
              Keep Account
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteAccountMutation.mutate()}
              disabled={deleteAccountMutation.isPending}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete-account"
            >
              {deleteAccountMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Deleting...</>
              ) : (
                "Yes, Delete My Account"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ExportDataCard() {
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);
  const [showDialog, setShowDialog] = useState(false);

  async function handleExport() {
    setIsPending(true);
    try {
      const token = typeof window !== "undefined" ? sessionStorage.getItem("auth_token") : null;
      const res = await fetch("/api/account/export", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 429) {
          toast({ title: "Rate limit reached", description: body.error ?? "You may request up to 3 exports per hour.", variant: "destructive" });
        } else {
          toast({ title: "Export failed", description: body.error ?? "An error occurred.", variant: "destructive" });
        }
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "citefi-export.json";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Export downloaded", description: "Your account data has been saved to your device." });
    } catch {
      toast({ title: "Export failed", description: "Please try again.", variant: "destructive" });
    } finally {
      setIsPending(false);
      setShowDialog(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Export Your Data</CardTitle>
          <CardDescription>
            Download a JSON file containing your profile, team memberships, activity history, and content metadata. Passwords, tokens, and payment details are never included.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-xs text-muted-foreground">Up to 3 exports per hour. Processing may take a few seconds.</p>
            <Button variant="outline" size="sm" onClick={() => setShowDialog(true)} data-testid="button-export-data">
              <Download className="h-4 w-4 mr-2" />
              Export My Data
            </Button>
          </div>
        </CardContent>
      </Card>
      <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Export account data?</AlertDialogTitle>
            <AlertDialogDescription>
              This will generate a JSON file with your profile, activity log, and content metadata. No secrets or payment data are included. The file will download immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-export">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleExport} disabled={isPending} data-testid="button-confirm-export">
              {isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Preparing...</> : "Download"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

