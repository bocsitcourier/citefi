"use client";

/**
 * useEntitlements — server-driven quota state for Generate buttons.
 *
 * The rule: clients render state; the server owns policy. Every Generate
 * button derives enabled/disabled-with-reason/upgrade-CTA from this hook.
 * No client ever hardcodes quota numbers.
 *
 * Refetch after each generation (call invalidateEntitlements) and on window
 * focus, so two tabs stay roughly in sync. The structured 429 from enqueue
 * is the authoritative fallback when entitlements are stale.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface ContentEntitlement {
  remaining: number;
  cap: number;
  inFlight: number;
  concurrencyCap: number;
  resetsAt: string;
}

export interface Entitlements {
  video: ContentEntitlement;
  article: ContentEntitlement;
  platform: {
    status: "ok" | "video_paused" | "generation_paused";
    message?: string;
  };
}

async function fetchEntitlements(): Promise<Entitlements> {
  const token = typeof window !== "undefined" ? sessionStorage.getItem("token") : null;
  const res = await fetch("/api/me/entitlements", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Entitlements fetch failed: ${res.status}`);
  return res.json();
}

export function useEntitlements() {
  const query = useQuery<Entitlements>({
    queryKey: ["entitlements"],
    queryFn: fetchEntitlements,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const queryClient = useQueryClient();
  const invalidateEntitlements = () =>
    queryClient.invalidateQueries({ queryKey: ["entitlements"] });

  return { ...query, invalidateEntitlements };
}

/**
 * Derive the video Generate button state from entitlements.
 * Returns { disabled, reason } — reason is user-facing copy.
 */
export function videoButtonState(e: Entitlements | undefined): {
  disabled: boolean;
  reason?: string;
} {
  if (!e) return { disabled: false }; // entitlements unavailable — let the 429 catch it
  if (e.platform.status !== "ok") {
    return {
      disabled: true,
      reason:
        e.platform.message ??
        "Video generation is briefly paused — your queued videos will resume automatically.",
    };
  }
  if (e.video.inFlight >= e.video.concurrencyCap) {
    return {
      disabled: true,
      reason: `You have ${e.video.inFlight} video${e.video.inFlight === 1 ? "" : "s"} generating — wait for ${e.video.inFlight === 1 ? "it" : "one"} to finish.`,
    };
  }
  if (e.video.remaining <= 0) {
    const resetsIn = formatResetsIn(e.video.resetsAt);
    return {
      disabled: true,
      reason: `Daily video limit reached (${e.video.cap}/${e.video.cap}) — resets in ${resetsIn}.`,
    };
  }
  return { disabled: false };
}

function formatResetsIn(resetsAt: string): string {
  const ms = new Date(resetsAt).getTime() - Date.now();
  if (ms <= 0) return "a moment";
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.round((ms % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
