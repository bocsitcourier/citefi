import type { TelemetrySeverity } from "./core";

export type IncidentChange = "duplicate" | "new" | "updated" | "escalated" | "regressed";
const SEVERITY_RANK: Record<TelemetrySeverity, number> = { warning: 1, error: 2, critical: 3 };

export function classifyIncidentChange(
  inserted: boolean,
  previousSeverity: TelemetrySeverity | undefined,
  nextSeverity: TelemetrySeverity,
): IncidentChange {
  if (!inserted) return "duplicate";
  if (!previousSeverity) return "new";
  return SEVERITY_RANK[nextSeverity] > SEVERITY_RANK[previousSeverity] ? "escalated" : "updated";
}

export function shouldNotifyAdmin(change: IncidentChange, severity: TelemetrySeverity): boolean {
  return severity === "critical" && (change === "new" || change === "escalated" || change === "regressed");
}