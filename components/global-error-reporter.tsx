"use client";

import { useEffect } from "react";

const DEDUP_WINDOW_MS = 5_000;
const recentMessages = new Set<string>();

function reportError(payload: {
  type: string;
  message: string;
  stack?: string;
  url?: string;
}) {
  const key = `${payload.type}:${payload.message}`;
  if (recentMessages.has(key)) return;
  recentMessages.add(key);
  setTimeout(() => recentMessages.delete(key), DEDUP_WINDOW_MS);

  fetch("/api/client-errors", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      url: payload.url ?? window.location.href,
    }),
    keepalive: true,
  }).catch(() => {});
}

export function GlobalErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (!event.error && !event.message) return;
      reportError({
        type: "UNCAUGHT_ERROR",
        message: event.message || String(event.error),
        stack: event.error?.stack,
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
          ? reason
          : JSON.stringify(reason) ?? "Unhandled promise rejection";

      reportError({
        type: "UNHANDLED_REJECTION",
        message,
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
