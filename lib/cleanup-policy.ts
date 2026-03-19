import { db } from "./db";
import { cleanupConfig } from "@/shared/schema";

// ============================================================================
// CLEANUP TYPES & DEFAULTS
// ============================================================================

export type CleanupType = "media" | "logs" | "orphans" | "sessions";

// Immutable retention defaults (in days)
export const CLEANUP_DEFAULTS: Readonly<Record<CleanupType, number>> = {
  media: 30,    // Soft-deleted media
  logs: 90,     // Activity logs
  sessions: 7,  // Inactive sessions
  orphans: 3,   // Orphaned assets
} as const;

// Retention bounds
export const MIN_RETENTION_DAYS = 7;
export const MAX_RETENTION_DAYS = 365;

// ============================================================================
// CLEANUP POLICY INTERFACE
// ============================================================================

export interface RetentionPolicy {
  retentionDays: number;
  source: "default" | "global" | "team" | "override";
}

export interface CleanupConfig {
  global: Partial<Record<CleanupType, number>>;
  teams?: Record<string, Partial<Record<CleanupType, number>>>;
}

// Config cache (reset per run)
let configCache: CleanupConfig | null = null;

// ============================================================================
// POLICY RESOLUTION
// ============================================================================

/**
 * Get effective retention policy for a cleanup job.
 * Priority: job override > team config > global config > defaults
 */
export async function getEffectiveRetention(
  teamId?: number,
  jobType?: CleanupType,
  overrideDays?: number
): Promise<RetentionPolicy> {
  // 1. Job override (highest priority)
  if (overrideDays !== undefined) {
    if (!validateRetention(overrideDays)) {
      throw new Error(`Invalid retention override: ${overrideDays} days (must be ${MIN_RETENTION_DAYS}-${MAX_RETENTION_DAYS})`);
    }
    return { retentionDays: overrideDays, source: "override" };
  }

  // Load config from database (with caching)
  const config = await loadCleanupConfig();

  // 2. Team-specific config
  if (teamId && jobType && config.teams?.[teamId]?.[jobType]) {
    return {
      retentionDays: config.teams[teamId][jobType]!,
      source: "team",
    };
  }

  // 3. Global config
  if (jobType && config.global[jobType]) {
    return {
      retentionDays: config.global[jobType]!,
      source: "global",
    };
  }

  // 4. Defaults (lowest priority)
  return {
    retentionDays: jobType ? CLEANUP_DEFAULTS[jobType] : 30,
    source: "default",
  };
}

/**
 * Validate retention days within bounds
 */
export function validateRetention(days: number): boolean {
  return Number.isInteger(days) && days >= MIN_RETENTION_DAYS && days <= MAX_RETENTION_DAYS;
}

/**
 * Get all default retention policies
 */
export function getDefaults(): typeof CLEANUP_DEFAULTS {
  return CLEANUP_DEFAULTS;
}

// ============================================================================
// CONFIG LOADING
// ============================================================================

/**
 * Load cleanup config from database with caching
 */
async function loadCleanupConfig(): Promise<CleanupConfig> {
  if (configCache) {
    return configCache;
  }

  try {
    const configs = await db.select().from(cleanupConfig);

    const result: CleanupConfig = {
      global: {},
      teams: {},
    };

    for (const config of configs) {
      const value = config.settingValue as any;

      // Validate JSON structure
      if (typeof value !== "object" || value === null) {
        console.warn(`Invalid cleanup config for key ${config.settingKey}, skipping`);
        continue;
      }

      // Global retention policies
      if (config.settingKey === "global_retention") {
        result.global = validateAndExtractRetention(value);
      }

      // Team-specific retention policies
      if (config.settingKey.startsWith("team_retention_")) {
        const teamId = config.settingKey.replace("team_retention_", "");
        if (!result.teams) result.teams = {};
        result.teams[teamId] = validateAndExtractRetention(value);
      }
    }

    configCache = result;
    return result;
  } catch (error) {
    console.error("Failed to load cleanup config, using defaults:", error);
    return { global: {} };
  }
}

/**
 * Validate and extract retention values from config JSON
 */
function validateAndExtractRetention(obj: any): Partial<Record<CleanupType, number>> {
  const result: Partial<Record<CleanupType, number>> = {};
  const validTypes: CleanupType[] = ["media", "logs", "orphans", "sessions"];

  for (const type of validTypes) {
    if (typeof obj[type] === "number" && validateRetention(obj[type])) {
      result[type] = obj[type];
    }
  }

  return result;
}

/**
 * Clear config cache (call after updating cleanup_config table)
 */
export function clearConfigCache() {
  configCache = null;
}
