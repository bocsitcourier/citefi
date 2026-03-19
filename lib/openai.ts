import { openaiClient, callOpenAI } from "./openai-client";
import { generateSchemas, embedSchemaInHTML, type SchemaGenerationResult } from "./schema-generator";
import { extractPhrasesFromHtml, safeApplyHyperlinks } from "./keyword-hyperlink-pipeline";

export interface FinalizeContentParams {
  articleText: string;
  keywords: string[];
  targetUrl: string;
  imageUrls: string[];
  hashtags: string[];
  faq: Array<{ question: string; answer: string }>;
}

/**
 * Normalizes brand name capitalization in HTML content to ensure exact case preservation.
 * This prevents GPT-4 from inadvertently changing brand names like "Bocsit" to "bocsit".
 * 
 * @param html - The HTML content to normalize
 * @param brandName - The exact brand name with correct capitalization (e.g., "Bocsit")
 * @returns HTML with all brand name occurrences normalized to exact capitalization
 */
function normalizeBrandCapitalization(html: string, brandName: string): string {
  if (!brandName) return html;
  
  let result = html;
  
  // Approach 1: Word boundary matching for plain text contexts
  const brandRegex = new RegExp(`\\b${brandName}\\b`, 'gi');
  result = result.replace(brandRegex, brandName);
  
  // Approach 2: Match brand name in quoted contexts (JSON-LD, attributes)
  // Handles "bocsit" or 'bocsit' variations
  const quotedRegex = new RegExp(`(["'])${brandName}\\1`, 'gi');
  result = result.replace(quotedRegex, `$1${brandName}$1`);
  
  // Approach 3: Match brand name with any case variation directly
  // This catches edge cases where word boundaries fail
  const directRegex = new RegExp(brandName, 'gi');
  result = result.replace(directRegex, brandName);
  
  return result;
}

/**
 * Adds inline styles to HTML elements to preserve formatting on copy-paste.
 * Ensures bold, font sizes, and tables are properly formatted when copied.
 */
function addInlineStylesToHTML(html: string): string {
  let styledHtml = html;
  
  // Add bold to h2 and h3 tags
  styledHtml = styledHtml.replace(/<h2([^>]*)>/gi, '<h2$1 style="font-weight: bold; font-size: 1.5em; margin-top: 1em; margin-bottom: 0.5em;">');
  styledHtml = styledHtml.replace(/<h3([^>]*)>/gi, '<h3$1 style="font-weight: bold; font-size: 1.25em; margin-top: 0.8em; margin-bottom: 0.4em;">');
  
  // Add bold to strong tags
  styledHtml = styledHtml.replace(/<strong([^>]*)>/gi, '<strong$1 style="font-weight: bold;">');
  
  // Add italic to em tags
  styledHtml = styledHtml.replace(/<em([^>]*)>/gi, '<em$1 style="font-style: italic;">');
  
  // Add table styling for borders and collapse
  styledHtml = styledHtml.replace(/<table([^>]*)>/gi, '<table$1 style="border-collapse: collapse; width: 100%; margin: 1em 0;">');
  styledHtml = styledHtml.replace(/<th([^>]*)>/gi, '<th$1 style="border: 1px solid #ddd; padding: 0.5em; text-align: left; background-color: #f5f5f5; font-weight: bold;">');
  styledHtml = styledHtml.replace(/<td([^>]*)>/gi, '<td$1 style="border: 1px solid #ddd; padding: 0.5em; text-align: left;">');
  
  // Add styling to paragraphs
  styledHtml = styledHtml.replace(/<p([^>]*)>/gi, '<p$1 style="margin: 0.5em 0; line-height: 1.6;">');
  
  return styledHtml;
}

export async function finalizeContent(params: FinalizeContentParams, brandName?: string, timeoutMs?: number): Promise<string> {
  const { articleText, keywords, targetUrl, imageUrls, hashtags, faq } = params;

  const systemPrompt = `You are an expert HTML content formatter and strategic content specialist. Your task is to transform MARKDOWN-formatted article content into beautifully structured, publication-ready semantic HTML that builds trust, demonstrates expertise, and supports sales - while preserving the strategic value and AI-optimized structure of the content. You are an expert at converting markdown syntax (##, ###, *, -, 1., **bold**, etc.) into proper semantic HTML tags.

${brandName ? `\n**CRITICAL BRAND REQUIREMENT:** When formatting content, preserve the EXACT capitalization of the brand name "${brandName}". Do NOT change it to lowercase "${brandName.toLowerCase()}" or any other variation. The brand name MUST appear exactly as "${brandName}" throughout the content.` : ''}`;

  const userPrompt = `Transform the following MARKDOWN article into semantic, AI-optimized HTML with the following requirements:

ARTICLE TEXT (MARKDOWN FORMAT):
${articleText}

NOTE: Hyperlinks will be applied programmatically after HTML conversion, so do NOT add any <a> tags manually.

IMAGE URLS TO INSERT (strategically place these images throughout the article):
${imageUrls.length > 0 ? imageUrls.map((url, i) => `${i + 1}. ${url}`).join('\n') : 'No images provided - skip image placement'}

FAQ SECTION TO ADD BEFORE HASHTAGS:
${faq.length > 0 ? faq.map((item, i) => `Q${i + 1}: ${item.question}\nA${i + 1}: ${item.answer}`).join('\n\n') : 'No FAQ provided'}

HASHTAGS TO APPEND AT BOTTOM:
${hashtags.length > 0 ? hashtags.join(' ') : 'No hashtags provided'}

REQUIREMENTS:

1. **AI-Optimized Semantic HTML Structure (Convert Markdown to HTML)**:
   - Wrap entire content in <article> tag
   - Convert ## headers to <h2> tags
   - Convert ### headers to <h3> tags
   - Convert paragraphs (text separated by blank lines) to <p> tags
   - Convert markdown bullet lists (-, *) to <ul> and <li> tags
   - Convert markdown numbered lists (1., 2., 3.) to <ol> and <li> tags
   - Convert **bold** to <strong> tags
   - Convert *italic* to <em> tags
   - Add schema.org microdata where appropriate (itemscope, itemtype for Article)
   - Wrap summary/key takeaways sections in semantic containers

2. **Structured Data Enhancement**:
   - Identify FAQ-style content and wrap in appropriate markup
   - Mark up step-by-step instructions clearly with ordered lists
   - Preserve any comparison tables or structured information
   - Maintain clear content hierarchy for AI parsing

3. **NO Manual Hyperlinking**:
   - DO NOT add any <a> tags or hyperlinks
   - Hyperlinks will be applied programmatically after HTML generation
   - Focus on semantic HTML structure only

4. **Image Placement**:
   ${imageUrls.length > 0 ? `
   - Insert all ${imageUrls.length} images strategically throughout the article MAIN CONTENT ONLY
   - Place images between paragraphs at natural breaking points in the BODY of the article
   - Spread images evenly through the main content (approximately every 20-30% of body text)
   - **CRITICAL**: DO NOT place any images in the FAQ section - FAQ should be text-only
   - Images should only appear BEFORE the FAQ section begins
   - Use this EXACT format (NO figcaption): <figure><img src="IMAGE_URL" alt="Simple descriptive alt text" class="article-image" /></figure>
   - DO NOT add figcaption or any caption/description text under images
   - Alt text should be brief and descriptive (5-10 words maximum)
   ` : '- No images provided - skip image placement'}

5. **FAQ Section**:
   ${faq.length > 0 ? `
   - Add FAQ section before hashtags with this structure:
   <section class="faq-section">
     <h2>Frequently Asked Questions</h2>
     ${faq.map(item => `
     <div class="faq-item" itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">
       <h3 itemprop="name">${item.question}</h3>
       <div itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">
         <p itemprop="text">${item.answer}</p>
       </div>
     </div>
     `).join('')}
   </section>
   ` : '- No FAQ provided - skip FAQ section'}

6. **Hashtags Section**:
   ${hashtags.length > 0 ? `- Add hashtags at the very end with CLICKABLE links to ${targetUrl}:
   <div class="hashtags">
     ${hashtags.map(tag => `<a href="${targetUrl}" target="_blank" rel="noopener noreferrer" class="hashtag-link">${tag}</a>`).join(' ')}
   </div>
   - Each hashtag must be wrapped in an <a> tag linking to ${targetUrl}
   - Add class="hashtag-link" to each hashtag link for styling` : '- No hashtags provided - skip hashtags section'}

6. **Content Quality & Strategic Value**:
   - Maintain the original article text exactly as written - preserve all strategic insights
   - Preserve BLUF (Bottom Line Up Front) structure for authority and clarity
   - Keep natural language question formats in headings
   - Maintain conversational tone and context bridges
   - Preserve all trust-building elements (data, examples, expert analysis)
   - Maintain sales-supporting language and decision-guidance
   - Preserve industry-specific terminology and deep expertise demonstrations
   - Ensure consistency in terminology and naming throughout
   - Verify no contradictory statements exist
   - Ensure all HTML is valid and properly closed
   - Only add HTML structure, hyperlinks, and images - do not modify the strategic content

Return ONLY the final HTML (no markdown, no explanations, no code blocks). Start with <article> and end with </article>.`;

  const { GPT_ENHANCEMENT_MODEL } = await import("./ai-config");
  const model = GPT_ENHANCEMENT_MODEL;
  
  const completion = await callOpenAI(
    (client) => client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 4000,
    }),
    `Finalize Content: ${articleText.substring(0, 50)}...`,
    timeoutMs // Pass timeout to callOpenAI wrapper (controls request timeout)
  );

  let finalHtml = completion.choices[0]?.message?.content || "";

  if (!finalHtml || finalHtml.length < 100) {
    throw new Error("GPT-4 failed to generate valid HTML content");
  }

  // **BRAND NORMALIZATION**: Ensure exact brand capitalization is preserved
  // This prevents GPT-4 from changing "Bocsit" → "bocsit" which triggers validation failures
  if (brandName) {
    finalHtml = normalizeBrandCapitalization(finalHtml, brandName);
    console.log(`🔒 Brand name normalization applied: "${brandName}"`);
  }

  return finalHtml.trim();
}

// ============================================================================
// ADVANCED GPT-4 ENHANCEMENT WITH INTERNAL LINKING
// ============================================================================

export interface GPTEnhancementResult {
  finalHtml: string;
  internalLinkSuggestions?: Array<{
    anchorText: string;
    targetArticleId?: number;
    context: string;
  }>;
  tokensUsed?: number;
  // TASK 6: JSON-LD schema metadata
  schemaGeneration?: SchemaGenerationResult;
}

export async function enhanceArticleWithGPT(
  articleText: string,
  seoTitle: string,
  metaDescription: string,
  keywords: string[],
  imageUrls: string[],
  semanticClusterId?: number,
  hyperlinks?: Array<{ phrase: string; url: string; type: string; anchorText: string }>,
  hashtags?: string[],
  faq?: Array<{ question: string; answer: string }>,
  targetUrl?: string,
  businessName?: string,
  geographicFocus?: string, // TASK 6: Location for schema
  hasStepByStepProcess?: boolean, // TASK 6: HowTo schema detection
  coveragePillar?: string, // TASK 6: Content cluster tracking
  eatScores?: { experience: number; expertise: number; authoritativeness: number; trustworthiness: number } // TASK 6: E-E-A-T for schema rating
): Promise<GPTEnhancementResult> {
  // ============================================================================
  // SAFEGUARD: Strip existing JSON-LD schemas and hyperlinks to prevent recursive nesting
  // ============================================================================
  // This prevents the exponential content growth bug where each reformat wraps
  // the prior JSON-LD inside articleBody, creating recursive schema nesting.
  let cleanedArticleText = articleText;
  
  // Count existing schemas/links for logging
  const existingSchemaCount = (articleText.match(/<script type="application\/ld\+json">/gi) || []).length;
  const existingLinkCount = (articleText.match(/class="text-primary hover:underline"/gi) || []).length;
  
  if (existingSchemaCount > 0 || existingLinkCount > 0) {
    console.log(`\n🧹 Cleaning existing enhancements before reprocessing...`);
    console.log(`  📊 Found ${existingSchemaCount} existing JSON-LD schemas`);
    console.log(`  📊 Found ${existingLinkCount} existing hyperlinks`);
    
    // Remove all existing JSON-LD script blocks
    cleanedArticleText = cleanedArticleText.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/gi, '');
    
    // Remove existing hyperlinks but preserve the anchor text
    cleanedArticleText = cleanedArticleText.replace(/<a[^>]*class="text-primary hover:underline"[^>]*>([^<]*)<\/a>/gi, '$1');
    
    // Remove any empty lines or excessive whitespace created by removals
    cleanedArticleText = cleanedArticleText.replace(/\n\s*\n\s*\n/g, '\n\n');
    
    console.log(`  ✅ Cleaned article ready for fresh enhancement`);
  }
  
  // Use cleaned text for further processing
  articleText = cleanedArticleText;
  
  // Extract the actual target URL from hyperlinks if not provided directly
  const actualTargetUrl = targetUrl || hyperlinks?.[0]?.url || '#';
  
  // GPT-4 needs extended timeout for complex formatting (800-2000 word articles)
  // Default: 240s (4 minutes) - balances reliability with throughput
  const gptEnhancementTimeout = parseInt(process.env.GPT_ENHANCEMENT_TIMEOUT_MS || "240000");
  
  let finalHtml = await finalizeContent({
    articleText,
    keywords,
    targetUrl: actualTargetUrl, // Use actual target URL, not placeholder
    imageUrls,
    hashtags: hashtags || [],
    faq: faq || [],
  }, businessName, gptEnhancementTimeout);
  
  // Add inline styles to preserve formatting on copy-paste (bold, font-size, tables)
  finalHtml = addInlineStylesToHTML(finalHtml);
  console.log(`✨ Applied inline styles for copy-paste formatting preservation`);

  // ============================================================================
  // NOTE: Hyperlink injection is now handled in worker.ts AFTER this function returns,
  // using the Global Slug Map engine (lib/slug-map-injector.ts). This avoids
  // double-injection and ensures a single, consistent hyperlink pass across all
  // generation paths (new articles, reformat, and fix-hyperlinks route).

  // ============================================================================
  // PROGRAMMATIC HASHTAG SECTION (PERMANENT FIX - December 2025)
  // ============================================================================
  // Ensures hashtags are ALWAYS appended to the HTML, not relying on GPT.
  // ============================================================================
  
  try {
    const hashtagsToApply = hashtags || [];
    
    if (hashtagsToApply.length > 0) {
      // Check if hashtags section already exists
      const hasHashtagSection = finalHtml.includes('class="hashtags"') || finalHtml.includes('class="hashtag-link"');
      
      if (!hasHashtagSection) {
        console.log(`\n🏷️ Programmatically adding ${hashtagsToApply.length} hashtags...`);
        
        // Build hashtag section HTML
        const hashtagLinks = hashtagsToApply.map(tag => 
          `<a href="${actualTargetUrl}" target="_blank" rel="noopener noreferrer" class="hashtag-link">${tag}</a>`
        ).join(' ');
        
        const hashtagSection = `\n<div class="hashtags" style="margin-top: 2em; padding-top: 1em; border-top: 1px solid #eee;">\n  ${hashtagLinks}\n</div>`;
        
        // Insert before closing </article> tag
        if (finalHtml.includes('</article>')) {
          finalHtml = finalHtml.replace('</article>', `${hashtagSection}\n</article>`);
          console.log(`  ✅ Hashtags appended: ${hashtagsToApply.slice(0, 5).join(", ")}...`);
        } else {
          // Append to end if no </article> tag
          finalHtml = finalHtml + hashtagSection;
          console.log(`  ✅ Hashtags appended (no article tag): ${hashtagsToApply.slice(0, 5).join(", ")}...`);
        }
      } else {
        console.log(`\n🏷️ Hashtags already present in HTML - skipping`);
      }
    }
  } catch (error) {
    console.error(`❌ Hashtag insertion failed:`, error);
  }

  // ============================================================================
  // TASK 6: GENERATE COMPREHENSIVE JSON-LD SCHEMA
  // ============================================================================
  
  let schemaGeneration: SchemaGenerationResult | undefined;
  
  try {
    console.log(`\n📋 Generating JSON-LD schema (Task 6)...`);
    schemaGeneration = generateSchemas({
      title: seoTitle,
      description: metaDescription,
      content: articleText,
      url: actualTargetUrl,
      imageUrls,
      datePublished: new Date(),
      keywords,
      businessName,
      geographicFocus,
      faq,
      hasStepByStepProcess,
      coveragePillar,
      eatScores,
    });
    
    // Embed schema in HTML
    finalHtml = embedSchemaInHTML(finalHtml, schemaGeneration.scriptTag);
    console.log(`✅ JSON-LD schema embedded - ${schemaGeneration.schemaTypes.join(', ')}`);
  } catch (error) {
    console.error(`❌ Schema generation failed:`, error);
    // Continue without schema if generation fails
  }

  // **CRITICAL FIX**: Apply brand normalization AGAIN after hyperlinks
  // Hyperlinks might have reintroduced lowercase brand names in anchor text
  if (businessName) {
    finalHtml = normalizeBrandCapitalization(finalHtml, businessName);
    console.log(`🔒 Post-hyperlink brand normalization applied: "${businessName}"`);
  }

  const internalLinkSuggestions = semanticClusterId ? [
    {
      anchorText: keywords[0] || 'related topic',
      context: 'Suggested link for semantic cluster',
    }
  ] : undefined;

  return {
    finalHtml,
    internalLinkSuggestions,
    tokensUsed: articleText.length / 4,
    schemaGeneration, // TASK 6: Include schema metadata
  };
}
