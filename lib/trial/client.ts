"use client";
import type { TrialInput, TrialView } from "./contracts";
import { csrfFetch } from "@/lib/queryClient";

async function trialRequest(path: string, body?: unknown): Promise<TrialView> {
  const token = typeof window !== "undefined" ? sessionStorage.getItem("citefi-trial-dev") : null;
  const response = await csrfFetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json", "X-Trial-Request": "1",
      ...(token ? { "X-Trial-Token": token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Your article could not be loaded.");
  if (data.developmentToken) sessionStorage.setItem("citefi-trial-dev", data.developmentToken);
  return data;
}
export function getTrial(): Promise<TrialView> { return trialRequest("/api/trial"); }
export function startTrial(): Promise<TrialView> { return trialRequest("/api/trial/session", {}); }
export function generateTrial(input: TrialInput): Promise<TrialView> { return trialRequest("/api/trial/generate", input); }
export function claimTrial(): Promise<TrialView> { return trialRequest("/api/trial/claim", {}); }
export async function exportTrial(): Promise<{ title: string; text: string }> {
  const token = sessionStorage.getItem("citefi-trial-dev");
  const response = await csrfFetch("/api/trial/export", {
    method: "POST", credentials: "include",
    headers: { "X-Trial-Request": "1", ...(token ? { "X-Trial-Token": token } : {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "A paid subscription is required to export.");
  return data;
}
