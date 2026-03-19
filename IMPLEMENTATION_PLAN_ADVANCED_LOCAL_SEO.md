# Advanced Local SEO Implementation Plan
## ApexContent Engine - Transformation to E-E-A-T Powerhouse

**Created:** November 19, 2025  
**Status:** Tasks 1-2 Complete, Tasks 3-10 In Progress  
**Methodology:** Lily Ray + Mike King + Kevin Indig Composite Approach

---

## ✅ COMPLETED TASKS

### Task 1: Database Schema Extensions ✓
**Status:** Architect Approved  
**Files:** `shared/schema.ts`

**Deliverables:**
- ✅ `content_clusters` table: Tracks topic pillars with coverage metrics
- ✅ `coverage_nodes` table: Individual subtopic coverage with depth/E-E-A-T scores
- ✅ `local_authority_signals` table: Local entities with credibility tracking

**Schema Features:**
- Team isolation via `team_id` foreign keys
- Proper indexes on public_id, team_id, status
- Cascade deletes for data integrity
- Coverage tracking: `totalNodesPlanned`, `totalNodesComplete`
- Quality scores: `depthScore`, `localSignalStrength`, `eatScore` (0-100)

### Task 2: Batch SEO Cache v2.0 Upgrade ✓
**Status:** Architect Approved  
**Files:** `shared/schema.ts`, `lib/batch-seo-cache.ts`

**Deliverables:**
- ✅ Added 3 JSONB columns: `local_regulations`, `authority_entities`, `key_statistics`
- ✅ Enhanced `BatchSeoContext` interface with new types
- ✅ Fixed cache persistence (INSERT) and retrieval (SELECT) 
- ✅ Enhanced Gemini prompt to collect deep local intelligence
- ✅ Cache version upgraded: 1.0 → 2.0 with automatic invalidation

**New Data Collected:**
```typescript
locationAnalysis: {
  zipCodes: string[];           // 3-5 relevant ZIP codes
  neighborhoods: string[];      // 5-8 named districts
  population: string;           // With year (e.g., "1.5M (2023)")
  medianIncome: string;         // With year (e.g., "$75K (2023)")
}
localRegulations: LocalRegulation[];      // 3-5 regulations (licensing, zoning, etc.)
authorityEntities: LocalAuthorityEntity[]; // 5-8 entities with credibility scores
keyStatistics: Array<{                     // 3-5 statistics with sources
  claim: string;
  value: string;
  source: string;
  year: number;
}>;
```

---

## 🔄 IN-PROGRESS TASKS

### Task 3: Rewrite Stage 1 (Title Generation) 🔄
**Status:** In Progress  
**Files:** `lib/gemini.ts` (lines 214-338)  
**Function:** `generateTitlePool()`

**Current State:** 59-line prompt with location-first SEO focus

**Required Enhancements:**
1. **Answer-First Title Framing**
   - Titles should hint at direct answers (e.g., "How [TOPIC] Works in [LOCATION]: Complete Guide")
   - Question-based titles that promise immediate answers
   - Use formats: "What is...", "How to...", "Why [LOCATION] Needs..."

2. **Coverage Pillar Integration**
   - Generate titles mapped to coverage categories:
     - Types/Options, Costs/Pricing, Laws/Regulations
     - Providers/Services, Testimonials/Reviews, FAQs
     - Best Practices, Neighborhood Guides
   - Include subtopic category in output for cluster mapping

3. **E-E-A-T Signal Requirements**
   - Titles emphasizing experience: "Our 15-Year Guide to..."
   - Titles showing expertise: "Expert Analysis:", "Technical Guide:"
   - Authority-building: "Comprehensive [LOCATION] Resource"
   - Trust signals: "2025 Updated:", "Verified [LOCATION] Data"

4. **Enhanced Output Structure**
```typescript
interface TitlePoolResult {
  titles: string[];
  primaryKeywords: string[];
  contentStrategy: string;
  // NEW FIELDS:
  coverageMapping?: Array<{
    title: string;
    subtopicCategory: string; // maps to coverage_nodes.subtopicCategory
    clusterPillar: string;
    eatSignals: string[];     // E-E-A-T signals present in title
  }>;
  localIntelligence?: {
    suggestedZipCodes: string[];
    suggestedNeighborhoods: string[];
  };
}
```

**Implementation Steps:**
1. Read current prompt (lines 230-289)
2. Enhance with answer-first framing requirements
3. Add coverage pillar categorization instructions
4. Include E-E-A-T signal requirements
5. Update output schema to include `coverageMapping`
6. Test with sample batch

**Estimated Lines Changed:** ~80-100 lines (prompt expansion)

---

### Task 4: Rebuild Stage 2 (Article Drafting) 📋
**Status:** Pending  
**Files:** `lib/article-generation.ts` or similar  
**Priority:** HIGH (Core content quality)

**Required Changes:**

#### **Composite 3-Layer Prompt Architecture**

**Layer 1: Lily Ray's Answer-First Foundation**
```typescript
const answerFirstPrompt = `
1. ANSWER-FIRST PARAGRAPH (150-200 words):
   - Provide complete direct answer to: [ARTICLE TITLE QUESTION]
   - Front-load most important facts and evidence
   - Make quotable and citable by AI
   - Include target keyword 2-3 times naturally
   - Use clear, authoritative language

2. E-E-A-T SIGNALS THROUGHOUT:
   Experience: "In our [X] years working with [LOCATION] clients..."
   Expertise: Technical details, industry terminology with explanations
   Authoritativeness: Cite credible sources, statistics with sources
   Trustworthiness: Fact-check, transparency about limitations

3. LOCAL/GEO OPTIMIZATION (MANDATORY):
   - Include [CITY/ZIP/NEIGHBORHOOD] in first 3 paragraphs
   - Reference ${batchSeoCache.localRegulations} where relevant
   - Cite ${batchSeoCache.authorityEntities} for credibility
   - Use ${batchSeoCache.keyStatistics} with sources
   - Mention ${batchSeoCache.locationAnalysis.neighborhoods}
`;
```

**Layer 2: Mike King's Passage-Level Engineering**
```typescript
const passageLevelPrompt = `
PASSAGE-LEVEL OPTIMIZATION (CRITICAL):
Every paragraph MUST be:
- 3-5 sentences maximum (STRICT LIMIT)
- Self-contained (stands alone as complete answer)
- One clear idea only
- Includes context (no assumed prior reading)
- Optimized for AI extraction

PARAGRAPH FORMULA:
"[Topic/Question] is [Definition]. [Supporting detail 1]. 
[Supporting detail 2]. [Practical implication]. 
[Local context for ${geographicFocus}]."

COMPRESSION RULES:
- Remove unnecessary words
- Front-load key information
- Use active voice
- Eliminate redundancy
- Get to the point immediately
`;
```

**Layer 3: Kevin Indig's Citation Optimization**
```typescript
const citationOptimizedPrompt = `
SCHEMA-READY STRUCTURE:
1. FAQPage Schema: 8-10 natural Q&As
2. HowTo Schema: Step-by-step processes
3. Article Schema: Clear headline, author, dates
4. LocalBusiness Schema: For location-specific content

FRONT-LOAD EVIDENCE (First 2-3 paragraphs):
- Specific statistics: "${batchSeoCache.keyStatistics[0].claim}: ${value} (${source}, ${year})"
- Recent research findings (2024-2025)
- Expert quotes from ${batchSeoCache.authorityEntities}
- Local regulations: "${batchSeoCache.localRegulations[0].title}"

COMPRESS PARAGRAPHS FOR EXTRACTABILITY:
Formula: [Claim] + [Evidence] + [Implication]

Example:
"${batchSeoCache.keyStatistics[0].claim}. 
This represents [implication for ${geographicFocus}]. 
[Action recommendation for local residents/businesses]."

FRESHNESS SIGNALS:
- Include "Last Updated: November 2025"
- Reference 2024-2025 developments
- Cite recent data with years
`;
```

**Integration Strategy:**
```typescript
async function generateArticleContent(params: ArticleParams) {
  const batchCache = await getBatchSeoCache(params.batchId);
  
  const compositePrompt = `
${answerFirstPrompt}

${passageLevelPrompt}

${citationOptimizedPrompt}

CONTENT STRUCTURE:
- Introduction (Answer-first paragraph: 150-200 words)
- 6-8 H2 sections with question-based headings
- Each H2 has 2-3 H3 subsections
- Each paragraph: 3-5 sentences maximum
- Include 1 comparison table
- Include 1 step-by-step process (numbered list)
- FAQ section (8-10 questions)
- Conclusion with key takeaways

WORD COUNT: 1800-2200 words

LOCAL INTELLIGENCE TO USE:
- ZIP Codes: ${batchCache.locationAnalysis.zipCodes.join(', ')}
- Neighborhoods: ${batchCache.locationAnalysis.neighborhoods.join(', ')}
- Regulations: ${batchCache.localRegulations.map(r => r.title).join(', ')}
- Authority Entities: ${batchCache.authorityEntities.map(e => e.name).join(', ')}
- Key Statistics: ${batchCache.keyStatistics.map(s => s.claim).join('; ')}

DO NOT:
- Add hyperlinks (we'll add separately)
- Use vague claims without evidence
- Ignore local context
- Write fluff or filler
- Exceed 5 sentences per paragraph

Generate the article in HTML format.
`;

  return await callGeminiAPI(compositePrompt);
}
```

**Implementation Steps:**
1. Locate current article generation function
2. Extract prompt into modular segments
3. Integrate batch SEO cache data
4. Add validation for paragraph length (3-5 sentences)
5. Test with sample titles

**Estimated Lines Changed:** ~150-200 lines (major rewrite)

---

### Task 5: Create Stage 3 (GPT Review) Validator 📋
**Status:** Pending  
**Files:** New file or enhance existing GPT review stage  
**Priority:** HIGH (Quality assurance)

**Purpose:** 
Audit generated content for E-E-A-T compliance, local signal density, and schema readiness before finalization.

**Required Validator Functions:**

#### **1. Passage Quality Validator**
```typescript
interface PassageQualityResult {
  paragraphCount: number;
  paragraphsExceeding5Sentences: number;
  paragraphsUnder3Sentences: number;
  selfContainedScore: number; // 0-100
  issues: Array<{
    paragraphNumber: number;
    issue: "too_long" | "too_short" | "not_self_contained";
    recommendation: string;
  }>;
}

async function validatePassageQuality(htmlContent: string): Promise<PassageQualityResult> {
  // Parse HTML to extract paragraphs
  // Count sentences per paragraph
  // Check self-containment (does paragraph make sense alone?)
  // Return audit report
}
```

#### **2. E-E-A-T Alignment Auditor**
```typescript
interface EEATAuditResult {
  experienceScore: number;     // 0-100
  expertiseScore: number;       // 0-100
  authoritativenessScore: number; // 0-100
  trustworthinessScore: number; // 0-100
  overallEATScore: number;      // 0-100
  findings: {
    experienceSignals: string[];     // e.g., "Found 'our 15 years' in paragraph 2"
    expertiseSignals: string[];      // e.g., "Technical terminology explained"
    authoritySignals: string[];      // e.g., "Cited 3 credible sources"
    trustSignals: string[];          // e.g., "Included data sources with years"
  };
  gaps: string[]; // Missing E-E-A-T elements
}

async function auditEEATSignals(
  htmlContent: string,
  batchCache: BatchSeoContext
): Promise<EEATAuditResult> {
  const prompt = `
Audit this article for E-E-A-T compliance:

[ARTICLE HTML]

Available local intelligence:
- Authority Entities: ${batchCache.authorityEntities.map(e => e.name)}
- Key Statistics: ${batchCache.keyStatistics.map(s => `${s.claim} (${s.source}, ${s.year})`)}
- Local Regulations: ${batchCache.localRegulations.map(r => r.title)}

Evaluate:
1. Experience signals (personal experience, case studies)
2. Expertise signals (technical depth, terminology)
3. Authoritativeness (credible citations, statistics)
4. Trustworthiness (accuracy, transparency, sourcing)

Score each 0-100 and identify gaps.
`;
  
  return await callGPT4(prompt);
}
```

#### **3. Local Signal Density Checker**
```typescript
interface LocalSignalResult {
  cityMentionCount: number;
  zipCodeMentionCount: number;
  neighborhoodMentionCount: number;
  first3ParagraphsHaveLocation: boolean; // CRITICAL
  localRegulationsCited: string[];
  authorityEntitiesCited: string[];
  keyStatisticsUsed: string[];
  localSignalDensity: number; // 0-100 score
  issues: string[];
}

async function checkLocalSignalDensity(
  htmlContent: string,
  geographicFocus: string,
  batchCache: BatchSeoContext
): Promise<LocalSignalResult> {
  // Extract first 3 paragraphs
  // Check for city/ZIP/neighborhood mentions
  // Verify local regulations cited
  // Verify authority entities referenced
  // Calculate density score
  // Return audit report
}
```

#### **4. Schema Readiness Validator**
```typescript
interface SchemaReadinessResult {
  hasFAQSection: boolean;
  faqCount: number;
  hasHowToSection: boolean;
  hasComparisonTable: boolean;
  hasNumberedList: boolean;
  properHeadingHierarchy: boolean;
  semanticHTMLUsed: boolean;
  schemaReadyScore: number; // 0-100
  recommendations: string[];
}

async function validateSchemaReadiness(htmlContent: string): Promise<SchemaReadinessResult> {
  // Check for FAQ section (8-10 Q&As)
  // Check for HowTo/step-by-step
  // Check for comparison table
  // Validate heading hierarchy (h1 > h2 > h3)
  // Check semantic HTML usage
  // Return readiness report
}
```

#### **Master Validator Function**
```typescript
interface GPTReviewResult {
  passageQuality: PassageQualityResult;
  eatAudit: EEATAuditResult;
  localSignals: LocalSignalResult;
  schemaReadiness: SchemaReadinessResult;
  overallQualityScore: number; // 0-100
  passesThreshold: boolean;     // true if score >= 70
  criticalIssues: string[];
  recommendations: string[];
}

async function performGPTReview(
  htmlContent: string,
  params: {
    geographicFocus: string;
    batchId: number;
  }
): Promise<GPTReviewResult> {
  const batchCache = await getBatchSeoCache(params.batchId);
  
  const [passageQuality, eatAudit, localSignals, schemaReadiness] = await Promise.all([
    validatePassageQuality(htmlContent),
    auditEEATSignals(htmlContent, batchCache),
    checkLocalSignalDensity(htmlContent, params.geographicFocus, batchCache),
    validateSchemaReadiness(htmlContent)
  ]);
  
  const overallScore = calculateWeightedScore({
    passageQuality: passageQuality.selfContainedScore * 0.25,
    eatScore: eatAudit.overallEATScore * 0.35,
    localSignals: localSignals.localSignalDensity * 0.25,
    schemaReadiness: schemaReadiness.schemaReadyScore * 0.15
  });
  
  return {
    passageQuality,
    eatAudit,
    localSignals,
    schemaReadiness,
    overallQualityScore: overallScore,
    passesThreshold: overallScore >= 70,
    criticalIssues: identifyCriticalIssues({ passageQuality, eatAudit, localSignals }),
    recommendations: generateRecommendations({ passageQuality, eatAudit, localSignals })
  };
}
```

**Implementation Steps:**
1. Create new file: `lib/gpt-review-validator.ts`
2. Implement 4 validator functions
3. Create master validator
4. Integrate into article generation pipeline
5. Store validation results in `article_runs` table
6. Test with generated articles

**Estimated Lines:** ~400-500 lines (new file)

---

### Task 6: Update Stage 4 (QA/Finalization) 📋
**Status:** Pending  
**Files:** `lib/article-finalization.ts` or QA stage  
**Priority:** MEDIUM (Final polish)

**Required Enhancements:**

#### **1. JSON-LD Schema Embedding**
```typescript
interface SchemaGenerationParams {
  article: {
    title: string;
    content: string;
    author: string;
    datePublished: string;
    dateModified: string;
  };
  location: {
    city: string;
    state: string;
    zipCodes: string[];
  };
  business?: {
    name: string;
    url: string;
  };
  faqItems?: Array<{ question: string; answer: string }>;
}

function generateArticleSchema(params: SchemaGenerationParams): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": params.article.title,
    "author": {
      "@type": "Person",
      "name": params.article.author
    },
    "datePublished": params.article.datePublished,
    "dateModified": params.article.dateModified,
    "articleBody": params.article.content
  });
}

function generateFAQSchema(faqItems: Array<{ question: string; answer: string }>): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqItems.map(item => ({
      "@type": "Question",
      "name": item.question,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": item.answer
      }
    }))
  });
}

function generateLocalBusinessSchema(params: {
  businessName: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  url: string;
}): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "name": params.businessName,
    "address": {
      "@type": "PostalAddress",
      "streetAddress": params.address,
      "addressLocality": params.city,
      "addressRegion": params.state,
      "postalCode": params.zipCode,
      "addressCountry": "US"
    },
    "url": params.url
  });
}
```

#### **2. Coverage Metrics Tracking**
```typescript
async function trackCoverageMetrics(params: {
  articleId: number;
  clusterId?: number;
  nodeId?: number;
  depthScore: number;      // From GPT review
  localSignalStrength: number; // From GPT review
  eatScore: number;        // From GPT review
}) {
  // Update coverage_nodes if linked
  if (params.nodeId) {
    await db.update(coverageNodes).set({
      articleId: params.articleId,
      depthScore: params.depthScore,
      localSignalStrength: params.localSignalStrength,
      eatScore: params.eatScore,
      status: 'published',
      updatedAt: new Date()
    }).where(eq(coverageNodes.id, params.nodeId));
  }
  
  // Update content_clusters progress
  if (params.clusterId) {
    const completed = await db.select()
      .from(coverageNodes)
      .where(
        and(
          eq(coverageNodes.clusterId, params.clusterId),
          eq(coverageNodes.status, 'published')
        )
      );
    
    await db.update(contentClusters).set({
      totalNodesComplete: completed.length,
      updatedAt: new Date()
    }).where(eq(contentClusters.id, params.clusterId));
  }
}
```

**Implementation Steps:**
1. Add schema generation functions
2. Integrate schema into final HTML output
3. Add coverage metrics tracking
4. Update article finalization flow
5. Test schema validation with Google Rich Results Test

**Estimated Lines:** ~200-250 lines

---

### Task 7: Redesign Social Media Prompts 📋
**Status:** Pending  
**Files:** Social media generation modules  
**Priority:** LOW (Non-critical feature)

**Required Changes:**

#### **LinkedIn Prompt Enhancement**
```typescript
const linkedInPrompt = `
Create LinkedIn post based on article: ${articleTitle}

REQUIREMENTS:
1. HOOK (First 2 lines):
   - Start with ${geographicFocus}-specific stat from ${batchCache.keyStatistics}
   - Make it personal: "I just analyzed ${geographicFocus} data..."
   - First line must stop scroll

2. LOCAL AUTHORITY SIGNALS:
   - Reference ${batchCache.authorityEntities[0].name}
   - Cite ${batchCache.localRegulations[0].title}
   - Use ${batchCache.locationAnalysis.neighborhoods} for specificity

3. STRUCTURE (1300-2000 chars):
   → Hook with ${geographicFocus} context
   → 3 key insights (use local statistics)
   → Soft CTA + question for comments
`;
```

#### **Twitter/X Prompt Enhancement**
```typescript
const twitterPrompt = `
Create Twitter thread based on article: ${articleTitle}

REQUIREMENTS:
1. THREAD STRUCTURE (8-12 tweets):
   Tweet 1: Hook with ${geographicFocus} stat
   Tweet 2-3: Local context (${batchCache.locationAnalysis.neighborhoods})
   Tweet 4-7: Key insights with ${batchCache.keyStatistics}
   Tweet 8-10: Authority citations (${batchCache.authorityEntities})
   Tweet 11-12: CTA + link

2. LOCAL HOOKS:
   - Use ${geographicFocus} in first tweet
   - Reference ${batchCache.localRegulations} for authority
   - Tag local ${batchCache.authorityEntities} if applicable
`;
```

**Implementation Steps:**
1. Locate social media prompt modules
2. Enhance with local intelligence integration
3. Add authority signal requirements
4. Test with sample articles

**Estimated Lines:** ~100-150 lines

---

### Task 8: Content Cluster Architecture 📋
**Status:** Pending  
**Files:** New module + admin UI  
**Priority:** MEDIUM (Strategic feature)

**Purpose:**
Enable users to plan comprehensive topic coverage with pillar + spoke structure.

**Required Components:**

#### **1. Cluster Planning API**
```typescript
// POST /api/clusters/create
interface CreateClusterRequest {
  topicPillar: string;       // e.g., "senior care"
  location: string;          // e.g., "Boston, Massachusetts"
  localeId?: number;
  subtopicsToGenerate: string[]; // Auto-generate coverage nodes
}

async function createContentCluster(params: CreateClusterRequest) {
  // Create cluster record
  const [cluster] = await db.insert(contentClusters).values({
    topicPillar: params.topicPillar,
    location: params.location,
    localeId: params.localeId,
    totalNodesPlanned: params.subtopicsToGenerate.length,
    status: 'planning'
  }).returning();
  
  // Generate coverage nodes for each subtopic
  const nodes = params.subtopicsToGenerate.map(subtopic => ({
    clusterId: cluster.id,
    subtopicCategory: categorizeSubtopic(subtopic),
    subtopicTitle: subtopic,
    status: 'pending'
  }));
  
  await db.insert(coverageNodes).values(nodes);
  
  return cluster;
}

function categorizeSubtopic(title: string): string {
  // AI-powered categorization or manual mapping
  // Returns: types, costs, laws, providers, testimonials, faqs, best_practices, neighborhoods
}
```

#### **2. Cluster Dashboard UI**
```typescript
// app/clusters/page.tsx
function ClustersDashboard() {
  return (
    <div>
      <h1>Content Clusters</h1>
      {clusters.map(cluster => (
        <Card key={cluster.id}>
          <CardHeader>
            <CardTitle>{cluster.topicPillar} - {cluster.location}</CardTitle>
            <Progress 
              value={(cluster.totalNodesComplete / cluster.totalNodesPlanned) * 100} 
            />
          </CardHeader>
          <CardContent>
            <p>{cluster.totalNodesComplete} / {cluster.totalNodesPlanned} subtopics covered</p>
            <CoverageNodesList clusterId={cluster.id} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

#### **3. Integration with Title Generation**
```typescript
// When generating titles, optionally link to cluster
async function generateTitlePool(...params, clusterId?: number) {
  const result = await generateTitles(...params);
  
  if (clusterId) {
    // Map titles to coverage nodes
    await autoMapTitlesToNodes(clusterId, result.titles);
  }
  
  return result;
}
```

**Implementation Steps:**
1. Create cluster management API routes
2. Build cluster dashboard UI
3. Integrate with title generation
4. Add cluster selection to batch creation flow
5. Test pillar + spoke workflow

**Estimated Lines:** ~600-800 lines (new module + UI)

---

### Task 9: Automated Validation Checks 📋
**Status:** Pending  
**Files:** New validation module  
**Priority:** HIGH (Quality enforcement)

**Required Validators:**

#### **1. Paragraph Length Enforcer**
```typescript
interface ParagraphValidationResult {
  valid: boolean;
  totalParagraphs: number;
  violations: Array<{
    paragraphNumber: number;
    sentenceCount: number;
    requirement: "3-5 sentences";
  }>;
}

function validateParagraphLength(htmlContent: string): ParagraphValidationResult {
  const paragraphs = extractParagraphs(htmlContent);
  const violations = paragraphs
    .map((p, i) => ({ paragraph: p, index: i + 1 }))
    .filter(({ paragraph }) => {
      const sentenceCount = countSentences(paragraph);
      return sentenceCount < 3 || sentenceCount > 5;
    })
    .map(({ index, paragraph }) => ({
      paragraphNumber: index,
      sentenceCount: countSentences(paragraph),
      requirement: "3-5 sentences" as const
    }));
  
  return {
    valid: violations.length === 0,
    totalParagraphs: paragraphs.length,
    violations
  };
}
```

#### **2. Local Signal Quota Checker**
```typescript
interface LocalSignalQuotaResult {
  meetsQuota: boolean;
  cityMentionsInFirst3: number;
  zipMentionsInFirst3: number;
  neighborhoodMentionsInFirst3: number;
  requirement: "At least 1 city/ZIP/neighborhood in first 3 paragraphs";
}

function checkLocalSignalQuota(
  htmlContent: string,
  geographicFocus: string,
  zipCodes: string[],
  neighborhoods: string[]
): LocalSignalQuotaResult {
  const first3Paragraphs = extractParagraphs(htmlContent).slice(0, 3).join(' ');
  
  const cityMentions = countMentions(first3Paragraphs, geographicFocus);
  const zipMentions = zipCodes.reduce((sum, zip) => 
    sum + countMentions(first3Paragraphs, zip), 0
  );
  const neighborhoodMentions = neighborhoods.reduce((sum, n) => 
    sum + countMentions(first3Paragraphs, n), 0
  );
  
  const totalMentions = cityMentions + zipMentions + neighborhoodMentions;
  
  return {
    meetsQuota: totalMentions > 0,
    cityMentionsInFirst3: cityMentions,
    zipMentionsInFirst3: zipMentions,
    neighborhoodMentionsInFirst3: neighborhoodMentions,
    requirement: "At least 1 city/ZIP/neighborhood in first 3 paragraphs"
  };
}
```

#### **3. Evidence Density Validator**
```typescript
interface EvidenceDensityResult {
  meetsStandard: boolean;
  statisticsFound: number;
  sourcedClaimsFound: number;
  authorityEntitiesCited: number;
  regulationsCited: number;
  evidenceDensity: number; // Citations per 100 words
  requirement: "At least 3-5 evidence points per 500 words";
}

function validateEvidenceDensity(
  htmlContent: string,
  batchCache: BatchSeoContext
): EvidenceDensityResult {
  const wordCount = countWords(htmlContent);
  const textContent = stripHTML(htmlContent);
  
  // Count evidence types
  const statisticsFound = batchCache.keyStatistics.filter(stat =>
    textContent.includes(stat.claim) || textContent.includes(stat.value)
  ).length;
  
  const authorityEntitiesCited = batchCache.authorityEntities.filter(entity =>
    textContent.includes(entity.name)
  ).length;
  
  const regulationsCited = batchCache.localRegulations.filter(reg =>
    textContent.includes(reg.title)
  ).length;
  
  const totalEvidence = statisticsFound + authorityEntitiesCited + regulationsCited;
  const evidencePer100Words = (totalEvidence / wordCount) * 100;
  
  return {
    meetsStandard: totalEvidence >= Math.floor(wordCount / 500) * 3,
    statisticsFound,
    sourcedClaimsFound: statisticsFound, // Assuming stats are sourced
    authorityEntitiesCited,
    regulationsCited,
    evidenceDensity: evidencePer100Words,
    requirement: "At least 3-5 evidence points per 500 words"
  };
}
```

**Implementation Steps:**
1. Create validation module with all checkers
2. Integrate into article generation pipeline
3. Add validation results to article_runs table
4. Display validation status in UI
5. Add regeneration triggers for failed validations

**Estimated Lines:** ~300-400 lines

---

### Task 10: End-to-End Testing 📋
**Status:** Pending  
**Priority:** HIGH (Final validation)

**Test Scenarios:**

#### **1. Sample Batch Test**
```typescript
const testBatch = {
  coreTopic: "Senior Home Care Services",
  geographicFocus: "Boston, Massachusetts",
  businessName: "BostonCare Services",
  targetUrl: "https://example.com",
  numTitles: 10
};

// Expected outputs:
// - 10 titles with coverage mapping
// - Each title categorized into subtopic pillars
// - Batch SEO cache v2.0 with deep local intelligence
// - ZIP codes: 02101, 02108, 02109, 02110, 02111
// - Neighborhoods: Back Bay, Beacon Hill, North End, etc.
// - Local regulations: Massachusetts Home Care Licensing
// - Authority entities: Massachusetts Executive Office of Elder Affairs
```

#### **2. Article Generation Test**
```typescript
// Generate 1 sample article
// Validate:
// - Answer-first paragraph (150-200 words) ✓
// - Paragraph length (3-5 sentences) ✓
// - Local signals in first 3 paragraphs ✓
// - E-E-A-T score >= 70 ✓
// - Schema readiness ✓
// - Evidence density ✓
```

#### **3. E-E-A-T Signal Validation**
```typescript
// Check generated article contains:
// - Experience: "In our 15 years serving Boston families..."
// - Expertise: Technical terminology with explanations
// - Authoritativeness: Citations to Mass. govt sources
// - Trustworthiness: Statistics with sources and years
```

#### **4. Schema Markup Validation**
```typescript
// Validate JSON-LD schemas:
// - Article schema with author/dates ✓
// - FAQPage schema with 8-10 Q&As ✓
// - LocalBusiness schema ✓
// - Test with Google Rich Results Test
```

**Implementation Steps:**
1. Create test script in `test-scripts/e2e-local-seo-test.ts`
2. Run against sample batch
3. Validate all outputs
4. Document results
5. Fix any issues discovered

**Estimated Lines:** ~200-300 lines (test script)

---

## 📊 PROGRESS TRACKING

| Task | Status | Files | Lines Changed | Priority | ETA |
|------|--------|-------|---------------|----------|-----|
| 1. Database Schema | ✅ Complete | schema.ts | +95 | HIGH | Done |
| 2. Batch Cache v2.0 | ✅ Complete | schema.ts, batch-seo-cache.ts | +150 | HIGH | Done |
| 3. Title Generation | 🔄 In Progress | gemini.ts | ~100 | HIGH | Session 1 |
| 4. Article Drafting | 📋 Pending | article-generation.ts | ~200 | HIGH | Session 1-2 |
| 5. GPT Review | 📋 Pending | gpt-review-validator.ts (new) | ~500 | HIGH | Session 2 |
| 6. QA/Finalization | 📋 Pending | article-finalization.ts | ~250 | MEDIUM | Session 2 |
| 7. Social Media | 📋 Pending | social-prompts.ts | ~150 | LOW | Session 3 |
| 8. Cluster Architecture | 📋 Pending | clusters/ (new module) | ~800 | MEDIUM | Session 3 |
| 9. Validation Checks | 📋 Pending | validators.ts (new) | ~400 | HIGH | Session 2 |
| 10. E2E Testing | 📋 Pending | test-scripts/ | ~300 | HIGH | Session 3 |

**Total Lines Estimated:** ~3,000+ lines of new/modified code

---

## 🎯 SESSION BREAKDOWN

### **Session 1 (Current):** Core Prompt Rewrites
- ✅ Task 1: Database Schema
- ✅ Task 2: Batch Cache v2.0
- 🔄 Task 3: Title Generation (in progress)
- 📋 Task 4: Article Drafting (target)

### **Session 2:** Validation & Quality
- Task 5: GPT Review Validator
- Task 6: QA/Finalization
- Task 9: Validation Checks

### **Session 3:** Advanced Features & Testing
- Task 7: Social Media
- Task 8: Cluster Architecture
- Task 10: E2E Testing

---

## 🔧 TECHNICAL NOTES

### **Cache Version Management**
- Current: v2.0
- Automatic invalidation of v1.0 caches
- New batches will generate enhanced local intelligence

### **Database Migrations**
- All schema changes applied via `execute_sql_tool`
- No manual migrations required
- Safe for existing data (nullable JSONB columns)

### **API Rate Limiting**
- Gemini: 10 RPM (free tier) or 2000 RPM (Tier 1)
- OpenAI: p-limit concurrency control with exponential backoff
- Batch SEO cache reduces API calls by 30-50%

### **Quality Thresholds**
- E-E-A-T score: >= 70/100
- Local signal density: >= 1 mention in first 3 paragraphs
- Paragraph length: 3-5 sentences (strict)
- Evidence density: >= 3-5 citations per 500 words

---

## 📚 METHODOLOGY SOURCES

**Lily Ray (Answer-First Structure):**
- 150-200 word answer-first paragraphs
- Front-load facts and evidence
- Quotable/citable by AI
- E-E-A-T signals throughout

**Mike King (Passage-Level Optimization):**
- 3-5 sentences per paragraph (strict)
- Self-contained paragraphs
- Optimized for AI extraction
- Compression and active voice

**Kevin Indig (Citation Optimization):**
- Schema-ready structure (FAQ, HowTo, Article, LocalBusiness)
- Front-load evidence in first 2-3 paragraphs
- Freshness signals (2024-2025 data)
- [Claim] + [Evidence] + [Implication] formula

---

## 🚀 NEXT ACTIONS

**Immediate (This Session):**
1. ✅ Complete Task 3 (Title Generation rewrite)
2. 🔄 Start Task 4 (Article Drafting composite prompt)
3. 📝 Document progress in replit.md

**Next Session:**
1. Complete Task 4 (Article Drafting)
2. Implement Task 5 (GPT Review Validator)
3. Add Task 9 (Validation Checks)

**Future Sessions:**
1. Task 6 (QA/Finalization with schema)
2. Task 8 (Cluster Architecture)
3. Task 10 (E2E Testing)

---

**Document Version:** 1.0  
**Last Updated:** November 19, 2025  
**Architect Review:** Tasks 1-2 Approved ✅
