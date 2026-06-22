"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Shield } from "lucide-react";

export default function Verify2FAPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
      <Verify2FAContent />
    </Suspense>
  );
}

function Verify2FAContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const userIdParam = searchParams.get("userId");
  const method = searchParams.get("method");
  const { verify2FA } = useAuth();
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!userIdParam || !method) {
      router.push("/login");
    }
  }, [userIdParam, method, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!userIdParam || !method) {
      toast({
        variant: "destructive",
        title: "Invalid session",
        description: "Please log in again.",
      });
      router.push("/login");
      return;
    }

    setIsLoading(true);

    try {
      await verify2FA(code, Number(userIdParam), method);
      toast({
        title: "Verification successful!",
        description: "You have been securely authenticated.",
      });
      router.push("/home");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Verification failed",
        description: error.message || "Invalid verification code. Please try again.",
      });
      setCode("");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background to-muted">
      <Card className="w-full max-w-md" data-testid="card-verify-2fa">
        <CardHeader className="space-y-1">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-primary/10 rounded-full">
              <Shield className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold text-center">Two-Factor Authentication</CardTitle>
          <CardDescription className="text-center">
            Enter the verification code from your authenticator app or email
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">Verification Code</Label>
              <Input
                id="code"
                type="text"
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                maxLength={6}
                className="text-center text-2xl tracking-widest font-mono"
                disabled={isLoading}
                autoFocus
                data-testid="input-2fa-code"
              />
              <p className="text-xs text-muted-foreground text-center">
                Enter the 6-digit code
              </p>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col space-y-4">
            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || code.length !== 6}
              data-testid="button-verify"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                "Verify"
              )}
            </Button>
            <div className="text-sm text-center text-muted-foreground">
              <button
                type="button"
                onClick={() => router.push("/login")}
                className="text-primary hover:underline font-medium"
                data-testid="link-back-to-login"
              >
                Back to login
              </button>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
