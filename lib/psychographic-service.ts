import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  audiencePersonas,
  personaMessagingTemplates,
  personaBehavioralSignals,
  AudiencePersona,
} from "../shared/schema";

export interface OceanProfile {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
}

export interface MessagingStrategy {
  tone: string;
  emotionalApproach: string;
  ctaStyle: string;
  contentLength: string;
  persuasionTechniques: string[];
  avoidances: string[];
  promptModifiers: string[];
}

export interface PersonaContentGuidelines {
  personaId: number;
  personaName: string;
  ocean: OceanProfile;
  messagingStrategy: MessagingStrategy;
  systemPromptAdditions: string[];
  userPromptAdditions: string[];
}

export class PsychographicService {
  private static instance: PsychographicService;

  static getInstance(): PsychographicService {
    if (!PsychographicService.instance) {
      PsychographicService.instance = new PsychographicService();
    }
    return PsychographicService.instance;
  }

  async getPersona(teamId: number, personaId: number): Promise<AudiencePersona | null> {
    const [persona] = await db
      .select()
      .from(audiencePersonas)
      .where(
        and(
          eq(audiencePersonas.id, personaId),
          eq(audiencePersonas.teamId, teamId)
        )
      )
      .limit(1);

    return persona || null;
  }

  async getDefaultPersona(teamId: number): Promise<AudiencePersona | null> {
    const [persona] = await db
      .select()
      .from(audiencePersonas)
      .where(
        and(
          eq(audiencePersonas.teamId, teamId),
          eq(audiencePersonas.isDefault, 1),
          eq(audiencePersonas.isActive, 1)
        )
      )
      .limit(1);

    return persona || null;
  }

  async getTeamPersonas(teamId: number): Promise<AudiencePersona[]> {
    return db
      .select()
      .from(audiencePersonas)
      .where(
        and(
          eq(audiencePersonas.teamId, teamId),
          eq(audiencePersonas.isActive, 1)
        )
      )
      .orderBy(desc(audiencePersonas.isDefault), audiencePersonas.name);
  }

  deriveMessagingStrategy(persona: AudiencePersona): MessagingStrategy {
    const strategy: MessagingStrategy = {
      tone: persona.preferredTone || "professional",
      emotionalApproach: "balanced",
      ctaStyle: persona.ctaStyle || "value-first",
      contentLength: persona.preferredContentLength || "medium",
      persuasionTechniques: [],
      avoidances: [],
      promptModifiers: [],
    };

    if (persona.openness >= 70) {
      strategy.persuasionTechniques.push("novelty and innovation appeals");
      strategy.persuasionTechniques.push("creative metaphors and storytelling");
      strategy.promptModifiers.push("Use creative, imaginative language. Introduce novel perspectives.");
    } else if (persona.openness <= 30) {
      strategy.persuasionTechniques.push("proven methods and established practices");
      strategy.persuasionTechniques.push("traditional value appeals");
      strategy.promptModifiers.push("Emphasize tried-and-true approaches. Avoid overly abstract concepts.");
    }

    if (persona.conscientiousness >= 70) {
      strategy.persuasionTechniques.push("detailed specifications and data");
      strategy.persuasionTechniques.push("step-by-step processes");
      strategy.promptModifiers.push("Include specific details, numbers, and organized structure.");
      strategy.contentLength = "detailed";
    } else if (persona.conscientiousness <= 30) {
      strategy.persuasionTechniques.push("quick wins and immediate benefits");
      strategy.promptModifiers.push("Keep it concise. Focus on key takeaways.");
      strategy.contentLength = "short";
    }

    if (persona.extraversion >= 70) {
      strategy.persuasionTechniques.push("social proof and community");
      strategy.persuasionTechniques.push("energetic, action-oriented language");
      strategy.emotionalApproach = "enthusiastic";
      strategy.promptModifiers.push("Use dynamic, engaging language. Include social elements.");
    } else if (persona.extraversion <= 30) {
      strategy.persuasionTechniques.push("personal reflection and individual benefits");
      strategy.persuasionTechniques.push("thoughtful, measured messaging");
      strategy.emotionalApproach = "calm";
      strategy.promptModifiers.push("Use thoughtful, reflective language. Focus on individual benefits.");
    }

    if (persona.agreeableness >= 70) {
      strategy.persuasionTechniques.push("community benefit and harmony");
      strategy.persuasionTechniques.push("collaborative language");
      strategy.promptModifiers.push("Emphasize how this helps others. Use inclusive 'we' language.");
      strategy.avoidances.push("aggressive or confrontational language");
    } else if (persona.agreeableness <= 30) {
      strategy.persuasionTechniques.push("competitive advantage");
      strategy.persuasionTechniques.push("direct, results-focused messaging");
      strategy.promptModifiers.push("Focus on competitive edge and personal gain. Be direct.");
    }

    if (persona.neuroticism >= 70) {
      strategy.persuasionTechniques.push("security and safety assurances");
      strategy.persuasionTechniques.push("risk mitigation messaging");
      strategy.emotionalApproach = "reassuring";
      strategy.promptModifiers.push("Address concerns proactively. Emphasize safety and guarantees.");
      strategy.avoidances.push("fear-based messaging without resolution");
    } else if (persona.neuroticism <= 30) {
      strategy.persuasionTechniques.push("opportunity and growth focus");
      strategy.promptModifiers.push("Focus on opportunities. Minimal risk warnings needed.");
    }

    if (persona.riskTolerance >= 70) {
      strategy.ctaStyle = "direct";
      strategy.promptModifiers.push("Use bold CTAs. Emphasize upside potential.");
    } else if (persona.riskTolerance <= 30) {
      strategy.ctaStyle = "soft";
      strategy.promptModifiers.push("Use gentle CTAs. Emphasize safety and reversibility.");
      strategy.avoidances.push("urgency pressure tactics");
    }

    const avoidPhrases = (persona.avoidPhrases as string[]) || [];
    if (avoidPhrases.length > 0) {
      strategy.avoidances.push(...avoidPhrases);
    }

    return strategy;
  }

  // Derive moral foundation from OCEAN traits and value orientation
  deriveMoralFoundation(persona: AudiencePersona): { coreValues: string[]; decisionDriver: string; trustBuiltThrough: string } {
    const coreValues: string[] = [];
    let decisionDriver = "balanced analysis";
    let trustBuiltThrough = "consistent reliability";

    // High Conscientiousness = values order, responsibility, duty
    if (persona.conscientiousness >= 70) {
      coreValues.push("responsibility", "reliability", "hard work");
      trustBuiltThrough = "demonstrated competence and follow-through";
    } else if (persona.conscientiousness <= 30) {
      coreValues.push("flexibility", "spontaneity", "adaptability");
      trustBuiltThrough = "genuine authenticity and realness";
    }

    // High Agreeableness = values harmony, helping others, fairness
    if (persona.agreeableness >= 70) {
      coreValues.push("family", "community", "fairness");
      decisionDriver = "impact on loved ones and community";
    } else if (persona.agreeableness <= 30) {
      coreValues.push("independence", "self-reliance", "achievement");
      decisionDriver = "personal advantage and results";
    }

    // High Openness = values growth, creativity, new experiences
    if (persona.openness >= 70) {
      coreValues.push("growth", "innovation", "exploration");
    } else if (persona.openness <= 30) {
      coreValues.push("tradition", "stability", "proven methods");
    }

    // High Neuroticism = values security, protection, certainty
    if (persona.neuroticism >= 70) {
      coreValues.push("security", "protection", "peace of mind");
      decisionDriver = "fear of loss and need for safety";
    } else if (persona.neuroticism <= 30) {
      coreValues.push("opportunity", "confidence", "bold action");
    }

    // Value orientation modifiers
    switch (persona.valueOrientation) {
      case "price":
        coreValues.push("value for money", "practical savings");
        decisionDriver = "cost-benefit analysis";
        break;
      case "quality":
        coreValues.push("excellence", "durability", "craftsmanship");
        decisionDriver = "long-term quality and reliability";
        break;
      case "experience":
        coreValues.push("memorable moments", "personal growth");
        decisionDriver = "emotional fulfillment and experiences";
        break;
      case "status":
        coreValues.push("recognition", "prestige", "success");
        decisionDriver = "social perception and advancement";
        trustBuiltThrough = "association with respected brands/people";
        break;
    }

    // Ensure we have at least 3 core values
    if (coreValues.length === 0) {
      coreValues.push("balance", "practicality", "common sense");
    }

    return {
      coreValues: coreValues.slice(0, 4), // Max 4 values
      decisionDriver,
      trustBuiltThrough
    };
  }

  // Get actionable implication from trait score
  getTraitImplication(score: number, trait: string): string {
    const implications: Record<string, { high: string; low: string; mid: string }> = {
      openness: {
        high: "Use innovative framing, introduce new perspectives, embrace creativity",
        mid: "Balance familiar concepts with fresh angles",
        low: "Emphasize proven approaches, avoid abstract concepts, stick to traditional framing"
      },
      conscientiousness: {
        high: "Include specific data, step-by-step structure, detailed specifications",
        mid: "Balance detail with accessibility",
        low: "Lead with quick wins, keep it concise, focus on immediate benefits"
      },
      extraversion: {
        high: "Use energetic language, social proof, community benefits, action verbs",
        mid: "Mix social and individual benefits",
        low: "Focus on personal reflection, individual benefits, thoughtful pacing"
      },
      agreeableness: {
        high: "Emphasize helping others, use 'we' language, highlight community impact",
        mid: "Balance personal and collective benefits",
        low: "Focus on competitive advantage, direct results, personal gain"
      },
      neuroticism: {
        high: "Address concerns proactively, emphasize guarantees, build safety nets",
        mid: "Acknowledge both risks and opportunities",
        low: "Focus on opportunities, embrace bold claims, minimize hedging"
      }
    };

    const traitMap = implications[trait];
    if (!traitMap) return "Apply balanced approach";

    if (score >= 70) return traitMap.high;
    if (score <= 30) return traitMap.low;
    return traitMap.mid;
  }

  async getContentGuidelines(
    teamId: number,
    personaId?: number
  ): Promise<PersonaContentGuidelines | null> {
    let persona: AudiencePersona | null = null;

    if (personaId) {
      persona = await this.getPersona(teamId, personaId);
    }

    if (!persona) {
      persona = await this.getDefaultPersona(teamId);
    }

    if (!persona) {
      return null;
    }

    const messagingStrategy = this.deriveMessagingStrategy(persona);

    const systemPromptAdditions: string[] = [];
    const userPromptAdditions: string[] = [];

    // ============================================================================
    // WISDOM PIPELINE - Cross-reference persona data before generating content
    // ============================================================================
    
    systemPromptAdditions.push("\n\n=== WISDOM PIPELINE: PERSONA INTELLIGENCE ===");
    
    // STEP 1: IDENTITY CHECK - Who is the target?
    systemPromptAdditions.push(`\n[STEP 1: IDENTITY CHECK]`);
    systemPromptAdditions.push(`Target Persona: "${persona.name}"`);
    if (persona.description) {
      systemPromptAdditions.push(`Profile: ${persona.description}`);
    }
    const demographics = [];
    if (persona.ageRangeMin && persona.ageRangeMax) {
      demographics.push(`Age ${persona.ageRangeMin}-${persona.ageRangeMax}`);
    }
    if (persona.gender && persona.gender !== 'any') {
      demographics.push(persona.gender);
    }
    if (persona.incomeLevel) {
      demographics.push(`${persona.incomeLevel} income`);
    }
    if (demographics.length > 0) {
      systemPromptAdditions.push(`Demographics: ${demographics.join(", ")}`);
    }
    
    // STEP 2: MORAL FOUNDATION - What values drive them?
    systemPromptAdditions.push(`\n[STEP 2: MORAL FOUNDATION]`);
    const moralFoundation = this.deriveMoralFoundation(persona);
    systemPromptAdditions.push(`Core Values: ${moralFoundation.coreValues.join(", ")}`);
    systemPromptAdditions.push(`Decision Driver: ${moralFoundation.decisionDriver}`);
    systemPromptAdditions.push(`Trust Built Through: ${moralFoundation.trustBuiltThrough}`);
    
    // STEP 3: PSYCHOLOGICAL PROFILE - OCEAN Analysis
    systemPromptAdditions.push(`\n[STEP 3: PSYCHOLOGICAL PROFILE]`);
    systemPromptAdditions.push(`Openness: ${persona.openness}/100 → ${this.getTraitImplication(persona.openness, "openness")}`);
    systemPromptAdditions.push(`Conscientiousness: ${persona.conscientiousness}/100 → ${this.getTraitImplication(persona.conscientiousness, "conscientiousness")}`);
    systemPromptAdditions.push(`Extraversion: ${persona.extraversion}/100 → ${this.getTraitImplication(persona.extraversion, "extraversion")}`);
    systemPromptAdditions.push(`Agreeableness: ${persona.agreeableness}/100 → ${this.getTraitImplication(persona.agreeableness, "agreeableness")}`);
    systemPromptAdditions.push(`Neuroticism: ${persona.neuroticism}/100 → ${this.getTraitImplication(persona.neuroticism, "neuroticism")}`);
    systemPromptAdditions.push(`Risk Tolerance: ${persona.riskTolerance}/100 → ${persona.riskTolerance >= 60 ? "Embrace bold claims" : persona.riskTolerance <= 40 ? "Emphasize safety and proven results" : "Balance opportunity with security"}`);
    
    // STEP 4: PAIN POINT INJECTION - Real concerns from research
    const painPoints = (persona.painPoints as string[]) || [];
    const motivations = (persona.motivations as string[]) || [];
    const objections = (persona.objections as string[]) || [];
    const emotionalTriggers = (persona.emotionalTriggers as string[]) || [];
    
    systemPromptAdditions.push(`\n[STEP 4: PAIN POINT INJECTION]`);
    if (painPoints.length > 0) {
      systemPromptAdditions.push(`CRITICAL: This persona is actively searching for solutions to:`);
      painPoints.forEach((pain, i) => systemPromptAdditions.push(`  ${i + 1}. "${pain}"`));
      systemPromptAdditions.push(`Your content MUST acknowledge at least one of these struggles authentically.`);
    } else {
      systemPromptAdditions.push(`No specific pain points defined - use OCEAN profile to infer concerns.`);
    }
    
    // STEP 5: MOTIVATION ALIGNMENT - What drives action?
    systemPromptAdditions.push(`\n[STEP 5: MOTIVATION ALIGNMENT]`);
    if (motivations.length > 0) {
      systemPromptAdditions.push(`This persona takes action when content appeals to:`);
      motivations.forEach((motive, i) => systemPromptAdditions.push(`  ${i + 1}. "${motive}"`));
      systemPromptAdditions.push(`Frame your value proposition around these desires.`);
    } else {
      systemPromptAdditions.push(`Use value orientation: ${persona.valueOrientation || "balanced"}`);
    }
    
    // STEP 6: OBJECTION PRE-HANDLING - Address barriers before they arise
    systemPromptAdditions.push(`\n[STEP 6: OBJECTION PRE-HANDLING]`);
    if (objections.length > 0) {
      systemPromptAdditions.push(`Before your CTA, preemptively neutralize these objections:`);
      objections.forEach((obj, i) => systemPromptAdditions.push(`  ${i + 1}. "${obj}" → Address with proof, social validation, or reframing`));
    } else {
      systemPromptAdditions.push(`Decision style: ${persona.decisionStyle || "balanced"} - tailor evidence accordingly.`);
    }
    
    // STEP 7: EMOTIONAL ANCHOR - What feeling to evoke?
    systemPromptAdditions.push(`\n[STEP 7: EMOTIONAL ANCHOR]`);
    if (emotionalTriggers.length > 0) {
      systemPromptAdditions.push(`These emotional triggers activate this persona:`);
      emotionalTriggers.forEach((trigger, i) => systemPromptAdditions.push(`  ${i + 1}. "${trigger}"`));
      systemPromptAdditions.push(`Weave these emotional anchors naturally into your narrative.`);
    }
    systemPromptAdditions.push(`Target Emotional Journey: ${messagingStrategy.emotionalApproach}`);
    systemPromptAdditions.push(`Tone: ${messagingStrategy.tone}`);
    
    // STEP 8: CONTENT STRATEGY - Derived messaging approach
    systemPromptAdditions.push(`\n[STEP 8: CONTENT STRATEGY]`);
    systemPromptAdditions.push(`CTA Style: ${messagingStrategy.ctaStyle}`);
    systemPromptAdditions.push(`Content Length: ${messagingStrategy.contentLength}`);
    
    if (messagingStrategy.persuasionTechniques.length > 0) {
      systemPromptAdditions.push(`Persuasion Techniques:`);
      messagingStrategy.persuasionTechniques.forEach(tech => systemPromptAdditions.push(`  • ${tech}`));
    }
    
    if (messagingStrategy.avoidances.length > 0) {
      systemPromptAdditions.push(`AVOID (will alienate this persona):`);
      messagingStrategy.avoidances.forEach(avoid => systemPromptAdditions.push(`  ✗ ${avoid}`));
    }
    
    if (messagingStrategy.promptModifiers.length > 0) {
      systemPromptAdditions.push(`Writing Directives:`);
      messagingStrategy.promptModifiers.forEach(mod => systemPromptAdditions.push(`  → ${mod}`));
    }
    
    systemPromptAdditions.push(`\n=== END WISDOM PIPELINE ===\n`);
    
    // User prompt additions for direct instruction
    if (painPoints.length > 0) {
      userPromptAdditions.push(`\n[PERSONA PAIN POINTS - Address authentically]: ${painPoints.slice(0, 3).join("; ")}`);
    }
    if (motivations.length > 0) {
      userPromptAdditions.push(`[PERSONA MOTIVATIONS - Appeal to]: ${motivations.slice(0, 3).join("; ")}`);
    }
    if (objections.length > 0) {
      userPromptAdditions.push(`[OBJECTIONS TO NEUTRALIZE]: ${objections.slice(0, 3).join("; ")}`);
    }

    return {
      personaId: persona.id,
      personaName: persona.name,
      ocean: {
        openness: persona.openness,
        conscientiousness: persona.conscientiousness,
        extraversion: persona.extraversion,
        agreeableness: persona.agreeableness,
        neuroticism: persona.neuroticism,
      },
      messagingStrategy,
      systemPromptAdditions,
      userPromptAdditions,
    };
  }

  private getTraitLabel(value: number, trait: string): string {
    const labels: Record<string, { low: string; mid: string; high: string }> = {
      openness: { low: "traditional", mid: "balanced", high: "creative/curious" },
      conscientiousness: { low: "flexible", mid: "balanced", high: "organized/detail-oriented" },
      extraversion: { low: "introverted/reflective", mid: "balanced", high: "outgoing/energetic" },
      agreeableness: { low: "competitive", mid: "balanced", high: "cooperative/trusting" },
      neuroticism: { low: "calm/stable", mid: "balanced", high: "sensitive/anxious" },
    };

    const traitLabels = labels[trait] || { low: "low", mid: "moderate", high: "high" };
    
    if (value <= 30) return traitLabels.low;
    if (value >= 70) return traitLabels.high;
    return traitLabels.mid;
  }

  async createPersona(
    teamId: number,
    data: {
      name: string;
      description?: string;
      openness?: number;
      conscientiousness?: number;
      extraversion?: number;
      agreeableness?: number;
      neuroticism?: number;
      riskTolerance?: number;
      decisionStyle?: string;
      valueOrientation?: string;
      preferredTone?: string;
      preferredContentLength?: string;
      painPoints?: string[];
      motivations?: string[];
      objections?: string[];
      emotionalTriggers?: string[];
      isDefault?: boolean;
    }
  ): Promise<AudiencePersona> {
    if (data.isDefault) {
      await db
        .update(audiencePersonas)
        .set({ isDefault: 0 })
        .where(eq(audiencePersonas.teamId, teamId));
    }

    const [persona] = await db
      .insert(audiencePersonas)
      .values({
        teamId,
        name: data.name,
        description: data.description,
        openness: data.openness ?? 50,
        conscientiousness: data.conscientiousness ?? 50,
        extraversion: data.extraversion ?? 50,
        agreeableness: data.agreeableness ?? 50,
        neuroticism: data.neuroticism ?? 50,
        riskTolerance: data.riskTolerance ?? 50,
        decisionStyle: data.decisionStyle ?? "balanced",
        valueOrientation: data.valueOrientation ?? "balanced",
        preferredTone: data.preferredTone ?? "professional",
        preferredContentLength: data.preferredContentLength ?? "medium",
        painPoints: data.painPoints,
        motivations: data.motivations,
        objections: data.objections,
        emotionalTriggers: data.emotionalTriggers,
        isDefault: data.isDefault ? 1 : 0,
      })
      .returning();

    console.log(`✅ Created persona: ${data.name} for team ${teamId}`);
    return persona!;
  }

  async updatePersona(
    teamId: number,
    personaId: number,
    data: Partial<AudiencePersona>
  ): Promise<AudiencePersona | null> {
    if (data.isDefault === 1) {
      await db
        .update(audiencePersonas)
        .set({ isDefault: 0 })
        .where(eq(audiencePersonas.teamId, teamId));
    }

    const [updated] = await db
      .update(audiencePersonas)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(audiencePersonas.id, personaId),
          eq(audiencePersonas.teamId, teamId)
        )
      )
      .returning();

    return updated || null;
  }

  async deletePersona(teamId: number, personaId: number): Promise<boolean> {
    const result = await db
      .delete(audiencePersonas)
      .where(
        and(
          eq(audiencePersonas.id, personaId),
          eq(audiencePersonas.teamId, teamId)
        )
      )
      .returning({ id: audiencePersonas.id });

    return result.length > 0;
  }

  async recordBehavioralSignal(
    personaId: number,
    signal: {
      signalType: string;
      contentType: string;
      contentId: number;
      signalValue: number;
      signalMetadata?: Record<string, any>;
      patternsUsed?: number[];
      messagingTemplateId?: number;
    }
  ): Promise<void> {
    await db.insert(personaBehavioralSignals).values({
      personaId,
      signalType: signal.signalType,
      contentType: signal.contentType,
      contentId: signal.contentId,
      signalValue: signal.signalValue,
      signalMetadata: signal.signalMetadata,
      patternsUsedJson: signal.patternsUsed,
      messagingTemplateId: signal.messagingTemplateId,
    });
  }

  async getPresetPersonas(): Promise<Array<{
    name: string;
    description: string;
    ocean: OceanProfile;
    riskTolerance: number;
    decisionStyle: string;
    preferredTone: string;
  }>> {
    return [
      {
        name: "The Analytical Professional",
        description: "Detail-oriented decision makers who value data and proven results",
        ocean: { openness: 40, conscientiousness: 85, extraversion: 45, agreeableness: 55, neuroticism: 35 },
        riskTolerance: 30,
        decisionStyle: "analytical",
        preferredTone: "authoritative",
      },
      {
        name: "The Adventurous Explorer",
        description: "Creative individuals seeking new experiences and innovative solutions",
        ocean: { openness: 90, conscientiousness: 45, extraversion: 75, agreeableness: 60, neuroticism: 30 },
        riskTolerance: 80,
        decisionStyle: "impulsive",
        preferredTone: "casual",
      },
      {
        name: "The Cautious Planner",
        description: "Security-focused individuals who prefer proven, low-risk solutions",
        ocean: { openness: 30, conscientiousness: 80, extraversion: 35, agreeableness: 65, neuroticism: 70 },
        riskTolerance: 15,
        decisionStyle: "analytical",
        preferredTone: "professional",
      },
      {
        name: "The Social Connector",
        description: "Relationship-driven individuals who value community and shared experiences",
        ocean: { openness: 65, conscientiousness: 50, extraversion: 90, agreeableness: 85, neuroticism: 40 },
        riskTolerance: 55,
        decisionStyle: "emotional",
        preferredTone: "friendly",
      },
      {
        name: "The Competitive Achiever",
        description: "Results-driven individuals focused on gaining competitive advantage",
        ocean: { openness: 60, conscientiousness: 75, extraversion: 70, agreeableness: 25, neuroticism: 45 },
        riskTolerance: 65,
        decisionStyle: "balanced",
        preferredTone: "urgent",
      },
    ];
  }

  async initializeDefaultPersonas(teamId: number): Promise<void> {
    const existingPersonas = await this.getTeamPersonas(teamId);
    if (existingPersonas.length > 0) {
      console.log(`Team ${teamId} already has ${existingPersonas.length} personas`);
      return;
    }

    const presets = await this.getPresetPersonas();
    
    for (let i = 0; i < presets.length; i++) {
      const preset = presets[i]!;
      await this.createPersona(teamId, {
        name: preset.name,
        description: preset.description,
        openness: preset.ocean.openness,
        conscientiousness: preset.ocean.conscientiousness,
        extraversion: preset.ocean.extraversion,
        agreeableness: preset.ocean.agreeableness,
        neuroticism: preset.ocean.neuroticism,
        riskTolerance: preset.riskTolerance,
        decisionStyle: preset.decisionStyle,
        preferredTone: preset.preferredTone,
        isDefault: i === 0,
      });
    }

    console.log(`✅ Initialized ${presets.length} default personas for team ${teamId}`);
  }
}

export const psychographicService = PsychographicService.getInstance();
