import { db } from "./db";
import { eq, and, gte, lte, sql, desc, inArray, isNull, or } from "drizzle-orm";
import {
  facts,
  factVersions,
  Fact,
  InsertFact,
  FactVersion,
  InsertFactVersion,
  FactSourceType,
  FactStatus,
} from "../shared/schema";

export interface FactPack {
  facts: Fact[];
  totalCount: number;
  confidenceRange: { min: number; max: number };
  categories: string[];
  entityTypes: string[];
}

export interface FactQuery {
  teamId: number;
  entityType?: string;
  entityName?: string;
  category?: string;
  tags?: string[];
  minConfidence?: number;
  includeExpired?: boolean;
  limit?: number;
}

export interface FactCreateInput {
  teamId: number;
  factText: string;
  entityType?: string;
  entityName?: string;
  sourceType: string;
  sourceUrl?: string | null;
  sourceExcerpt?: string;
  verifiedBy: string;
  verifierId?: number;
  confidence?: number;
  expiresAt?: Date;
  tags?: string[];
  category?: string;
}

export interface FactUpdateInput {
  factText?: string;
  sourceUrl?: string | null;
  sourceExcerpt?: string;
  confidence?: number;
  expiresAt?: Date | null;
  status?: string;
  tags?: string[];
  category?: string;
  changedBy?: number;
  changeReason?: string;
}

class FactStoreService {
  async createFact(input: FactCreateInput): Promise<Fact> {
    const [factRow] = await db.insert(facts).values({
      teamId: input.teamId,
      factText: input.factText,
      entityType: input.entityType,
      entityName: input.entityName,
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl,
      sourceExcerpt: input.sourceExcerpt,
      verifiedBy: input.verifiedBy,
      verifierId: input.verifierId,
      confidence: input.confidence ?? 80,
      expiresAt: input.expiresAt,
      status: FactStatus.ACTIVE,
      tags: input.tags,
      category: input.category,
    }).returning();
    const fact = factRow!;

    console.log(`[FactStore] Created fact ${fact.id} (v1): "${fact.factText.substring(0, 50)}..."`);
    return fact;
  }

  async updateFact(factId: number, teamId: number, updates: FactUpdateInput): Promise<Fact | null> {
    const existingFact = await this.getFactById(factId, teamId);
    if (!existingFact) {
      console.warn(`[FactStore] Fact ${factId} not found for team ${teamId}`);
      return null;
    }

    const newVersion = existingFact.version + 1;

    await db.insert(factVersions).values({
      factId: factId,
      version: existingFact.version,
      factText: existingFact.factText,
      sourceType: existingFact.sourceType,
      sourceUrl: existingFact.sourceUrl,
      confidence: existingFact.confidence,
      changedBy: updates.changedBy,
      changeReason: updates.changeReason || `Superseded by version ${newVersion}`,
    });

    const updateData: Record<string, any> = {
      version: newVersion,
      updatedAt: new Date(),
    };

    if (updates.factText !== undefined) updateData.factText = updates.factText;
    if (updates.sourceUrl !== undefined) updateData.sourceUrl = updates.sourceUrl;
    if (updates.sourceExcerpt !== undefined) updateData.sourceExcerpt = updates.sourceExcerpt;
    if (updates.confidence !== undefined) updateData.confidence = updates.confidence;
    if (updates.expiresAt !== undefined) updateData.expiresAt = updates.expiresAt;
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.tags !== undefined) updateData.tags = updates.tags;
    if (updates.category !== undefined) updateData.category = updates.category;

    const [updatedFact] = await db.update(facts)
      .set(updateData)
      .where(and(eq(facts.id, factId), eq(facts.teamId, teamId)))
      .returning();

    console.log(`[FactStore] Updated fact ${factId} to version ${newVersion}`);
    return updatedFact ?? null;
  }

  async getFactById(factId: number, teamId: number): Promise<Fact | null> {
    const [fact] = await db.select()
      .from(facts)
      .where(and(eq(facts.id, factId), eq(facts.teamId, teamId)));
    return fact || null;
  }

  async getFactsByIds(factIds: number[], teamId: number): Promise<Fact[]> {
    if (factIds.length === 0) return [];
    return db.select()
      .from(facts)
      .where(and(
        inArray(facts.id, factIds),
        eq(facts.teamId, teamId),
        eq(facts.status, FactStatus.ACTIVE)
      ));
  }

  async queryFacts(query: FactQuery): Promise<FactPack> {
    const conditions = [eq(facts.teamId, query.teamId)];

    if (!query.includeExpired) {
      conditions.push(eq(facts.status, FactStatus.ACTIVE));
      conditions.push(or(
        isNull(facts.expiresAt),
        gte(facts.expiresAt, new Date())
      )!);
    }

    if (query.entityType) {
      conditions.push(eq(facts.entityType, query.entityType));
    }

    if (query.entityName) {
      conditions.push(eq(facts.entityName, query.entityName));
    }

    if (query.category) {
      conditions.push(eq(facts.category, query.category));
    }

    if (query.minConfidence !== undefined) {
      conditions.push(gte(facts.confidence, query.minConfidence));
    }

    const results = await db.select()
      .from(facts)
      .where(and(...conditions))
      .orderBy(desc(facts.confidence))
      .limit(query.limit ?? 100);

    const categories = [...new Set(results.map(f => f.category).filter(Boolean) as string[])];
    const entityTypes = [...new Set(results.map(f => f.entityType).filter(Boolean) as string[])];
    const confidences = results.map(f => f.confidence);

    return {
      facts: results,
      totalCount: results.length,
      confidenceRange: {
        min: confidences.length > 0 ? Math.min(...confidences) : 0,
        max: confidences.length > 0 ? Math.max(...confidences) : 0,
      },
      categories,
      entityTypes,
    };
  }

  async getFactPack(teamId: number, options?: {
    entityTypes?: string[];
    categories?: string[];
    minConfidence?: number;
    limit?: number;
  }): Promise<FactPack> {
    const conditions = [
      eq(facts.teamId, teamId),
      eq(facts.status, FactStatus.ACTIVE),
    ];

    conditions.push(or(
      isNull(facts.expiresAt),
      gte(facts.expiresAt, new Date())
    )!);

    if (options?.minConfidence !== undefined) {
      conditions.push(gte(facts.confidence, options.minConfidence));
    }

    if (options?.entityTypes && options.entityTypes.length > 0) {
      conditions.push(inArray(facts.entityType, options.entityTypes));
    }

    if (options?.categories && options.categories.length > 0) {
      conditions.push(inArray(facts.category, options.categories));
    }

    const results = await db.select()
      .from(facts)
      .where(and(...conditions))
      .orderBy(desc(facts.confidence))
      .limit(options?.limit ?? 100);

    const categories = [...new Set(results.map(f => f.category).filter(Boolean) as string[])];
    const entityTypes = [...new Set(results.map(f => f.entityType).filter(Boolean) as string[])];
    const confidences = results.map(f => f.confidence);

    return {
      facts: results,
      totalCount: results.length,
      confidenceRange: {
        min: confidences.length > 0 ? Math.min(...confidences) : 0,
        max: confidences.length > 0 ? Math.max(...confidences) : 0,
      },
      categories,
      entityTypes,
    };
  }

  async revokeFact(factId: number, teamId: number, reason: string, revokedBy?: number): Promise<boolean> {
    const existingFact = await this.getFactById(factId, teamId);
    if (!existingFact) {
      console.warn(`[FactStore] Fact ${factId} not found for team ${teamId}`);
      return false;
    }

    const newVersion = existingFact.version + 1;

    await db.insert(factVersions).values({
      factId: factId,
      version: existingFact.version,
      factText: existingFact.factText,
      sourceType: existingFact.sourceType,
      sourceUrl: existingFact.sourceUrl,
      confidence: existingFact.confidence,
      changedBy: revokedBy,
      changeReason: `Active state before revocation (v${existingFact.version}) - Revoked: ${reason}`,
    });

    const result = await db.update(facts)
      .set({
        status: FactStatus.REVOKED,
        version: newVersion,
        updatedAt: new Date(),
      })
      .where(and(eq(facts.id, factId), eq(facts.teamId, teamId)));

    if (result.rowCount && result.rowCount > 0) {
      console.log(`[FactStore] Revoked fact ${factId} (version ${newVersion}): ${reason}`);
      return true;
    }
    return false;
  }

  async checkExpiredFacts(teamId?: number): Promise<number> {
    const conditions = [
      eq(facts.status, FactStatus.ACTIVE),
      lte(facts.expiresAt, new Date()),
    ];

    if (teamId) {
      conditions.push(eq(facts.teamId, teamId));
    }

    const result = await db.update(facts)
      .set({
        status: FactStatus.EXPIRED,
        updatedAt: new Date(),
      })
      .where(and(...conditions));

    const expiredCount = result.rowCount ?? 0;
    if (expiredCount > 0) {
      console.log(`[FactStore] Marked ${expiredCount} facts as expired`);
    }
    return expiredCount;
  }

  async getFactHistory(factId: number, teamId: number): Promise<FactVersion[]> {
    const fact = await this.getFactById(factId, teamId);
    if (!fact) return [];

    return db.select()
      .from(factVersions)
      .where(eq(factVersions.factId, factId))
      .orderBy(desc(factVersions.version));
  }

  async bulkCreateFacts(inputs: FactCreateInput[]): Promise<Fact[]> {
    if (inputs.length === 0) return [];

    const createdFacts: Fact[] = [];
    
    for (const input of inputs) {
      const fact = await this.createFact(input);
      createdFacts.push(fact);
    }

    console.log(`[FactStore] Bulk created ${createdFacts.length} facts`);
    return createdFacts;
  }

  formatFactsForPrompt(factPack: FactPack): string {
    if (factPack.facts.length === 0) {
      return "NO VERIFIED FACTS AVAILABLE";
    }

    const lines = [
      "=== VERIFIED FACT STORE ===",
      "IMPORTANT: You may ONLY use these verified facts. Do NOT invent new information.",
      "",
    ];

    const byCategory = factPack.facts.reduce((acc, fact) => {
      const cat = fact.category || "general";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(fact);
      return acc;
    }, {} as Record<string, Fact[]>);

    for (const [category, categoryFacts] of Object.entries(byCategory)) {
      lines.push(`[${category.toUpperCase()}]`);
      for (const fact of categoryFacts) {
        lines.push(`- [F${fact.id}] ${fact.factText} (confidence: ${fact.confidence}%)`);
      }
      lines.push("");
    }

    lines.push("=== END FACT STORE ===");
    lines.push("");
    lines.push("RULES:");
    lines.push("1. Every claim MUST reference a fact ID like [F123]");
    lines.push("2. Do NOT make claims that cannot be traced to a fact above");
    lines.push("3. If information is missing, state 'INSUFFICIENT_DATA' rather than guess");
    lines.push("4. Rephrase facts naturally but preserve accuracy");

    return lines.join("\n");
  }

  async searchFacts(options: { teamId: number; query: string; limit?: number }): Promise<Fact[]> {
    return db.select()
      .from(facts)
      .where(and(
        eq(facts.teamId, options.teamId),
        eq(facts.status, FactStatus.ACTIVE),
      ))
      .orderBy(desc(facts.confidence))
      .limit(options.limit ?? 10);
  }
}

export const factStore = new FactStoreService();
