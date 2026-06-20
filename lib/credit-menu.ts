/**
 * Credit Menu — single source of truth for all billable operations.
 *
 * Costs are fixed and published to clients. DB overrides are loaded at runtime
 * by getCreditCost(); this file is the compile-time fallback default.
 *
 * CANONICAL OPERATION NAMES — do not rename without updating all generators.
 */

export const CREDIT_MENU = {
  /** Full 4-stage article pipeline (per article) */
  article: 10,
  /** Deep research report */
  deep_research: 5,
  /** Social post batch — all platforms in one run */
  social_batch: 4,
  /** Single social post */
  social_single: 1,
  /** Podcast script + audio */
  podcast: 8,
  /** 60-second AI video */
  video: 15,
  /** Content audit */
  content_audit: 2,
  /** Section regenerate (hero image, single section rewrite) */
  section_regenerate: 1,
  /** Internal link pass */
  internal_link: 2,
} as const;

export type OperationType = keyof typeof CREDIT_MENU;

/**
 * Canonical cost for an operation — multiply by quantity for multi-unit ops.
 * Returns null if the operation type is not found (treat as free / not metered).
 */
export function getCreditCost(operationType: string): number | null {
  const cost = CREDIT_MENU[operationType as OperationType];
  return cost !== undefined ? cost : null;
}

/** Validate that a string is a known metered operation. */
export function isMeteredOperation(op: string): op is OperationType {
  return op in CREDIT_MENU;
}
