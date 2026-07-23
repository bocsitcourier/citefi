"use client";

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  screenshotUploaded: boolean;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, screenshotUploaded: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Capture screenshot and send to backend asynchronously
    this.captureAndReport(error, info).catch(console.error);
  }

  private async captureAndReport(error: Error, info: React.ErrorInfo) {
    try {
      let screenshotBlob: Blob | null = null;

      // Attempt html2canvas screenshot before the error overlay replaces the DOM
      try {
        const html2canvas = (await import("html2canvas")).default;
        const canvas = await html2canvas(document.documentElement, {
          useCORS: true,
          allowTaint: true,
          scale: 0.5, // Reduce size for faster upload
          logging: false,
        });
        screenshotBlob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/png", 0.7)
        );
      } catch {
        // html2canvas failed — continue without screenshot
      }

      const formData = new FormData();
      formData.append("errorMessage", error.message || String(error));
      formData.append("stackTrace", `${error.stack || ""}\n\nComponent Stack:\n${info.componentStack || ""}`);
      formData.append("pageUrl", window.location.href);
      if (screenshotBlob) {
        formData.append("screenshot", screenshotBlob, "screenshot.png");
      }

      await fetch("/api/client/error-screenshot", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      this.setState({ screenshotUploaded: true });
    } catch {
      // Reporting failed — silently ignore so as not to mask the original error
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-8">
        <div className="max-w-lg w-full space-y-6 text-center">
          <div className="flex justify-center">
            <div className="p-4 rounded-full bg-destructive/10">
              <AlertTriangle className="w-12 h-12 text-destructive" />
            </div>
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold">Something went wrong</h1>
            <p className="text-muted-foreground">
              The page encountered an unexpected error. The team has been automatically notified.
            </p>
            {this.state.screenshotUploaded && (
              <p className="text-xs text-muted-foreground">
                A screenshot of this error has been captured and logged.
              </p>
            )}
          </div>

          {this.state.error && (
            <div className="bg-muted rounded-md p-4 text-left overflow-auto max-h-40">
              <p className="text-xs font-mono text-destructive break-all">
                {this.state.error.message}
              </p>
            </div>
          )}

          <div className="flex gap-3 justify-center">
            <Button
              onClick={() => window.location.reload()}
              data-testid="button-reload-page"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Reload Page
            </Button>
            <Button
              variant="outline"
              onClick={() => { window.location.href = "/home"; }}
              data-testid="button-go-home"
            >
              Go to Home
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
