"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  MapPin,
  Brain,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-mark";
import { BILLING_PLANS } from "@/lib/billing/plans";
import { marketingPlan, planLoginPath, planPricingPath, saveMarketingPlanIntent } from "@/lib/marketing/plan-intent";

function PasswordRequirement({ met, label }: { met: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {met ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
      ) : (
        <XCircle className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
      )}
      <span className={`text-xs ${met ? "text-green-500" : "text-muted-foreground"}`}>
        {label}
      </span>
    </div>
  );
}

export default function SignupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signup, user } = useAuth();
  const { toast } = useToast();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [teamName, setTeamName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [duplicateEmail, setDuplicateEmail] = useState(false);
  const trialSignup = searchParams.get("trial") === "1";
  const selectedPlan = trialSignup ? undefined : marketingPlan(searchParams.get("plan"));
  const selectedAnnual = searchParams.get("interval") === "annual";
  useEffect(() => {
    if (selectedPlan) saveMarketingPlanIntent(selectedPlan, selectedAnnual);
  }, [selectedPlan, selectedAnnual]);

  useEffect(() => {
    if (user) router.replace(selectedPlan ? planPricingPath(selectedPlan, selectedAnnual) : "/home");
  }, [user, router, selectedPlan, selectedAnnual]);

  const reqs = {
    minLength: password.length >= 8,
    hasUpperCase: /[A-Z]/.test(password),
    hasLowerCase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecialChar: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password),
  };
  const isPasswordValid = Object.values(reqs).every(Boolean);
  const doPasswordsMatch = password === confirmPassword && confirmPassword.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPasswordValid) {
      toast({ variant: "destructive", title: "Weak password", description: "Please meet all password requirements." });
      return;
    }
    if (!doPasswordsMatch) {
      toast({ variant: "destructive", title: "Passwords don't match", description: "Please ensure both passwords are identical." });
      return;
    }
    setIsLoading(true);
    try {
      const trialToken = trialSignup && process.env.NODE_ENV === "development"
        ? sessionStorage.getItem("citefi-trial-dev") || undefined
        : undefined;
      await signup(email, password, fullName, teamName || undefined, trialToken);
      if (trialSignup) {
        router.replace("/free-article");
      } else {
        setSubmitted(true);
      }
    } catch (error: any) {
      const message = error.message || "Failed to create account. Please try again.";
      setDuplicateEmail(/already exists|already registered|email.*(taken|in use)|duplicate/i.test(message));
      toast({
        variant: "destructive",
        title: /already exists|already registered|email.*(taken|in use)|duplicate/i.test(message) ? "This email already has an account" : "Signup failed",
        description: message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-green-500" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold" data-testid="text-signup-success">Account requested</h1>
            <p className="text-muted-foreground text-sm leading-relaxed">
              We&apos;ve received your registration for <strong>{email}</strong>.
              An admin will review your account. You can log in to your workspace after approval.
            </p>
          </div>
          {selectedPlan && <p className="text-sm text-muted-foreground">Your selected plan is {BILLING_PLANS[selectedPlan].name}. After approval, sign in to review the current price and complete checkout. Registration does not start a paid subscription.</p>}
          <Link href={planLoginPath(selectedPlan, selectedAnnual)}>
            <Button className="w-full" data-testid="button-go-to-login">
              Back to login
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Left Side — Signup Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background overflow-y-auto">
        <div className="w-full max-w-md space-y-8 py-8">
          {/* Logo */}
          <div>
            <Link href="/" aria-label="Citefi home" className="inline-flex items-center hover:opacity-80 transition-opacity">
              <BrandLogo decorative className="h-10 w-auto" />
            </Link>
          </div>

          {/* Heading */}
          <div className="space-y-2">
            <h1 className="text-4xl font-bold" data-testid="text-signup-heading">
              {trialSignup ? "Read your full article" : "Create your Citefi account"}
            </h1>
            <p className="text-muted-foreground">
              {trialSignup ? "Your draft is ready. Create an account to read the same full article with a watermark. Workspace access follows account approval." : "Create articles, images, social content, podcasts and video in a connected marketing workspace. Account approval is required before workspace access and paid checkout."}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {duplicateEmail && <div role="alert" className="rounded-lg border border-accent/40 bg-accent/10 p-4 text-sm leading-6"><b>This email is already registered.</b><p className="mt-1 text-muted-foreground">Sign in with that account to continue to your article. After a successful login, open the trial reader to claim the article if the account is active.</p><Link className="mt-2 inline-flex font-semibold underline underline-offset-4" href="/login?redirect=%2Ffree-article">Sign in and return to the article</Link></div>}
            {/* Full Name */}
            <div className="space-y-2">
              <Label htmlFor="fullName" className="text-sm text-muted-foreground">
                Full Name
              </Label>
              <Input
                id="fullName"
                type="text"
                placeholder="Jane Smith"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                disabled={isLoading}
                className="h-12 bg-muted/50"
                data-testid="input-full-name"
              />
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm text-muted-foreground">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isLoading}
                className="h-12 bg-muted/50"
                data-testid="input-email"
              />
            </div>

            {/* Team Name (optional) */}
            <div className="space-y-2">
              <Label htmlFor="teamName" className="text-sm text-muted-foreground">
                Team / Agency Name{" "}
                <span className="text-muted-foreground/60 font-normal">(optional)</span>
              </Label>
              <Input
                id="teamName"
                type="text"
                placeholder="Acme Marketing Agency"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                disabled={isLoading}
                className="h-12 bg-muted/50"
                data-testid="input-team-name"
              />
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm text-muted-foreground">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={isLoading}
                  className="h-12 bg-muted/50 pr-10"
                  data-testid="input-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  data-testid="button-toggle-password"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {password.length > 0 && (
                <div className="grid grid-cols-2 gap-1 pt-1">
                  <PasswordRequirement met={reqs.minLength} label="8+ characters" />
                  <PasswordRequirement met={reqs.hasUpperCase} label="Uppercase letter" />
                  <PasswordRequirement met={reqs.hasLowerCase} label="Lowercase letter" />
                  <PasswordRequirement met={reqs.hasNumber} label="Number" />
                  <PasswordRequirement met={reqs.hasSpecialChar} label="Special character" />
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-sm text-muted-foreground">
                Confirm Password
              </Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="••••••••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={isLoading}
                  className={`h-12 bg-muted/50 pr-10 ${
                    confirmPassword.length > 0 && !doPasswordsMatch
                      ? "border-destructive focus-visible:ring-destructive"
                      : ""
                  }`}
                  data-testid="input-confirm-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  data-testid="button-toggle-confirm-password"
                  tabIndex={-1}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {confirmPassword.length > 0 && !doPasswordsMatch && (
                <p className="text-xs text-destructive">Passwords don&apos;t match</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full h-12 text-base bg-foreground text-background hover:bg-foreground/90"
              disabled={isLoading || !isPasswordValid || !doPasswordsMatch || !fullName.trim()}
              data-testid="button-signup"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Creating account...
                </>
              ) : (
                "Create Account"
              )}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link
                href={planLoginPath(selectedPlan, selectedAnnual)}
                className="font-medium text-foreground hover:underline"
                data-testid="link-login"
              >
                Sign in
              </Link>
            </p>
          </form>
        </div>
      </div>

      {/* Right Side — Gradient Panel */}
      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-primary/20 via-purple-500/20 to-blue-500/20 items-center justify-center p-8">
        <div className="relative w-full h-full max-w-2xl max-h-[800px] rounded-3xl overflow-hidden shadow-2xl">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-400 via-purple-500 to-indigo-600 opacity-90" />
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage:
                "url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxkZWZzPjxwYXR0ZXJuIGlkPSJhIiB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiPjxwYXRoIGQ9Ik0wIDQwTDQwIDAgSDBaTTQwIDQwTDAgMEw0MCA0MFoiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIwLjUiIG9wYWNpdHk9IjAuMSIgZmlsbD0ibm9uZSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNhKSIvPjwvc3ZnPg==')",
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center p-12">
            <div className="text-center space-y-6 text-white">
              <h2 className="text-4xl font-bold leading-tight">
                Marketing starts with your customers
              </h2>
              <p className="text-lg opacity-90">
                Help people understand your business before they call, book or buy.
              </p>
              <div className="pt-6 space-y-4">
                <div className="flex items-center gap-4 bg-white/10 backdrop-blur-sm rounded-lg p-4 text-left">
                  <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                    <MapPin className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Write for the people you serve</h3>
                    <p className="text-sm opacity-80">Start with your real services, audience and service area</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 bg-white/10 backdrop-blur-sm rounded-lg p-4 text-left">
                  <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                    <Brain className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Make your expertise easier to see</h3>
                    <p className="text-sm opacity-80">Turn common customer questions into useful content drafts</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 bg-white/10 backdrop-blur-sm rounded-lg p-4 text-left">
                  <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                    <Zap className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Stay in control of the final word</h3>
                    <p className="text-sm opacity-80">Review facts and claims before using your content</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
