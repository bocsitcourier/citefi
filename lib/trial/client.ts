"use client";
import type { TrialInput, TrialView } from "./contracts";
import { csrfFetch } from "@/lib/queryClient";

async function trialRequest(path: string, body?: unknown): Promise<TrialView> {
  let token: string | null = null;
  try { if (typeof window !== "undefined") token = sessionStorage.getItem("citefi-trial-dev"); } catch {}
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), path === "/api/trial/generate" ? 65_000 : 15_000);
  try {
    const response = await csrfFetch(path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "include",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json", "X-Trial-Request": "1",
        ...(token ? { "X-Trial-Token": token } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }).catch(() => {
      throw new Error("We couldn’t connect to the article service. Check your internet connection and check article status before trying again.");
    });
    let data;
    try { data = await response.json(); }
    catch { throw new Error("The article service returned an unreadable response. Check status before trying to generate again."); }
    if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "Your article could not be loaded.");
    if (!data || !["empty", "created", "generating", "ready", "uncertain"].includes(data.status) ||
        !["preview", "watermarked", "paid"].includes(data.access)) {
      throw new Error("The article service returned an invalid status. Check article status before submitting again.");
    }
    try { if (data.developmentToken) sessionStorage.setItem("citefi-trial-dev", data.developmentToken); } catch {}
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(path === "/api/trial/generate"
      ? "The connection timed out; completion is unconfirmed. Check article status before submitting again. We will not automatically generate another article."
      : "The connection timed out while checking your article session. Check article status to reconnect.");
    throw error;
  } finally { clearTimeout(timeout); }
}
export function getTrial(): Promise<TrialView> { return trialRequest("/api/trial"); }
export function startTrial(): Promise<TrialView> { return trialRequest("/api/trial/session", {}); }
export async function prepareTrialForGeneration(): Promise<TrialView> {
  await startTrial();
  // Confirm that the browser can present the capability before submitting work.
  // A 200 from session creation alone does not mean the cookie was accepted.
  const view = await getTrial();
  if (view.status === "empty") {
    throw new Error("This browser couldn’t keep your private article session. Allow cookies for this site, or open the article page in its own tab, then try again. No article was requested.");
  }
  return view;
}
export function generateTrial(input: TrialInput): Promise<TrialView> { return trialRequest("/api/trial/generate", input); }
export function claimTrial(): Promise<TrialView> { return trialRequest("/api/trial/claim", {}); }
export async function exportTrial(): Promise<{ title: string; text: string }> {
  let token: string | null = null;
  try { token = sessionStorage.getItem("citefi-trial-dev"); } catch {}
  const response = await csrfFetch("/api/trial/export", {
    method: "POST", credentials: "include",
    headers: { "X-Trial-Request": "1", ...(token ? { "X-Trial-Token": token } : {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "A paid subscription is required to export.");
  return data;
}
