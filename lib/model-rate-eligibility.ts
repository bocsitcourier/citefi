import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { getTxDb } from "./db";
import { runWithSystemContext } from "./tenant-context";
import { providerRates, providerRateVersions } from "@/shared/schema";
import { modelProvider, type LockedModelRate, type ModelTier } from "./model-policy";

/**
 * Read authoritative, effective locked rates. Never use estimated telemetry
 * prices as permission to change a customer's provider cost.
 */
export async function readModelPromotionRates(
  tier: ModelTier, modelIds: string[],
): Promise<Record<string, LockedModelRate>> {
  const ids = [...new Set(modelIds)];
  if (!ids.length) return {};
  const units = tier === "geminiImage" ? ["images", "tokens"]
    : tier === "veoVideo" ? ["seconds"] : tier === "tts" ? ["characters"] : ["tokens"];
  const now = new Date();
  return runWithSystemContext("read-only model promotion locked pricing", async () => {
    const rows = await getTxDb().select({
      model: providerRates.model, unitType: providerRates.unitType,
      input: providerRates.inputMicrousdPerMillion,
      output: providerRates.outputMicrousdPerMillion, unit: providerRates.microusdPerUnit,
      version: providerRateVersions.version, lockedAt: providerRateVersions.lockedAt,
    }).from(providerRates).innerJoin(providerRateVersions, eq(providerRates.rateVersionId, providerRateVersions.id))
      .where(and(
        eq(providerRates.provider, modelProvider(tier)), inArray(providerRates.model, ids),
        inArray(providerRates.unitType, units),
        lte(providerRates.effectiveFrom, now), lte(providerRateVersions.effectiveFrom, now),
        sql`(${providerRates.effectiveTo} IS NULL OR ${providerRates.effectiveTo} > ${now})`,
        sql`(${providerRateVersions.effectiveTo} IS NULL OR ${providerRateVersions.effectiveTo} > ${now})`,
      )).orderBy(desc(providerRates.effectiveFrom), desc(providerRates.id));
    const grouped = new Map<string, Map<string, typeof rows[number]>>();
    for (const row of rows) {
      const group = grouped.get(row.model) ?? new Map();
      if (!group.has(row.unitType)) group.set(row.unitType, row);
      grouped.set(row.model, group);
    }
    const result: Record<string, LockedModelRate> = {};
    for (const [id, group] of grouped) {
      if (units.some(unit => !group.has(unit))) continue;
      const rates = units.map(unit => group.get(unit)!);
      if (rates.some(rate => !rate.lockedAt || !rate.version ||
        ((rate.unitType === "tokens" || rate.unitType === "images") &&
          (rate.input == null || rate.output == null)) ||
        (!["tokens", "images"].includes(rate.unitType) && rate.unit == null))) continue;
      result[id] = {
        // Sum dimensions for image + text token categories, conservatively.
        input: rates.reduce((total, row) => total + (row.input ?? 0), 0),
        output: rates.reduce((total, row) => total + (row.output ?? 0), 0),
        unit: rates.reduce((total, row) => total + (row.unit ?? 0), 0),
        version: rates.map(row => row.version).join("+"),
        dimensions: Object.fromEntries(rates.map(row => [row.unitType, {
          input: row.input ?? 0, output: row.output ?? 0, unit: row.unit ?? 0,
        }])),
      };
    }
    return result;
  });
}
