import { generateArticleContent, ArticleGenerationResult } from "./gemini";
import { finalizeContent } from "./openai";
import { researchLocalSEO, optimizeContentStructure, generateSchemaMarkup } from "./seo-intelligence";

export interface EnhancedArticleParams {
  title: string;
  targetUrl: string;
  wordCountMin?: number;
  wordCountMax?: number;
  tone?: string;
  geographicFocus?: string;
  audience?: string;
  useLocalSEO?: boolean;
  useContentOptimization?: boolean;
  useSchemaMarkup?: boolean;
}

export interface EnhancedArticleResult extends ArticleGenerationResult {
  localSEOInsights?: any;
  contentStructure?: any;
  schemaMarkup?: any;
  finalHtmlWithSchema?: string;
}

/**
 * Enhanced article generation that integrates SEO Intelligence tools
 * to automatically optimize content as it's being created
 */
export async function generateEnhancedArticle(
  params: EnhancedArticleParams,
  imageUrls: string[] = []
): Promise<EnhancedArticleResult> {
  const {
    title,
    targetUrl,
    wordCountMin = 800,
    wordCountMax = 2000,
    tone,
    geographicFocus,
    audience,
    useLocalSEO = true,
    useContentOptimization = true,
    useSchemaMarkup = true,
  } = params;

  console.log(`🚀 Starting enhanced article generation for: "${title}"`);

  // Step 1: Local SEO Research (if geographic focus is provided)
  let localSEOInsights = null;
  let enhancedPromptContext = "";

  if (useLocalSEO && geographicFocus) {
    console.log(`📍 Researching local SEO for: ${geographicFocus}`);
    try {
      localSEOInsights = await researchLocalSEO({
        location: geographicFocus,
        business_type: extractBusinessType(title),
        core_topic: extractCoreTopic(title),
      });

      // Add local keywords and insights to generation context
      enhancedPromptContext = buildLocalSEOContext(localSEOInsights);
      console.log(`✅ Local SEO research complete`);
    } catch (error) {
      console.warn(`⚠️ Local SEO research failed:`, error);
    }
  }

  // Step 2: Generate base article content with Gemini
  console.log(`📝 Generating article with Gemini 2.5 Pro...`);
  const baseArticle = await generateArticleContent(
    title,
    targetUrl,
    wordCountMin,
    wordCountMax,
    tone,
    geographicFocus,
    audience
  );

  // Step 3: Optimize content structure (if enabled)
  let contentStructure = null;
  if (useContentOptimization) {
    console.log(`⚙️ Optimizing content structure...`);
    try {
      contentStructure = await optimizeContentStructure({
        topic: title,
        target_audience: audience || "general audience",
        word_count_target: wordCountMax,
        include_faq: true,
        include_definitions: true,
      });
      console.log(`✅ Content structure optimized`);
    } catch (error) {
      console.warn(`⚠️ Content structure optimization failed:`, error);
    }
  }

  // Step 4: Generate schema markup (if enabled)
  let schemaMarkup = null;
  if (useSchemaMarkup) {
    console.log(`🏷️ Generating schema markup...`);
    try {
      const contentType = determineContentType(baseArticle.articleText);
      schemaMarkup = await generateSchemaMarkup({
        content_type: contentType,
        data: {
          title,
          meta_description: baseArticle.metaDescription,
          author_name: "ApexContent Engine",
          published_date: new Date().toISOString(),
          modified_date: new Date().toISOString(),
        },
      });
      console.log(`✅ Schema markup generated`);
    } catch (error) {
      console.warn(`⚠️ Schema markup generation failed:`, error);
    }
  }

  // Step 5: Finalize with GPT-4 (if images are provided)
  let finalHtmlWithSchema = "";
  if (imageUrls && imageUrls.length > 0) {
    console.log(`🎨 Finalizing with GPT-4 and adding schema markup...`);
    const finalHtml = await finalizeContent({
      articleText: baseArticle.articleText,
      keywords: baseArticle.keywords,
      targetUrl,
      imageUrls,
      hashtags: baseArticle.hashtags,
      faq: baseArticle.faq || [], // Add FAQ parameter (required in FinalizeContentParams)
    });

    // Inject schema markup into the HTML
    if (schemaMarkup) {
      finalHtmlWithSchema = injectSchemaMarkup(finalHtml, [schemaMarkup]);
    } else {
      finalHtmlWithSchema = finalHtml;
    }
    console.log(`✅ Article finalization complete with schema markup`);
  }

  console.log(`🎉 Enhanced article generation complete!`);

  return {
    ...baseArticle,
    localSEOInsights,
    contentStructure,
    schemaMarkup,
    finalHtmlWithSchema,
  };
}

/**
 * Helper: Extract business type from article title
 */
function extractBusinessType(title: string): string {
  // Simple heuristic - could be enhanced with NLP
  const commonTypes: Record<string, string> = {
    courier: "courier service",
    delivery: "delivery service",
    restaurant: "restaurant",
    plumber: "plumbing service",
    lawyer: "legal service",
    doctor: "medical practice",
    dentist: "dental practice",
    contractor: "contractor",
    cleaning: "cleaning service",
    landscaping: "landscaping service",
  };

  const lowerTitle = title.toLowerCase();
  for (const [keyword, type] of Object.entries(commonTypes)) {
    if (lowerTitle.includes(keyword)) {
      return type;
    }
  }

  return "local business";
}

/**
 * Helper: Extract core topic from title
 */
function extractCoreTopic(title: string): string {
  // Remove common prefixes and suffixes
  return title
    .replace(/^(how to|why|what|when|where|the|a|an)\s+/i, "")
    .replace(/\s+(guide|tips|strategies|best practices|explained)$/i, "")
    .trim();
}

/**
 * Helper: Build local SEO context for prompt enhancement
 */
function buildLocalSEOContext(insights: any): string {
  if (!insights) return "";

  const keywords = insights.location_keywords?.primary?.slice(0, 5).join(", ") || "";
  const localQuestions = insights.local_questions?.slice(0, 3).map((q: any) => q.question).join("; ") || "";

  return `\n\nLOCAL SEO INSIGHTS:
- Priority local keywords: ${keywords}
- Common local questions: ${localQuestions}
- Use local terminology and references naturally in the content`;
}

/**
 * Helper: Determine content type for schema markup
 */
function determineContentType(content: string): "Article" | "HowTo" | "FAQPage" {
  const lowerContent = content.toLowerCase();

  // Check for FAQ indicators
  if (
    lowerContent.includes("frequently asked questions") ||
    lowerContent.includes("q:") ||
    lowerContent.includes("question:")
  ) {
    return "FAQPage";
  }

  // Check for HowTo indicators
  if (
    lowerContent.includes("step 1") ||
    lowerContent.includes("how to") ||
    lowerContent.match(/\d+\.\s+\w+/g)
  ) {
    return "HowTo";
  }

  return "Article";
}

/**
 * Helper: Inject schema markup into HTML
 */
function injectSchemaMarkup(html: string, schemaMarkup: any[]): string {
  if (!schemaMarkup || schemaMarkup.length === 0) return html;

  // Add schema markup as JSON-LD script tags before closing article tag
  const schemaScripts = schemaMarkup
    .map((schema) => `<script type="application/ld+json">\n${schema.json_ld}\n</script>`)
    .join("\n");

  // Insert before closing </article> tag
  return html.replace("</article>", `${schemaScripts}\n</article>`);
}
