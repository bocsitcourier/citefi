/**
 * Credit Menu — single source of truth for all billable operations.
 *
 * Static defaults are defined in CREDIT_MENU. At runtime, admins can override
 * any cost via the credit_menu_overrides table — per-team or globally (teamId=NULL).
 * Team-specific overrides take precedence over global ones.
 *
 * CANONICAL OPERATION NAMES — do not rename without updating all generators.
 */

import { CREDIT_MENU, getCreditCost, type OperationType } from "./credit-menu-defaults";
export { CREDIT_MENU, getCreditCost, type OperationType } from "./credit-menu-defaults";

/**
 * Async DB-backed lookup — checks credit_menu_overrides table first.
 *
 * Resolution order:
 *   1. Team-specific override (teamId match)
 *   2. Global override (teamId IS NULL)
 *   3. Static CREDIT_MENU default
 *   4. null (unknown operation — callers should reject)
 *
 * @param operationType  Canonical operation name from CREDIT_MENU.
 * @param teamId         Optional — when provided, team-specific overrides are checked first.
 */
export async function getEffectiveCreditCost(operationType: string, teamId?: number): Promise<number | null> {
  try {
    const { db } = await import("@/lib/db");
    const { creditMenuOverrides } = await import("@/shared/schema");
    const { eq, isNull, or, and } = await import("drizzle-orm");

    // Fetch both the team-specific and global overrides in one query
    const overrides = await db
      .select({ teamId: creditMenuOverrides.teamId, costOverride: creditMenuOverrides.costOverride })
      .from(creditMenuOverrides)
      .where(
        and(
          eq(creditMenuOverrides.operationType, operationType),
          teamId !== undefined
            ? or(eq(creditMenuOverrides.teamId, teamId), isNull(creditMenuOverrides.teamId))
            : isNull(creditMenuOverrides.teamId)
        )
      )
      .limit(10);

    if (overrides.length > 0) {
      // Team-specific override takes precedence
      const teamSpecific = teamId !== undefined
        ? overrides.find(r => r.teamId === teamId)
        : undefined;
      const globalOverride = overrides.find(r => r.teamId === null);
      const match = teamSpecific ?? globalOverride;
      if (match) return match.costOverride;
    }
  } catch (err) {
    // DB lookup failure — fall back to static menu silently
    console.warn(`[credit-menu] DB override lookup failed for "${operationType}", using static default:`, err);
  }

  return getCreditCost(operationType);
}

/** Validate that a string is a known metered operation. */
export function isMeteredOperation(op: string): op is OperationType {
  return op in CREDIT_MENU;
}
