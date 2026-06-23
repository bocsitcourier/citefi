"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, Lock, CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";

type State = "loading" | "invalid" | "valid" | "success";

export default function ResetPasswordTokenPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const token = params?.token ?? "";

  const [state, setState] = useState<State>("loading");
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(3);

  const validateToken = useCallback(async () => {
    if (!token) {
      setState("invalid");
      return;
    }
    try {
      const res = await fetch(`/api/auth/reset-password-token?token=${encodeURIComponent(token)}`);
      if (res.ok) {
        const data = await res.json();
        setEmail(data.email ?? "");
        setState("valid");
      } else {
        setState("invalid");
      }
    } catch {
      setState("invalid");
    }
  }, [token]);

  useEffect(() => {
    validateToken();
  }, [validateToken]);

  useEffect(() => {
    if (state !== "success") return;
    const id = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(id);
          router.replace("/login");
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [state, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", description: "Both fields must match.", variant: "destructive" });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: "Password too short", description: "Must be at least 8 characters.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reset password");
      setState("success");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  }

  const strength = newPassword.length === 0 ? null : newPassword.length < 8 ? "weak" : newPassword.length < 12 ? "good" : "strong";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Lock className="w-6 h-6 text-primary" />
            </div>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Set New Password</h1>
          <p className="text-sm text-muted-foreground">Create a strong password to secure your account</p>
        </div>

        {state === "loading" && (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Verifying your reset link…</p>
          </div>
        )}

        {state === "invalid" && (
          <div className="rounded-lg border bg-card p-6 space-y-4 text-center shadow-sm">
            <div className="flex justify-center">
              <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <XCircle className="w-6 h-6 text-destructive" />
              </div>
            </div>
            <div>
              <p className="font-medium">Link Expired or Invalid</p>
              <p className="text-sm text-muted-foreground mt-1">
                This password reset link is no longer valid. Links expire after 24 hours.
              </p>
            </div>
            <Link href="/forgot-password">
              <Button className="w-full" data-testid="button-request-new-link">
                Request a New Link
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="ghost" className="w-full" data-testid="button-back-to-login">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Login
              </Button>
            </Link>
          </div>
        )}

        {state === "valid" && (
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            {email && (
              <p className="text-sm text-muted-foreground mb-5">
                Resetting password for <span className="font-medium text-foreground">{email}</span>
              </p>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="newPassword">New Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  autoFocus
                  data-testid="input-new-password"
                  required
                />
                {strength && (
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex gap-1 flex-1">
                      {["weak", "good", "strong"].map((level, i) => (
                        <div
                          key={level}
                          className={`h-1 flex-1 rounded-full transition-colors ${
                            (strength === "weak" && i === 0) ||
                            (strength === "good" && i <= 1) ||
                            strength === "strong"
                              ? strength === "weak"
                                ? "bg-destructive"
                                : strength === "good"
                                ? "bg-yellow-500"
                                : "bg-green-500"
                              : "bg-muted"
                          }`}
                        />
                      ))}
                    </div>
                    <span className={`text-xs ${strength === "weak" ? "text-destructive" : strength === "good" ? "text-yellow-600 dark:text-yellow-400" : "text-green-600 dark:text-green-400"}`}>
                      {strength === "weak" ? "Too short" : strength === "good" ? "Good" : "Strong"}
                    </span>
                  </div>
                )}
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
                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-xs text-destructive mt-1">Passwords do not match</p>
                )}
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting || newPassword.length < 8 || newPassword !== confirmPassword}
                data-testid="button-reset-password"
              >
                {isSubmitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Updating…</> : "Update Password"}
              </Button>
            </form>
            <div className="mt-4 text-center">
              <Link href="/login">
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  <ArrowLeft className="w-3 h-3 mr-1" />
                  Back to Login
                </Button>
              </Link>
            </div>
          </div>
        )}

        {state === "success" && (
          <div className="rounded-lg border bg-card p-6 space-y-4 text-center shadow-sm">
            <div className="flex justify-center">
              <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <div>
              <p className="font-semibold text-lg">Password Updated</p>
              <p className="text-sm text-muted-foreground mt-1">
                Your password has been changed successfully.
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              Redirecting to login in <span className="font-medium text-foreground">{countdown}</span>s…
            </p>
            <Link href="/login">
              <Button className="w-full" data-testid="button-go-to-login">
                Go to Login
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
