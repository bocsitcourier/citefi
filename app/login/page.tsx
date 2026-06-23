"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Eye, EyeOff, Sparkles, Target, Share2 } from "lucide-react";
import Link from "next/link";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, user } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // If already logged in, do a full-page redirect to bust the Next.js router cache
  useEffect(() => {
    if (user) {
      const redirect = searchParams.get("redirect");
      const dest = redirect && redirect.startsWith("/") ? redirect : "/home";
      window.location.href = dest;
    }
  }, [user, searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const result = await login(email, password);

      if (result.requiresTwoFactor) {
        router.replace(
          `/verify-2fa?userId=${result.userId}&method=${result.twoFactorMethod}`
        );
      } else {
        toast({
          title: "Welcome back!",
          description: "You have successfully logged in.",
        });
        // Full-page navigation clears the Next.js router cache so the
        // middleware sees the fresh auth cookie on the very next request.
        const redirect = searchParams.get("redirect");
        const dest = redirect && redirect.startsWith("/") ? redirect : "/home";
        window.location.href = dest;
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Login failed",
        description: error.message || "Invalid email or password. Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Side - Login Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md space-y-8">
          {/* Logo */}
          <div>
            <span className="font-bold text-2xl text-foreground tracking-tight">citefi.co</span>
          </div>

          {/* Welcome Text */}
          <div className="space-y-2">
            <h1 className="text-4xl font-bold" data-testid="text-welcome">
              Welcome Back
            </h1>
            <p className="text-muted-foreground">
              Let's login to access powerful AI content generation
            </p>
          </div>

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
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
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="remember"
                  checked={rememberMe}
                  onCheckedChange={(checked) => setRememberMe(checked as boolean)}
                  data-testid="checkbox-remember-me"
                />
                <label
                  htmlFor="remember"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Remember me
                </label>
              </div>
              <Link
                href="/forgot-password"
                className="text-sm text-primary hover:underline"
                data-testid="link-forgot-password"
              >
                Forgot Password
              </Link>
            </div>

            <Button
              type="submit"
              className="w-full h-12 text-base bg-foreground text-background hover:bg-foreground/90"
              disabled={isLoading}
              data-testid="button-login"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Login"
              )}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Don't have an account?{" "}
              <Link
                href="/signup"
                className="font-medium text-foreground hover:underline"
                data-testid="link-signup"
              >
                Sign up
              </Link>
            </p>
          </form>
        </div>
      </div>

      {/* Right Side - Beautiful Background Image */}
      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-primary/20 via-purple-500/20 to-blue-500/20 items-center justify-center p-8">
        <div className="relative w-full h-full max-w-2xl max-h-[800px] rounded-3xl overflow-hidden shadow-2xl">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-400 via-purple-500 to-indigo-600 opacity-90" />
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxkZWZzPjxwYXR0ZXJuIGlkPSJhIiB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiPjxwYXRoIGQ9Ik0wIDQwTDQwIDAgSDBaTTQwIDQwTDAgMEw0MCA0MFoiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIwLjUiIG9wYWNpdHk9IjAuMSIgZmlsbD0ibm9uZSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNhKSIvPjwvc3ZnPg==')] opacity-20" />
          <div className="absolute inset-0 flex items-center justify-center p-12">
            <div className="text-center space-y-6 text-white">
              <h2 className="text-5xl font-bold leading-tight">
                Dual-AI Content Factory
              </h2>
              <p className="text-xl opacity-90">
                Generate enterprise-grade SEO content with advanced AI
              </p>
              <div className="pt-8 space-y-4">
                <div className="flex items-center gap-4 bg-white/10 backdrop-blur-sm rounded-lg p-4">
                  <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
                    <Sparkles className="w-6 h-6 text-white" />
                  </div>
                  <div className="text-left">
                    <h3 className="font-semibold">AI-Powered Generation</h3>
                    <p className="text-sm opacity-80">Create 50+ articles in minutes</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 bg-white/10 backdrop-blur-sm rounded-lg p-4">
                  <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
                    <Target className="w-6 h-6 text-white" />
                  </div>
                  <div className="text-left">
                    <h3 className="font-semibold">SEO Optimized</h3>
                    <p className="text-sm opacity-80">Full keyword research & optimization</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 bg-white/10 backdrop-blur-sm rounded-lg p-4">
                  <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
                    <Share2 className="w-6 h-6 text-white" />
                  </div>
                  <div className="text-left">
                    <h3 className="font-semibold">Social Media AI</h3>
                    <p className="text-sm opacity-80">Auto-generate posts & videos</p>
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

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
