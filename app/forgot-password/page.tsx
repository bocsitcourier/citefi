"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, Mail, Lock, KeyRound } from "lucide-react";
import Link from "next/link";

type Step = "email" | "reset";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("email");
  const [isLoading, setIsLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to send reset code");
      }

      // In development, auto-fill code if returned by API
      if (data.code) {
        setCode(data.code);
        toast({
          title: "Development mode",
          description: `Reset code: ${data.code} (auto-filled for testing)`,
        });
      } else {
        toast({
          title: "Code sent",
          description: "Check your email for a 6-digit reset code.",
        });
      }

      setStep("reset");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Something went wrong. Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast({
        variant: "destructive",
        title: "Passwords don't match",
        description: "Please make sure both passwords are identical.",
      });
      return;
    }

    if (newPassword.length < 8) {
      toast({
        variant: "destructive",
        title: "Password too short",
        description: "Password must be at least 8 characters.",
      });
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, newPassword }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to reset password");
      }

      toast({
        title: "Password reset",
        description: "Your password has been updated. You can now log in.",
      });

      router.replace("/login");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Reset failed",
        description: error.message || "Invalid or expired code. Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Side - Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md space-y-8">
          {/* Logo */}
          <div>
            <span className="font-bold text-2xl text-foreground tracking-tight">citefi.co</span>
          </div>

          {step === "email" ? (
            <>
              <div className="space-y-2">
                <h1 className="text-4xl font-bold" data-testid="text-page-title">
                  Forgot Password
                </h1>
                <p className="text-muted-foreground">
                  Enter your email and we'll send you a reset code.
                </p>
              </div>

              <form onSubmit={handleSendCode} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm text-muted-foreground">
                    Email address
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={isLoading}
                      className="h-12 bg-muted/50 pl-10"
                      data-testid="input-email"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 text-base bg-foreground text-background hover:bg-foreground/90"
                  disabled={isLoading}
                  data-testid="button-send-code"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    "Send Reset Code"
                  )}
                </Button>

                <Link
                  href="/login"
                  className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="link-back-login"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to login
                </Link>
              </form>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <h1 className="text-4xl font-bold" data-testid="text-page-title">
                  Reset Password
                </h1>
                <p className="text-muted-foreground">
                  Enter the 6-digit code sent to <span className="font-medium text-foreground">{email}</span> and choose a new password.
                </p>
              </div>

              <form onSubmit={handleResetPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="code" className="text-sm text-muted-foreground">
                    Reset code
                  </Label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="code"
                      type="text"
                      placeholder="000000"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      required
                      disabled={isLoading}
                      className="h-12 bg-muted/50 pl-10 tracking-widest text-center text-lg font-mono"
                      maxLength={6}
                      data-testid="input-code"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new-password" className="text-sm text-muted-foreground">
                    New password
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="new-password"
                      type="password"
                      placeholder="Min. 8 characters"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      disabled={isLoading}
                      className="h-12 bg-muted/50 pl-10"
                      data-testid="input-new-password"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm-password" className="text-sm text-muted-foreground">
                    Confirm new password
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="confirm-password"
                      type="password"
                      placeholder="Repeat your new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      disabled={isLoading}
                      className="h-12 bg-muted/50 pl-10"
                      data-testid="input-confirm-password"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 text-base bg-foreground text-background hover:bg-foreground/90"
                  disabled={isLoading || code.length < 6}
                  data-testid="button-reset-password"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Resetting...
                    </>
                  ) : (
                    "Reset Password"
                  )}
                </Button>

                <button
                  type="button"
                  onClick={() => setStep("email")}
                  className="flex items-center justify-center gap-2 w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="button-back-to-email"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Use a different email
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      {/* Right Side - Background */}
      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-primary/20 via-purple-500/20 to-blue-500/20 items-center justify-center p-8">
        <div className="relative w-full h-full max-w-2xl max-h-[800px] rounded-3xl overflow-hidden shadow-2xl">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-400 via-purple-500 to-indigo-600 opacity-90" />
          <div className="absolute inset-0 flex items-center justify-center p-12">
            <div className="text-center space-y-6 text-white">
              <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center mx-auto">
                <Lock className="w-10 h-10" />
              </div>
              <h2 className="text-4xl font-bold leading-tight">
                Secure Reset
              </h2>
              <p className="text-lg opacity-90 max-w-sm">
                Your account security is important to us. Reset codes expire in 15 minutes.
              </p>
              <div className="pt-4 space-y-3 text-sm opacity-80">
                <p>Check your inbox and spam folder</p>
                <p>Codes are 6 digits and expire in 15 minutes</p>
                <p>Contact your admin if you need help</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
