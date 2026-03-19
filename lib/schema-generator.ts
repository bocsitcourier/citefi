/**
 * TASK 6: JSON-LD SCHEMA GENERATOR
 * 
 * Generates comprehensive schema.org JSON-LD markup for articles to maximize
 * AI citation potential and search visibility. Supports:
 * - Article (NewsArticle with rich metadata)
 * - FAQPage (for FAQ sections)
 * - HowTo (for step-by-step processes)
 * - LocalBusiness (for location-specific content)
 * 
 * Based on Kevin Indig's citation optimization methodology.
 */

export interface SchemaGeneratorParams {
  // Article metadata
  title: string;
  description: string;
  content: string; // Used for word count, keywords, detection
  url: string;
  imageUrls: string[];
  datePublished: Date;
  dateModified?: Date;
  keywords: string[];
  
  // Business/Author info
  businessName?: string;
  authorName?: string;
  
  // Geographic focus
  geographicFocus?: string; // e.g., "Seattle, WA"
  addressLocality?: string; // City
  addressRegion?: string; // State
  postalCode?: string; // ZIP code
  
  // FAQ data
  faq?: Array<{ question: string; answer: string }>;
  
  // Content analysis (from validator)
  hasStepByStepProcess?: boolean;
  estimatedReadingTime?: number; // minutes
  
  // Coverage tracking
  coveragePillar?: string; // foundational, comparative, location-specific, etc.
  eatScores?: {
    experience: number;
    expertise: number;
    authoritativeness: number;
    trustworthiness: number;
  };
}

export interface GeneratedSchemas {
  article: object;
  faqPage?: object;
  howTo?: object;
  localBusiness?: object;
  breadcrumbList?: object;
  organization?: object;
}

export interface SchemaGenerationResult {
  schemas: GeneratedSchemas;
  scriptTag: string; // Complete <script type="application/ld+json"> ready for embedding
  schemaTypes: string[]; // List of schema types generated
  coverageMetrics: {
    hasArticleSchema: boolean;
    hasFAQSchema: boolean;
    hasHowToSchema: boolean;
    hasLocalBusinessSchema: boolean;
    totalSchemas: number;
    estimatedCitationScore: number; // 0-100 based on schema coverage
  };
}

/**
 * Generates comprehensive JSON-LD schema markup for an article
 */
export function generateSchemas(params: SchemaGeneratorParams): SchemaGenerationResult {
  const {
    title,
    description,
    content,
    url,
    imageUrls,
    datePublished,
    dateModified,
    keywords,
    businessName,
    authorName,
    geographicFocus,
    addressLocality,
    addressRegion,
    postalCode,
    faq,
    hasStepByStepProcess,
    estimatedReadingTime,
    coveragePillar,
    eatScores,
  } = params;

  const schemaTypes: string[] = [];

  // Calculate word count for reading time
  const wordCount = content.split(/\s+/).length;
  const readingTimeMinutes = estimatedReadingTime || Math.ceil(wordCount / 200); // 200 WPM average

  // ============================================================================
  // 1. ARTICLE SCHEMA (Always included)
  // ============================================================================
  
  const articleSchema: any = {
    "@context": "https://schema.org",
    "@type": "NewsArticle", // More specific than Article for SEO
    headline: title,
    description: description,
    image: imageUrls.length > 0 ? imageUrls : undefined,
    datePublished: datePublished.toISOString(),
    dateModified: (dateModified || datePublished).toISOString(),
    author: {
      "@type": businessName ? "Organization" : "Person",
      name: authorName || businessName || "Content Team",
    },
    publisher: {
      "@type": "Organization",
      name: businessName || "Publisher",
      logo: imageUrls.length > 0 ? {
        "@type": "ImageObject",
        url: imageUrls[0], // Use first image as logo fallback
      } : undefined,
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": url,
    },
    keywords: keywords.join(", "),
    articleBody: content.substring(0, 5000), // First 5000 chars for schema
    wordCount: wordCount,
    timeRequired: `PT${readingTimeMinutes}M`, // ISO 8601 duration format
    inLanguage: "en-US",
  };

  // Add geographic coverage if location info provided
  if (geographicFocus || addressLocality) {
    articleSchema.spatialCoverage = {
      "@type": "Place",
      name: geographicFocus || addressLocality,
      address: (addressLocality || addressRegion) ? {
        "@type": "PostalAddress",
        addressLocality: addressLocality,
        addressRegion: addressRegion,
        postalCode: postalCode,
      } : undefined,
    };
  }

  // Add E-E-A-T signals as article properties
  if (eatScores) {
    // Calculate composite expertise rating (0-5 stars)
    const avgScore = (eatScores.experience + eatScores.expertise + eatScores.authoritativeness + eatScores.trustworthiness) / 4;
    const ratingValue = (avgScore / 100) * 5; // Convert 0-100 to 0-5
    
    if (ratingValue >= 3.5) { // Only add rating if score is good (70%+)
      articleSchema.aggregateRating = {
        "@type": "AggregateRating",
        ratingValue: ratingValue.toFixed(1),
        bestRating: "5",
        worstRating: "1",
        ratingCount: "1",
      };
    }
  }

  // Initialize schemas object with article (required)
  const schemas: GeneratedSchemas = {
    article: articleSchema,
  };
  schemaTypes.push("Article");

  // ============================================================================
  // 2. FAQPAGE SCHEMA (If FAQ provided)
  // ============================================================================
  
  if (faq && faq.length > 0) {
    const faqPageSchema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map(item => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
        },
      })),
    };
    
    schemas.faqPage = faqPageSchema;
    schemaTypes.push("FAQPage");
  }

  // ============================================================================
  // 3. HOWTO SCHEMA (If step-by-step process detected)
  // ============================================================================
  
  if (hasStepByStepProcess) {
    // Extract steps from numbered lists in content
    const steps = extractSteps(content);
    
    if (steps.length >= 3) { // Minimum 3 steps for HowTo schema
      const howToSchema = {
        "@context": "https://schema.org",
        "@type": "HowTo",
        name: title,
        description: description,
        image: imageUrls.length > 0 ? imageUrls[0] : undefined,
        estimatedCost: {
          "@type": "MonetaryAmount",
          currency: "USD",
          value: "0", // Free guide
        },
        totalTime: `PT${readingTimeMinutes}M`,
        step: steps.map((step, index) => ({
          "@type": "HowToStep",
          position: index + 1,
          name: step.name,
          text: step.text,
          image: imageUrls[index] || undefined,
        })),
      };
      
      schemas.howTo = howToSchema;
      schemaTypes.push("HowTo");
    }
  }

  // ============================================================================
  // 4. LOCALBUSINESS SCHEMA (If business + location info provided)
  // ============================================================================
  
  if (businessName && (addressLocality || geographicFocus)) {
    const localBusinessSchema: any = {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name: businessName,
      description: description,
      url: url,
      image: imageUrls.length > 0 ? imageUrls : undefined,
    };

    // Add address if locality/region provided
    if (addressLocality || addressRegion) {
      localBusinessSchema.address = {
        "@type": "PostalAddress",
        addressLocality: addressLocality,
        addressRegion: addressRegion,
        postalCode: postalCode,
        addressCountry: "US",
      };
    }

    // Add service area if geographic focus provided
    if (geographicFocus) {
      localBusinessSchema.areaServed = {
        "@type": "City",
        name: geographicFocus.split(',')[0].trim(), // Extract city from "Seattle, WA"
      };
    }

    schemas.localBusiness = localBusinessSchema;
    schemaTypes.push("LocalBusiness");
  }

  // ============================================================================
  // 5. BREADCRUMBLIST SCHEMA (For navigation hierarchy)
  // ============================================================================
  
  // Only add breadcrumbs if we have coverage pillar info
  if (coveragePillar) {
    const breadcrumbSchema = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: url.split('/').slice(0, 3).join('/'), // Root URL
        },
        {
          "@type": "ListItem",
          position: 2,
          name: capitalizeWords(coveragePillar.replace(/-/g, ' ')),
          item: url,
        },
      ],
    };
    
    schemas.breadcrumbList = breadcrumbSchema;
    schemaTypes.push("BreadcrumbList");
  }

  // ============================================================================
  // 6. ORGANIZATION SCHEMA (For brand building)
  // ============================================================================
  
  if (businessName) {
    const organizationSchema = {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: businessName,
      url: url.split('/').slice(0, 3).join('/'), // Root URL
      logo: imageUrls.length > 0 ? imageUrls[0] : undefined,
      sameAs: [], // Social media URLs could be added here
    };
    
    schemas.organization = organizationSchema;
    schemaTypes.push("Organization");
  }

  // ============================================================================
  // GENERATE SCRIPT TAG
  // ============================================================================
  
  // Combine all schemas into a single JSON-LD graph
  const combinedSchema = {
    "@context": "https://schema.org",
    "@graph": Object.values(schemas),
  };

  const scriptTag = `<script type="application/ld+json">\n${JSON.stringify(combinedSchema, null, 2)}\n</script>`;

  // ============================================================================
  // CALCULATE COVERAGE METRICS
  // ============================================================================
  
  const coverageMetrics = {
    hasArticleSchema: true, // Always included
    hasFAQSchema: !!schemas.faqPage,
    hasHowToSchema: !!schemas.howTo,
    hasLocalBusinessSchema: !!schemas.localBusiness,
    totalSchemas: schemaTypes.length,
    estimatedCitationScore: calculateCitationScore(schemas, eatScores),
  };

  console.log(`\n📋 JSON-LD SCHEMA GENERATION COMPLETE`);
  console.log(`   Schemas Generated: ${schemaTypes.join(', ')}`);
  console.log(`   Total Schema Count: ${coverageMetrics.totalSchemas}`);
  console.log(`   Estimated Citation Score: ${coverageMetrics.estimatedCitationScore}/100`);

  return {
    schemas,
    scriptTag,
    schemaTypes,
    coverageMetrics,
  };
}

/**
 * Extracts numbered steps from content for HowTo schema
 */
function extractSteps(content: string): Array<{ name: string; text: string }> {
  const steps: Array<{ name: string; text: string }> = [];
  
  // Match numbered list patterns: "1. ", "1) ", "Step 1:", etc.
  const stepRegex = /(?:^|\n)(?:\d+[\.\)]\s+|Step\s+\d+:?\s+)(.+?)(?=\n(?:\d+[\.\)]\s+|Step\s+\d+:?|\n|$))/gis;
  const matches = content.matchAll(stepRegex);
  
  for (const match of matches) {
    const stepText = match[1].trim();
    if (stepText.length > 10) { // Minimum length for valid step
      // Extract first sentence as name
      const sentences = stepText.split(/[.!?]/);
      const name = sentences[0].trim().substring(0, 100); // Max 100 chars for name
      const text = stepText.substring(0, 500); // Max 500 chars for text
      
      steps.push({ name, text });
    }
  }
  
  return steps;
}

/**
 * Calculates estimated citation score based on schema coverage and E-E-A-T
 */
function calculateCitationScore(schemas: GeneratedSchemas, eatScores?: any): number {
  let score = 50; // Base score
  
  // Schema coverage bonus (max 30 points)
  if (schemas.article) score += 10;
  if (schemas.faqPage) score += 10;
  if (schemas.howTo) score += 5;
  if (schemas.localBusiness) score += 5;
  if (schemas.breadcrumbList) score += 2;
  if (schemas.organization) score += 3;
  
  // E-E-A-T bonus (max 20 points)
  if (eatScores) {
    const avgEAT = (eatScores.experience + eatScores.expertise + eatScores.authoritativeness + eatScores.trustworthiness) / 4;
    score += Math.round((avgEAT / 100) * 20);
  }
  
  return Math.min(score, 100);
}

/**
 * Capitalizes first letter of each word
 */
function capitalizeWords(str: string): string {
  return str.replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Embeds JSON-LD schema into HTML content
 */
export function embedSchemaInHTML(html: string, scriptTag: string): string {
  // Insert schema right AFTER opening <article> tag (inside the article)
  if (html.includes('<article>')) {
    return html.replace('<article>', `<article>\n${scriptTag}`);
  }
  
  // Also handle <article ...> with attributes
  const articleMatch = html.match(/<article[^>]*>/);
  if (articleMatch) {
    return html.replace(articleMatch[0], `${articleMatch[0]}\n${scriptTag}`);
  }
  
  // Fallback: prepend to content if no article tag found
  return `${scriptTag}\n${html}`;
}
