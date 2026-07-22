"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "GLOBAL_ERROR",
        message: error.message || "Global layout crash",
        stack: error.stack,
        url: typeof window !== "undefined" ? window.location.href : "",
        digest: error.digest,
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#fafafa" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
          <div style={{ textAlign: "center", maxWidth: "400px" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "1.5rem" }}>
              <div style={{ background: "#fef2f2", borderRadius: "9999px", padding: "1rem" }}>
                <AlertTriangle style={{ width: "2.5rem", height: "2.5rem", color: "#dc2626" }} />
              </div>
            </div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: "700", marginBottom: "0.5rem" }}>
              Critical error
            </h1>
            <p style={{ color: "#6b7280", marginBottom: "2rem", fontSize: "0.875rem" }}>
              The application encountered a critical error. Please refresh.
            </p>
            <button
              onClick={reset}
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.5rem",
                padding: "0.5rem 1rem", borderRadius: "0.375rem",
                border: "1px solid #e5e7eb", background: "white",
                cursor: "pointer", fontSize: "0.875rem", fontWeight: "500"
              }}
            >
              <RefreshCw style={{ width: "1rem", height: "1rem" }} />
              Reload app
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
