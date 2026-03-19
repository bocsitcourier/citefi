/**
 * REDDIT RESEARCH SERVICE
 * 
 * Intent-Based Content Gap Analysis using Reddit
 * 
 * 4-Stage Process:
 * 1. Subreddit Identification - Find relevant subreddits for topic + location
 * 2. Topic Mining - Extract high-engagement posts with questions/pain points
 * 3. Content Gap Clustering - Group questions into structured themes
 * 4. E-E-A-T Proof Acquisition - Capture upvoted discussions as experience proof
 * 
 * Uses Playwright for web scraping (no API credentials needed)
 */

import { chromium, Browser, Page } from 'playwright';
import type { RedditOutline } from './reddit-intent-consolidation';

export interface RedditQuestion {
  question: string;
  url: string;
  upvotes: number;
  commentCount: number;
  subreddit: string;
  intentCategory: 'how' | 'why' | 'what' | 'comparison' | 'problem' | 'best' | 'general';
  rawText: string;
}

export interface RedditDiscussion {
  title: string;
  url: string;
  topComments: string[];
  upvotes: number;
  subreddit: string;
  eatProof: string; // Synthesized E-E-A-T proof from discussion
}

export interface ContentGapCluster {
  theme: string;
  questions: string[];
  coveragePillar: string; // Maps to 7 coverage pillars
  priority: 'high' | 'medium' | 'low';
  intentType: string;
}

export interface RedditResearchResult {
  subreddits: string[];
  questions: RedditQuestion[];
  discussions: RedditDiscussion[];
  contentGaps: ContentGapCluster[];
  totalPostsAnalyzed: number;
  researchTimestamp: string;
  consolidatedOutline?: RedditOutline | null; // Phase 1: Consolidated intent outline
}

/**
 * Identify relevant subreddits based on topic and location
 */
export function identifySubreddits(topic: string, location: string): string[] {
  const subreddits: string[] = [];
  
  // Extract city/state from location
  const locationParts = location.split(',').map(p => p.trim());
  const city = locationParts[0];
  const state = locationParts[1] || '';
  
  // Local subreddits (city-specific)
  const cityClean = city.replace(/\s+/g, '').toLowerCase();
  subreddits.push(`r/${cityClean}`);
  subreddits.push(`r/Ask${city.replace(/\s+/g, '')}`);
  
  if (state) {
    subreddits.push(`r/${state.replace(/\s+/g, '')}`);
  }
  
  // Topic-specific subreddits (mapped to common industries)
  const topicLower = topic.toLowerCase();
  
  if (topicLower.includes('senior') || topicLower.includes('elder') || topicLower.includes('aging')) {
    subreddits.push('r/AgingParents', 'r/CaregiverSupport', 'r/eldercare');
  } else if (topicLower.includes('plumb')) {
    subreddits.push('r/Plumbing', 'r/HomeImprovement', 'r/fixit');
  } else if (topicLower.includes('law') || topicLower.includes('legal') || topicLower.includes('attorney')) {
    subreddits.push('r/legaladvice', 'r/Ask_Lawyers');
  } else if (topicLower.includes('real estate') || topicLower.includes('housing')) {
    subreddits.push('r/RealEstate', 'r/FirstTimeHomeBuyer', 'r/realestateinvesting');
  } else if (topicLower.includes('restaurant') || topicLower.includes('food')) {
    subreddits.push('r/KitchenConfidential', 'r/Cooking', 'r/food');
  } else if (topicLower.includes('marketing') || topicLower.includes('seo')) {
    subreddits.push('r/marketing', 'r/SEO', 'r/digital_marketing');
  } else if (topicLower.includes('tech') || topicLower.includes('software')) {
    subreddits.push('r/technology', 'r/programming', 'r/webdev');
  } else if (topicLower.includes('fitness') || topicLower.includes('gym')) {
    subreddits.push('r/Fitness', 'r/loseit', 'r/bodyweightfitness');
  } else if (topicLower.includes('medical') || topicLower.includes('health')) {
    subreddits.push('r/AskDocs', 'r/Health', 'r/medical');
  } else {
    // Generic fallback
    subreddits.push('r/answers', 'r/NoStupidQuestions');
  }
  
  return subreddits;
}

/**
 * Categorize question intent based on language patterns
 */
function categorizeIntent(text: string): RedditQuestion['intentCategory'] {
  const lower = text.toLowerCase();
  
  if (lower.includes('how to') || lower.includes('how do') || lower.includes('how can')) {
    return 'how';
  } else if (lower.includes('why') || lower.includes('reason')) {
    return 'why';
  } else if (lower.includes('what is') || lower.includes('what are') || lower.includes('what\'s')) {
    return 'what';
  } else if (lower.includes('vs') || lower.includes('versus') || lower.includes('better than') || lower.includes('compare')) {
    return 'comparison';
  } else if (lower.includes('problem') || lower.includes('issue') || lower.includes('help') || lower.includes('won\'t') || lower.includes('doesn\'t work')) {
    return 'problem';
  } else if (lower.includes('best') || lower.includes('top') || lower.includes('recommend')) {
    return 'best';
  }
  
  return 'general';
}

/**
 * Scrape Reddit posts from a subreddit search page
 */
async function scrapeSubreddit(
  page: Page,
  subreddit: string,
  searchQuery: string,
  maxPosts = 20
): Promise<RedditQuestion[]> {
  const questions: RedditQuestion[] = [];
  
  try {
    // Navigate to subreddit search
    const searchUrl = `https://www.reddit.com/${subreddit}/search/?q=${encodeURIComponent(searchQuery)}&restrict_sr=1&sort=top&t=year`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    // Wait for posts to load
    await page.waitForTimeout(2000);
    
    // Extract post data
    const posts = await page.$$eval('article[data-testid="post-container"], div[data-click-id="text"]', (elements: Element[]) => {
      return elements.slice(0, 20).map((el: Element) => {
        const titleEl = el.querySelector('h3, [data-click-id="body"] h3, a[data-click-id="body"]');
        const upvoteEl = el.querySelector('[id^="vote-arrows"] span, div[aria-label*="upvote"]');
        const commentEl = el.querySelector('a[href*="/comments/"] span, [aria-label*="comment"]');
        const linkEl = el.querySelector('a[data-click-id="body"], a[href*="/comments/"]');
        
        return {
          title: titleEl?.textContent?.trim() || '',
          upvotes: upvoteEl?.textContent?.trim() || '0',
          comments: commentEl?.textContent?.trim() || '0',
          url: linkEl?.getAttribute('href') || ''
        };
      }).filter((p: { title: string; upvotes: string; comments: string; url: string }) => p.title && p.title.length > 10);
    });
    
    for (const post of posts.slice(0, maxPosts)) {
      const upvotes = parseInt(post.upvotes.replace(/[^\d]/g, '')) || 0;
      const comments = parseInt(post.comments.replace(/[^\d]/g, '')) || 0;
      
      // Only include posts with decent engagement
      if (upvotes >= 5 || comments >= 3) {
        questions.push({
          question: post.title,
          url: post.url.startsWith('http') ? post.url : `https://www.reddit.com${post.url}`,
          upvotes,
          commentCount: comments,
          subreddit,
          intentCategory: categorizeIntent(post.title),
          rawText: post.title
        });
      }
    }
    
  } catch (error) {
    console.warn(`[Reddit] Failed to scrape ${subreddit}:`, error instanceof Error ? error.message : 'Unknown error');
  }
  
  return questions;
}

/**
 * Extract E-E-A-T proof from a Reddit discussion page
 */
async function extractEATProof(
  page: Page,
  url: string,
  subreddit: string
): Promise<RedditDiscussion | null> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);
    
    // Extract title
    const title = await page.$eval('h1, [data-test-id="post-content"] h1, shreddit-post h3', 
      (el: Element) => el.textContent?.trim() || '').catch(() => '');
    
    // Extract upvotes
    const upvoteText = await page.$eval('[id^="vote-arrows"] span, faceplate-number', 
      (el: Element) => el.textContent?.trim() || '0').catch(() => '0');
    const upvotes = parseInt(upvoteText.replace(/[^\d]/g, '')) || 0;
    
    // Extract top comments (first 5)
    const comments = await page.$$eval('div[data-testid="comment"], shreddit-comment', (elements: Element[]) => {
      return elements.slice(0, 5).map((el: Element) => {
        const textEl = el.querySelector('div[data-testid="comment-body-text"], p');
        return textEl?.textContent?.trim() || '';
      }).filter((c: string) => c.length > 20);
    }).catch(() => []);
    
    if (!title || comments.length === 0) {
      return null;
    }
    
    // Synthesize E-E-A-T proof from discussion
    const eatProof = `Reddit discussion from ${subreddit} (${upvotes} upvotes): "${title}". Top community insights: ${comments.slice(0, 3).join(' | ')}`;
    
    return {
      title,
      url,
      topComments: comments,
      upvotes,
      subreddit,
      eatProof
    };
    
  } catch (error) {
    console.warn(`[Reddit] Failed to extract E-E-A-T proof from ${url}:`, error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

/**
 * Cluster questions into content gap themes
 */
function clusterContentGaps(questions: RedditQuestion[]): ContentGapCluster[] {
  const clusters: ContentGapCluster[] = [];
  
  // Group by intent category
  const intentGroups: Record<string, RedditQuestion[]> = {};
  
  for (const q of questions) {
    const key = q.intentCategory;
    if (!intentGroups[key]) {
      intentGroups[key] = [];
    }
    intentGroups[key].push(q);
  }
  
  // Create clusters from groups
  for (const [intentType, groupQuestions] of Object.entries(intentGroups)) {
    if (groupQuestions.length === 0) continue;
    
    // Map intent to coverage pillar
    const pillarMap: Record<string, string> = {
      'how': 'process',
      'why': 'foundational',
      'what': 'foundational',
      'comparison': 'comparative',
      'problem': 'advanced',
      'best': 'comparative',
      'general': 'foundational'
    };
    
    const coveragePillar = pillarMap[intentType] || 'foundational';
    
    // Determine priority based on engagement
    const avgUpvotes = groupQuestions.reduce((sum, q) => sum + q.upvotes, 0) / groupQuestions.length;
    const priority = avgUpvotes > 50 ? 'high' : avgUpvotes > 20 ? 'medium' : 'low';
    
    // Extract common theme from questions
    const theme = intentType === 'how' ? 'Process & How-To Guides' :
                  intentType === 'why' ? 'Foundational Understanding' :
                  intentType === 'comparison' ? 'Comparisons & Alternatives' :
                  intentType === 'problem' ? 'Problem Solving & Troubleshooting' :
                  intentType === 'best' ? 'Recommendations & Best Practices' :
                  'General Information';
    
    clusters.push({
      theme,
      questions: groupQuestions.map(q => q.question),
      coveragePillar,
      priority,
      intentType
    });
  }
  
  // Sort by priority
  clusters.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
  
  return clusters;
}

/**
 * Main Reddit research function
 * Performs complete Intent-Based Content Gap Analysis
 */
export async function performRedditResearch(
  topic: string,
  location: string,
  options: {
    maxSubreddits?: number;
    maxPostsPerSubreddit?: number;
    maxDiscussionsToAnalyze?: number;
  } = {}
): Promise<RedditResearchResult> {
  const {
    maxSubreddits = 5,
    maxPostsPerSubreddit = 20,
    maxDiscussionsToAnalyze = 10
  } = options;
  
  console.log(`[Reddit Research] Starting for topic: "${topic}", location: "${location}"`);
  
  let browser: Browser | null = null;
  
  try {
    // Step 1: Identify relevant subreddits
    const allSubreddits = identifySubreddits(topic, location);
    const subreddits = allSubreddits.slice(0, maxSubreddits);
    
    console.log(`[Reddit Research] Identified ${subreddits.length} subreddits:`, subreddits);
    
    // Launch browser (with graceful fallback for missing system dependencies)
    try {
      browser = await chromium.launch({ headless: true });
    } catch (launchError) {
      console.warn('[Reddit Research] ⚠️  Playwright browser launch failed (missing system dependencies):', 
        launchError instanceof Error ? launchError.message : 'Unknown error');
      console.warn('[Reddit Research] → Continuing WITHOUT Reddit enrichment (will use Gemini alone for titles)');
      
      return {
        subreddits,
        questions: [],
        discussions: [],
        contentGaps: [],
        totalPostsAnalyzed: 0,
        researchTimestamp: new Date().toISOString(),
        consolidatedOutline: null,
      };
    }
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    
    // Step 2: Topic mining - scrape questions from each subreddit
    const allQuestions: RedditQuestion[] = [];
    
    for (const subreddit of subreddits) {
      console.log(`[Reddit Research] Scraping ${subreddit}...`);
      const questions = await scrapeSubreddit(page, subreddit, topic, maxPostsPerSubreddit);
      allQuestions.push(...questions);
      
      // Rate limiting
      await page.waitForTimeout(1000);
    }
    
    console.log(`[Reddit Research] Found ${allQuestions.length} questions across ${subreddits.length} subreddits`);
    
    // Sort by engagement
    allQuestions.sort((a, b) => (b.upvotes + b.commentCount) - (a.upvotes + a.commentCount));
    
    // Step 3: Content gap clustering
    const contentGaps = clusterContentGaps(allQuestions);
    
    console.log(`[Reddit Research] Identified ${contentGaps.length} content gap clusters`);
    
    // Step 4: E-E-A-T proof acquisition - analyze top discussions
    const discussions: RedditDiscussion[] = [];
    const topQuestions = allQuestions.slice(0, maxDiscussionsToAnalyze);
    
    for (const question of topQuestions) {
      if (!question.url) continue;
      
      console.log(`[Reddit Research] Extracting E-E-A-T proof from: ${question.url}`);
      const discussion = await extractEATProof(page, question.url, question.subreddit);
      
      if (discussion) {
        discussions.push(discussion);
      }
      
      // Rate limiting
      await page.waitForTimeout(1500);
    }
    
    console.log(`[Reddit Research] Extracted ${discussions.length} E-E-A-T proof discussions`);
    
    // Close browser
    await browser.close();
    browser = null;
    
    const result: RedditResearchResult = {
      subreddits,
      questions: allQuestions,
      discussions,
      contentGaps,
      totalPostsAnalyzed: allQuestions.length,
      researchTimestamp: new Date().toISOString()
    };
    
    console.log(`[Reddit Research] Complete! Analyzed ${result.totalPostsAnalyzed} posts, found ${result.contentGaps.length} content gaps`);
    
    return result;
    
  } catch (error) {
    console.error('[Reddit Research] Error:', error instanceof Error ? error.message : 'Unknown error');
    
    if (browser) {
      await browser.close().catch(() => {});
    }
    
    // Return empty result on error
    return {
      subreddits: [],
      questions: [],
      discussions: [],
      contentGaps: [],
      totalPostsAnalyzed: 0,
      researchTimestamp: new Date().toISOString()
    };
  }
}

/**
 * Format Reddit questions as H2/H3 headings for article structure
 */
export function formatQuestionsAsHeadings(questions: RedditQuestion[], maxHeadings = 10): string[] {
  return questions
    .slice(0, maxHeadings)
    .map(q => {
      // Clean up question text
      let heading = q.question.trim();
      
      // Ensure it ends with question mark if it's a question
      if (!heading.endsWith('?') && (heading.includes('how') || heading.includes('why') || heading.includes('what'))) {
        heading += '?';
      }
      
      return heading;
    });
}

/**
 * Extract E-E-A-T proof snippets for article content
 */
export function extractEATSnippets(discussions: RedditDiscussion[], maxSnippets = 5): string[] {
  return discussions
    .slice(0, maxSnippets)
    .map(d => d.eatProof);
}
