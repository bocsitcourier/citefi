/** Public operation defaults only; keep database/provider imports out of this module. */
export const CREDIT_MENU = {
  article: 10,
  deep_research: 5,
  social_batch: 4,
  social_single: 1,
  podcast: 8,
  /** Menu default for the 60-second video operation, not all provider settings. */
  video: 15,
  content_audit: 2,
  section_regenerate: 1,
  internal_link: 2,
  /** Export-only, never advertising-platform spend. */
  ads_export_pack: 5,
} as const;
export type OperationType = keyof typeof CREDIT_MENU;
export function getCreditCost(operationType: string): number | null {
  const cost = CREDIT_MENU[operationType as OperationType];
  return cost !== undefined ? cost : null;
}
