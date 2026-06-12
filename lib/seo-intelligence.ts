import { GEMINI_FLASH_MODEL } from "./ai-config";
import { GoogleGenAI } from "@google/genai";
import { openaiClient, callOpenAI } from "./openai-client";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export interface LocalSEOResearch {
  location: string;
  business_type: string;
  location_keywords: {
    primary: string[];
    long_tail: string[];
    neighborhood_specific: string[];
    landmarks: string[];
  };
  seasonal_trends: {
    season: string;
    keywords: string[];
    content_angles: string[];
    peak_months: string[];
  }[];
  local_questions: {
    question: string;
    search_intent: "informational" | "transactional" | "navigational";
    difficulty: "easy" | "medium" | "hard";
    suggested_content_type: string;
  }[];
  local_slang: {
    term: string;
    meaning: string;
    usage_example: string;
  }[];
  cultural_references: {
    reference: string;
    context: string;
    content_opportunity: string;
  }[];
  trending_topics: {
    topic: string;
    trend_score: number;
    content_angle: string;
    urgency: "high" | "medium" | "low";
  }[];
}

export interface CompetitorAnalysis {
  competitor_url: string;
  strengths: string[];
  weaknesses: string[];
  content_gaps: string[];
  suggested_improvements: {
    area: string;
    current_state: string;
    recommended_action: string;
    priority: "high" | "medium" | "low";
  }[];
  unique_angles: string[];
  keyword_opportunities: string[];
}

export interface SchemaMarkup {
  type: "Article" | "HowTo" | "FAQPage" | "LocalBusiness" | "Organization";
  json_ld: string;
}

export interface ContentStructure {
  title: string;
  meta_description: string;
  tldr: string;
  headings: {
    level: "h1" | "h2" | "h3";
    text: string;
    summary?: string;
  }[];
  faq_section: {
    question: string;
    answer: string;
  }[];
  key_takeaways: string[];
  definition_boxes: {
    term: string;
    definition: string;
  }[];
  schema_markup: SchemaMarkup[];
}

export interface PillarClusterStrategy {
  pillar_page: {
    title: string;
    description: string;
    target_keywords: string[];
    estimated_word_count: number;
    sections: string[];
  };
  cluster_pages: {
    title: string;
    description: string;
    target_keywords: string[];
    estimated_word_count: number;
    link_to_pillar: string;
    subtopics: string[];
  }[];
  internal_linking_map: {
    from: string;
    to: string;
    anchor_text: string;
  }[];
  content_calendar: {
    order: number;
    title: string;
    type: "pillar" | "cluster";
    priority: "high" | "medium" | "low";
  }[];
}

export async function researchLocalSEO(params: {
  location: string;
  business_type: string;
  core_topic?: string;
}): Promise<LocalSEOResearch> {
  const { location, business_type, core_topic } = params;

  const prompt = `You are a local SEO expert. Research and generate comprehensive local SEO insights for:

Location: ${location}
Business Type: ${business_type}
${core_topic ? `Core Topic: ${core_topic}` : ""}

Provide detailed local SEO research including:

1. LOCATION KEYWORDS:
   - Primary location-based keywords (city + service/product)
   - Long-tail local keywords (neighborhood + problem + solution)
   - Neighborhood-specific terms
   - Local landmarks and areas people search for

2. SEASONAL TRENDS:
   - Identify 4 seasonal trends unique to ${location}
   - Keywords that peak during each season
   - Content angles for each season
   - Peak months for each trend

3. LOCAL QUESTIONS:
   - 10 questions locals in ${location} ask about ${business_type}
   - Categorize by search intent (informational/transactional/navigational)
   - Difficulty level (easy/medium/hard to rank for)
   - Suggested content type for each question

4. LOCAL SLANG & PHRASES:
   - Common slang terms used in ${location}
   - Meanings and context
   - Example usage in content

5. CULTURAL REFERENCES:
   - Local cultural references relevant to ${business_type}
   - Context and significance
   - Content opportunities

6. TRENDING TOPICS:
   - Current trending topics in ${location} related to ${business_type}
   - Trend score (1-100)
   - Content angles
   - Urgency level (high/medium/low)

Return ONLY valid JSON matching this structure:
{
  "location": string,
  "business_type": string,
  "location_keywords": {
    "primary": string[],
    "long_tail": string[],
    "neighborhood_specific": string[],
    "landmarks": string[]
  },
  "seasonal_trends": [{
    "season": string,
    "keywords": string[],
    "content_angles": string[],
    "peak_months": string[]
  }],
  "local_questions": [{
    "question": string,
    "search_intent": "informational" | "transactional" | "navigational",
    "difficulty": "easy" | "medium" | "hard",
    "suggested_content_type": string
  }],
  "local_slang": [{
    "term": string,
    "meaning": string,
    "usage_example": string
  }],
  "cultural_references": [{
    "reference": string,
    "context": string,
    "content_opportunity": string
  }],
  "trending_topics": [{
    "topic": string,
    "trend_score": number,
    "content_angle": string,
    "urgency": "high" | "medium" | "low"
  }]
}`;

  const result = await genAI.models.generateContent({
    model: GEMINI_FLASH_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    config: {
      temperature: 0.7,
      responseMimeType: "application/json",
    },
  });

  const text = result.text || "";
  
  if (!text || text.trim().length === 0) {
    throw new Error("No response text from Gemini API");
  }
  
  const cleanedText = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  
  try {
    return JSON.parse(cleanedText) as LocalSEOResearch;
  } catch (error) {
    console.error("Failed to parse Gemini response:", cleanedText);
    throw new Error(`Invalid JSON response from Gemini: ${error}`);
  }
}

export async function analyzeCompetitor(params: {
  competitor_url: string;
  your_business_type: string;
  focus_areas?: string[];
}): Promise<CompetitorAnalysis> {
  const { competitor_url, your_business_type, focus_areas } = params;

  const prompt = `You are a competitive SEO analyst. Analyze this competitor:

Competitor URL: ${competitor_url}
Your Business Type: ${your_business_type}
${focus_areas ? `Focus Areas: ${focus_areas.join(", ")}` : ""}

Based on typical best practices for ${your_business_type} businesses, provide:

1. STRENGTHS: What are they doing well? (content, SEO, structure, UX)
2. WEAKNESSES: Where are they falling short?
3. CONTENT GAPS: Topics they're not covering that you could dominate
4. SUGGESTED IMPROVEMENTS: Specific actionable improvements to beat them
   - Include area, current state, recommended action, priority
5. UNIQUE ANGLES: Content angles they haven't explored
6. KEYWORD OPPORTUNITIES: Keywords they're missing or underutilizing

Return ONLY valid JSON:
{
  "competitor_url": string,
  "strengths": string[],
  "weaknesses": string[],
  "content_gaps": string[],
  "suggested_improvements": [{
    "area": string,
    "current_state": string,
    "recommended_action": string,
    "priority": "high" | "medium" | "low"
  }],
  "unique_angles": string[],
  "keyword_opportunities": string[]
}`;

  const completion = await callOpenAI(
    (client) => client.chat.completions.create({
      model: "gpt-4.1",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.7,
    }),
    `Competitor Analysis: ${competitor_url}`
  );

  return JSON.parse(completion.choices[0]!.message.content!) as CompetitorAnalysis;
}

export async function generateSchemaMarkup(params: {
  content_type: "Article" | "HowTo" | "FAQPage" | "LocalBusiness";
  data: any;
}): Promise<SchemaMarkup> {
  const { content_type, data } = params;

  let schema: any = {
    "@context": "https://schema.org",
    "@type": content_type,
  };

  switch (content_type) {
    case "Article":
      schema = {
        ...schema,
        headline: data.title,
        description: data.meta_description,
        author: {
          "@type": "Organization",
          name: data.author_name || "ApexContent Engine",
        },
        datePublished: data.published_date || new Date().toISOString(),
        dateModified: data.modified_date || new Date().toISOString(),
        image: data.image_url || "",
        publisher: {
          "@type": "Organization",
          name: data.publisher_name || "ApexContent Engine",
          logo: {
            "@type": "ImageObject",
            url: data.publisher_logo || "",
          },
        },
      };
      break;

    case "HowTo":
      schema = {
        ...schema,
        name: data.title,
        description: data.description,
        step: data.steps?.map((step: any, index: number) => ({
          "@type": "HowToStep",
          position: index + 1,
          name: step.name,
          text: step.description,
          image: step.image_url,
        })) || [],
        totalTime: data.total_time,
        tool: data.tools || [],
        supply: data.supplies || [],
      };
      break;

    case "FAQPage":
      schema = {
        ...schema,
        mainEntity: data.faqs?.map((faq: any) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: faq.answer,
          },
        })) || [],
      };
      break;

    case "LocalBusiness":
      schema = {
        ...schema,
        name: data.business_name,
        description: data.description,
        image: data.image_url,
        "@id": data.website_url,
        url: data.website_url,
        telephone: data.phone,
        address: {
          "@type": "PostalAddress",
          streetAddress: data.address?.street,
          addressLocality: data.address?.city,
          addressRegion: data.address?.state,
          postalCode: data.address?.zip,
          addressCountry: data.address?.country || "US",
        },
        geo: {
          "@type": "GeoCoordinates",
          latitude: data.geo?.latitude,
          longitude: data.geo?.longitude,
        },
        openingHoursSpecification: data.hours || [],
        priceRange: data.price_range,
        aggregateRating: data.rating ? {
          "@type": "AggregateRating",
          ratingValue: data.rating.value,
          reviewCount: data.rating.count,
        } : undefined,
      };
      break;
  }

  return {
    type: content_type,
    json_ld: JSON.stringify(schema, null, 2),
  };
}

export async function optimizeContentStructure(params: {
  topic: string;
  target_audience: string;
  word_count_target: number;
  include_faq?: boolean;
  include_definitions?: boolean;
}): Promise<ContentStructure> {
  const { topic, target_audience, word_count_target, include_faq = true, include_definitions = true } = params;

  const prompt = `You are a content structure expert optimizing for both humans and AI crawlers.

Topic: ${topic}
Target Audience: ${target_audience}
Word Count Target: ${word_count_target}
Include FAQ: ${include_faq}
Include Definitions: ${include_definitions}

Create an optimal content structure that:
- Uses clear H1, H2, H3 hierarchy
- Includes a compelling TL;DR summary
- Provides conversational, AI-friendly headings
- ${include_faq ? "Includes 8-10 FAQ questions people actually ask" : ""}
- ${include_definitions ? "Includes definition boxes for key terms" : ""}
- Lists 5-7 key takeaways
- Suggests appropriate schema markup types

Return ONLY valid JSON:
{
  "title": string,
  "meta_description": string,
  "tldr": string,
  "headings": [{
    "level": "h1" | "h2" | "h3",
    "text": string,
    "summary": string (optional 1-2 sentence summary for h2/h3)
  }],
  "faq_section": [{
    "question": string,
    "answer": string
  }],
  "key_takeaways": string[],
  "definition_boxes": [{
    "term": string,
    "definition": string
  }],
  "schema_markup": [{
    "type": "Article" | "HowTo" | "FAQPage",
    "json_ld": string
  }]
}`;

  const result = await genAI.models.generateContent({
    model: GEMINI_FLASH_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    config: {
      temperature: 0.8,
      responseMimeType: "application/json",
    },
  });

  const text = result.text || "";
  
  if (!text || text.trim().length === 0) {
    throw new Error("No response text from Gemini API");
  }
  
  const cleanedText = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  
  try {
    return JSON.parse(cleanedText) as ContentStructure;
  } catch (error) {
    console.error("Failed to parse Gemini response:", cleanedText);
    throw new Error(`Invalid JSON response from Gemini: ${error}`);
  }
}

export async function generatePillarClusterStrategy(params: {
  main_topic: string;
  industry: string;
  target_audience: string;
  num_cluster_pages?: number;
}): Promise<PillarClusterStrategy> {
  const { main_topic, industry, target_audience, num_cluster_pages = 8 } = params;

  const prompt = `You are a content strategy expert. Create a comprehensive pillar-cluster content strategy.

Main Topic (Pillar): ${main_topic}
Industry: ${industry}
Target Audience: ${target_audience}
Number of Cluster Pages: ${num_cluster_pages}

Create:
1. PILLAR PAGE: Comprehensive overview covering the broad topic
   - Title, description, target keywords
   - Estimated word count (2000-4000 words)
   - Main sections to cover

2. CLUSTER PAGES: ${num_cluster_pages} supporting articles
   - Each focuses on a specific subtopic
   - Estimated word count (800-1500 words)
   - How each links back to pillar
   - Specific subtopics covered

3. INTERNAL LINKING MAP: How pages connect
   - From/to relationships
   - Anchor text suggestions

4. CONTENT CALENDAR: Recommended publishing order
   - Order number, title, type (pillar/cluster), priority

Return ONLY valid JSON:
{
  "pillar_page": {
    "title": string,
    "description": string,
    "target_keywords": string[],
    "estimated_word_count": number,
    "sections": string[]
  },
  "cluster_pages": [{
    "title": string,
    "description": string,
    "target_keywords": string[],
    "estimated_word_count": number,
    "link_to_pillar": string,
    "subtopics": string[]
  }],
  "internal_linking_map": [{
    "from": string,
    "to": string,
    "anchor_text": string
  }],
  "content_calendar": [{
    "order": number,
    "title": string,
    "type": "pillar" | "cluster",
    "priority": "high" | "medium" | "low"
  }]
}`;

  const completion = await callOpenAI(
    (client) => client.chat.completions.create({
      model: "gpt-4.1",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.8,
    }),
    `Pillar Cluster Strategy: ${main_topic}`
  );

  return JSON.parse(completion.choices[0]!.message.content!) as PillarClusterStrategy;
}
