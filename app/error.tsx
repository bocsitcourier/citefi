"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    fetch("/api/client-errors", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "ROUTE_ERROR",
        message: error.message || "Unknown route error",
        stack: error.stack,
        url: typeof window !== "undefined" ? window.location.href : "",
        digest: error.digest,
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center max-w-md mx-auto px-6">
        <div className="flex justify-center mb-6">
          <div className="rounded-full bg-destructive/10 p-4">
            <AlertTriangle className="h-10 w-10 text-destructive" />
          </div>
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-2">Something went wrong</h1>
        <p className="text-muted-foreground mb-2 text-sm">
          {error.message || "An unexpected error occurred on this page."}
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground/60 mb-6 font-mono">
            Error ID: {error.digest}
          </p>
        )}
        <div className="flex gap-3 justify-center">
          <Button variant="outline" onClick={reset}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Try again
          </Button>
          <Button asChild>
            <Link href="/home">
              <Home className="h-4 w-4 mr-2" />
              Go home
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
