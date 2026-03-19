/**
 * TASK 8: CONTENT CLUSTER ARCHITECTURE SERVICE
 * 
 * Manages pillar + spoke content structure for comprehensive local topic coverage.
 * 
 * Architecture Pattern:
 * - PILLAR PAGE: Comprehensive topic overview (e.g., "Senior Care in San Francisco")
 * - SPOKE PAGES: Specific subtopics linked to pillar (e.g., "Memory Care in Castro District", "In-Home Care Costs in 94102")
 * 
 * Based on Kevin Indig's topical authority methodology + Lily Ray's E-E-A-T framework
 */

import { db } from "./db";
import { contentClusters, coverageNodes, articles, type ContentCluster, type CoverageNode } from "@/shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface ClusterPlan {
  topicPillar: string; // Main topic (e.g., "Elder Care")
  location: string; // Geographic focus (e.g., "San Francisco, CA")
  subtopicCategories: ClusterCategory[];
  estimatedNodeCount: number;
}

export interface ClusterCategory {
  category: string; // types, costs, laws, providers, etc.
  subtopics: ClusterNode[];
  priority: 'high' | 'medium' | 'low'; // Content priority
}

export interface ClusterNode {
  subtopicTitle: string;
  keywords: string[];
  localAngle: string; // Hyper-local focus (ZIP, neighborhood, regulation)
  coveragePillar: string; // Maps to 7 coverage pillars from Task 3
  estimatedDepth: number; // 0-100, content depth target
}

export interface ClusterHealth {
  clusterId: number;
  completionRate: number; // 0-100
  avgDepthScore: number; // 0-100
  avgLocalSignalStrength: number; // 0-100
  avgEatScore: number; // 0-100
  nodesCompleted: number;
  nodesPlanned: number;
  topGaps: Array<{ category: string; missingCount: number }>;
}

export interface ClusterRecommendations {
  clusterId: number;
  nextBestTopics: Array<{
    subtopicTitle: string;
    category: string;
    priority: 'high' | 'medium' | 'low';
    reasoning: string;
  }>;
  internalLinkOpportunities: Array<{
    fromArticleId: number;
    toArticleId: number;
    anchorText: string;
    relevanceScore: number;
  }>;
}

// ============================================================================
// CLUSTER PLANNING
// ============================================================================

/**
 * Generate a comprehensive cluster plan for a topic + location
 * 
 * Uses 8 standard subtopic categories for comprehensive coverage:
 * 1. types - Different types/variations of the service
 * 2. costs - Pricing, insurance, financial considerations
 * 3. laws - Local regulations, compliance, licensing
 * 4. providers - Local businesses, directories, reviews
 * 5. testimonials - Success stories, case studies
 * 6. faqs - Common questions and answers
 * 7. best_practices - How-tos, guides, expert advice
 * 8. neighborhoods - Hyper-local coverage by ZIP/neighborhood
 */
export function generateClusterPlan(
  topicPillar: string,
  location: string,
  industry?: string,
  zipCodes?: string[],
  neighborhoods?: string[]
): ClusterPlan {
  
  // Parse location for city/state (with fallback for city-only inputs)
  const locationParts = location.split(',').map(s => s.trim());
  const city = locationParts[0] || location;
  const state = locationParts[1] || ''; // Allow empty state for city-only inputs
  
  const categories: ClusterCategory[] = [
    // Category 1: Types (foundational coverage)
    {
      category: 'types',
      priority: 'high',
      subtopics: [
        {
          subtopicTitle: `Types of ${topicPillar} Services in ${city}`,
          keywords: [topicPillar.toLowerCase(), 'types', city.toLowerCase(), 'services'],
          localAngle: `Compare service types available in ${city}`,
          coveragePillar: 'foundational',
          estimatedDepth: 85,
        },
        {
          subtopicTitle: `Best ${topicPillar} Options for ${city} Residents`,
          keywords: [topicPillar.toLowerCase(), 'best options', city.toLowerCase()],
          localAngle: `Tailored to ${city} demographics and local needs`,
          coveragePillar: 'comparative',
          estimatedDepth: 80,
        },
      ],
    },
    
    // Category 2: Costs (cost/value pillar)
    {
      category: 'costs',
      priority: 'high',
      subtopics: [
        {
          subtopicTitle: `${topicPillar} Costs in ${city}: Complete ${new Date().getFullYear()} Guide`,
          keywords: [topicPillar.toLowerCase(), 'cost', 'price', city.toLowerCase(), new Date().getFullYear().toString()],
          localAngle: `${city} market rates, insurance coverage, payment options`,
          coveragePillar: 'cost_value',
          estimatedDepth: 90,
        },
        {
          subtopicTitle: `How to Afford ${topicPillar} in ${city}`,
          keywords: [topicPillar.toLowerCase(), 'afford', 'financial help', city.toLowerCase()],
          localAngle: `${city} assistance programs, Medicaid, veterans benefits`,
          coveragePillar: 'cost_value',
          estimatedDepth: 75,
        },
      ],
    },
    
    // Category 3: Laws & Regulations (location-specific pillar)
    {
      category: 'laws',
      priority: 'medium',
      subtopics: state ? [
        {
          subtopicTitle: `${state} ${topicPillar} Regulations: What ${city} Families Need to Know`,
          keywords: [state.toLowerCase(), topicPillar.toLowerCase(), 'regulations', 'laws', city.toLowerCase()],
          localAngle: `${state} state laws, ${city} county requirements, licensing standards`,
          coveragePillar: 'location_specific',
          estimatedDepth: 85,
        },
      ] : [
        {
          subtopicTitle: `${topicPillar} Regulations in ${city}: What Families Need to Know`,
          keywords: [topicPillar.toLowerCase(), 'regulations', 'laws', city.toLowerCase()],
          localAngle: `${city} local requirements, licensing standards, compliance`,
          coveragePillar: 'location_specific',
          estimatedDepth: 85,
        },
      ],
    },
    
    // Category 4: Providers (location-specific + comparative)
    {
      category: 'providers',
      priority: 'high',
      subtopics: [
        {
          subtopicTitle: `Top ${topicPillar} Providers in ${city}`,
          keywords: [topicPillar.toLowerCase(), 'providers', 'directory', city.toLowerCase()],
          localAngle: `${city} licensed providers, reviews, contact info`,
          coveragePillar: 'comparative',
          estimatedDepth: 80,
        },
      ],
    },
    
    // Category 5: Best Practices (process + advanced)
    {
      category: 'best_practices',
      priority: 'medium',
      subtopics: [
        {
          subtopicTitle: `How to Choose ${topicPillar} in ${city}: Expert Guide`,
          keywords: ['how to choose', topicPillar.toLowerCase(), city.toLowerCase(), 'guide'],
          localAngle: `${city}-specific considerations, local expert insights`,
          coveragePillar: 'process',
          estimatedDepth: 85,
        },
        {
          subtopicTitle: `${topicPillar} Best Practices for ${city} Families`,
          keywords: [topicPillar.toLowerCase(), 'best practices', city.toLowerCase()],
          localAngle: `${city} cultural context, local resources`,
          coveragePillar: 'advanced_specialized',
          estimatedDepth: 75,
        },
      ],
    },
    
    // Category 6: FAQs (foundational)
    {
      category: 'faqs',
      priority: 'medium',
      subtopics: [
        {
          subtopicTitle: `${topicPillar} in ${city}: Frequently Asked Questions`,
          keywords: [topicPillar.toLowerCase(), 'faq', city.toLowerCase(), 'questions'],
          localAngle: `${city}-specific questions and answers`,
          coveragePillar: 'foundational',
          estimatedDepth: 70,
        },
      ],
    },
  ];
  
  // Category 7: Neighborhoods (hyper-local)
  if (neighborhoods && neighborhoods.length > 0) {
    const neighborhoodSubtopics: ClusterNode[] = neighborhoods.slice(0, 5).map(hood => ({
      subtopicTitle: `${topicPillar} in ${hood}, ${city}`,
      keywords: [topicPillar.toLowerCase(), hood.toLowerCase(), city.toLowerCase()],
      localAngle: `${hood} neighborhood-specific providers, demographics, access`,
      coveragePillar: 'location_specific',
      estimatedDepth: 80,
    }));
    
    categories.push({
      category: 'neighborhoods',
      priority: 'high',
      subtopics: neighborhoodSubtopics,
    });
  }
  
  // Category 8: ZIP Code Coverage (hyper-local)
  if (zipCodes && zipCodes.length > 0) {
    const zipSubtopics: ClusterNode[] = zipCodes.slice(0, 3).map(zip => ({
      subtopicTitle: `${topicPillar} Services in ${zip} (${city})`,
      keywords: [topicPillar.toLowerCase(), zip, city.toLowerCase(), 'services'],
      localAngle: `${zip} ZIP code providers, local demographics, service gaps`,
      coveragePillar: 'location_specific',
      estimatedDepth: 75,
    }));
    
    categories.push({
      category: 'zip_codes',
      priority: 'medium',
      subtopics: zipSubtopics,
    });
  }
  
  const totalNodes = categories.reduce((sum, cat) => sum + cat.subtopics.length, 0);
  
  return {
    topicPillar,
    location,
    subtopicCategories: categories,
    estimatedNodeCount: totalNodes,
  };
}

// ============================================================================
// CLUSTER CRUD OPERATIONS
// ============================================================================

/**
 * Create a new content cluster in the database
 */
export async function createCluster(params: {
  teamId: number;
  topicPillar: string;
  location: string;
  localeId?: number;
  clusterPlan: ClusterPlan;
}): Promise<{ clusterId: number; nodeIds: number[] }> {
  const { teamId, topicPillar, location, localeId, clusterPlan } = params;
  
  // Insert cluster
  const [cluster] = await db.insert(contentClusters).values({
    teamId,
    topicPillar,
    location,
    localeId,
    status: 'planning',
    totalNodesPlanned: clusterPlan.estimatedNodeCount,
    totalNodesComplete: 0,
  }).returning();
  
  // Insert coverage nodes
  const nodeValues = clusterPlan.subtopicCategories.flatMap(category =>
    category.subtopics.map(subtopic => ({
      clusterId: cluster.id,
      subtopicCategory: category.category,
      subtopicTitle: subtopic.subtopicTitle,
      status: 'planned' as const,
      depthScore: 0,
      localSignalStrength: 0,
      eatScore: 0,
    }))
  );
  
  const nodes = await db.insert(coverageNodes).values(nodeValues).returning();
  
  console.log(`✅ Created cluster #${cluster.id}: "${topicPillar}" in ${location} with ${nodes.length} planned nodes`);
  
  return {
    clusterId: cluster.id,
    nodeIds: nodes.map((n: CoverageNode) => n.id),
  };
}

/**
 * Link an article to a coverage node
 */
export async function linkArticleToNode(params: {
  nodeId: number;
  articleId: number;
  depthScore?: number;
  localSignalStrength?: number;
  eatScore?: number;
}): Promise<void> {
  const { nodeId, articleId, depthScore = 0, localSignalStrength = 0, eatScore = 0 } = params;
  
  // Update node with article linkage and scores
  await db.update(coverageNodes)
    .set({
      articleId,
      status: 'complete',
      depthScore,
      localSignalStrength,
      eatScore,
      updatedAt: new Date(), // Use updatedAt instead of completedAt
    })
    .where(eq(coverageNodes.id, nodeId));
  
  // Update cluster completion count
  await db.execute(sql`
    UPDATE content_clusters
    SET total_nodes_complete = (
      SELECT COUNT(*) FROM coverage_nodes 
      WHERE cluster_id = (SELECT cluster_id FROM coverage_nodes WHERE id = ${nodeId})
      AND status = 'complete'
    ),
    status = CASE
      WHEN (SELECT COUNT(*) FROM coverage_nodes WHERE cluster_id = (SELECT cluster_id FROM coverage_nodes WHERE id = ${nodeId}) AND status = 'complete')
           = (SELECT total_nodes_planned FROM content_clusters WHERE id = (SELECT cluster_id FROM coverage_nodes WHERE id = ${nodeId}))
      THEN 'complete'
      ELSE 'in_progress'
    END
    WHERE id = (SELECT cluster_id FROM coverage_nodes WHERE id = ${nodeId})
  `);
  
  console.log(`✅ Linked article #${articleId} to coverage node #${nodeId}`);
}

/**
 * Get cluster health metrics
 */
export async function getClusterHealth(clusterId: number): Promise<ClusterHealth> {
  const [cluster] = await db.select()
    .from(contentClusters)
    .where(eq(contentClusters.id, clusterId));
  
  if (!cluster) {
    throw new Error(`Cluster #${clusterId} not found`);
  }
  
  // Get node statistics
  const nodes = await db.select()
    .from(coverageNodes)
    .where(eq(coverageNodes.clusterId, clusterId));
  
  const completedNodes = nodes.filter((n: CoverageNode) => n.status === 'complete');
  
  const avgDepthScore = completedNodes.length > 0
    ? completedNodes.reduce((sum: number, n: CoverageNode) => sum + n.depthScore, 0) / completedNodes.length
    : 0;
  
  const avgLocalSignalStrength = completedNodes.length > 0
    ? completedNodes.reduce((sum: number, n: CoverageNode) => sum + n.localSignalStrength, 0) / completedNodes.length
    : 0;
  
  const avgEatScore = completedNodes.length > 0
    ? completedNodes.reduce((sum: number, n: CoverageNode) => sum + n.eatScore, 0) / completedNodes.length
    : 0;
  
  // Identify top gaps (categories with most missing coverage)
  const categoryGaps: Record<string, { total: number; completed: number }> = {};
  
  nodes.forEach((node: CoverageNode) => {
    if (!categoryGaps[node.subtopicCategory]) {
      categoryGaps[node.subtopicCategory] = { total: 0, completed: 0 };
    }
    categoryGaps[node.subtopicCategory].total++;
    if (node.status === 'complete') {
      categoryGaps[node.subtopicCategory].completed++;
    }
  });
  
  const topGaps = Object.entries(categoryGaps)
    .map(([category, stats]) => ({
      category,
      missingCount: stats.total - stats.completed,
    }))
    .filter(gap => gap.missingCount > 0)
    .sort((a, b) => b.missingCount - a.missingCount)
    .slice(0, 5);
  
  return {
    clusterId,
    completionRate: cluster.totalNodesPlanned > 0
      ? (cluster.totalNodesComplete / cluster.totalNodesPlanned) * 100
      : 0,
    avgDepthScore,
    avgLocalSignalStrength,
    avgEatScore,
    nodesCompleted: cluster.totalNodesComplete,
    nodesPlanned: cluster.totalNodesPlanned,
    topGaps,
  };
}

/**
 * Get next best topics to cover in a cluster
 */
export async function getClusterRecommendations(clusterId: number): Promise<ClusterRecommendations> {
  // Get all planned nodes for this cluster
  const plannedNodes = await db.select()
    .from(coverageNodes)
    .where(
      and(
        eq(coverageNodes.clusterId, clusterId),
        eq(coverageNodes.status, 'planned')
      )
    );
  
  // Prioritize by category importance and coverage gaps
  const categoryPriority: Record<string, number> = {
    'types': 10,
    'costs': 9,
    'providers': 8,
    'neighborhoods': 8,
    'laws': 7,
    'best_practices': 6,
    'zip_codes': 6,
    'faqs': 5,
    'testimonials': 4,
  };
  
  const nextBestTopics = plannedNodes
    .map((node: CoverageNode) => ({
      subtopicTitle: node.subtopicTitle,
      category: node.subtopicCategory,
      priority: (categoryPriority[node.subtopicCategory] || 5) >= 8 ? 'high' as const
              : (categoryPriority[node.subtopicCategory] || 5) >= 6 ? 'medium' as const
              : 'low' as const,
      reasoning: `${node.subtopicCategory} coverage - ${getPriorityReasoning(node.subtopicCategory)}`,
    }))
    .sort((a: { priority: 'high' | 'medium' | 'low' }, b: { priority: 'high' | 'medium' | 'low' }) => {
      const priorityMap: Record<'high' | 'medium' | 'low', number> = { high: 3, medium: 2, low: 1 };
      return priorityMap[b.priority] - priorityMap[a.priority];
    })
    .slice(0, 10);
  
  // Get completed nodes for internal linking
  const completedNodes = await db.select({
    nodeId: coverageNodes.id,
    articleId: coverageNodes.articleId,
    subtopicTitle: coverageNodes.subtopicTitle,
    category: coverageNodes.subtopicCategory,
  })
    .from(coverageNodes)
    .where(
      and(
        eq(coverageNodes.clusterId, clusterId),
        eq(coverageNodes.status, 'complete')
      )
    );
  
  // Generate internal link opportunities (simplified - can be enhanced with NLP)
  type CompletedNodeType = {
    nodeId: number;
    articleId: number | null;
    subtopicTitle: string;
    category: string;
  };
  
  const internalLinkOpportunities = completedNodes.flatMap((fromNode: CompletedNodeType, i: number) =>
    completedNodes.slice(i + 1).map((toNode: CompletedNodeType) => ({
      fromArticleId: fromNode.articleId!,
      toArticleId: toNode.articleId!,
      anchorText: toNode.subtopicTitle,
      relevanceScore: calculateRelevanceScore(fromNode.category, toNode.category),
    }))
  ).filter((link: { relevanceScore: number }) => link.relevanceScore >= 50)
    .sort((a: { relevanceScore: number }, b: { relevanceScore: number }) => b.relevanceScore - a.relevanceScore)
    .slice(0, 20);
  
  return {
    clusterId,
    nextBestTopics,
    internalLinkOpportunities,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getPriorityReasoning(category: string): string {
  const reasons: Record<string, string> = {
    'types': 'Foundational content that establishes topic authority',
    'costs': 'High user intent - answers critical decision-making questions',
    'providers': 'High commercial intent - connects users to services',
    'neighborhoods': 'Hyper-local coverage boosts geographic relevance',
    'laws': 'Regulatory authority signals expertise and trustworthiness',
    'best_practices': 'Demonstrates practical expertise and thought leadership',
    'zip_codes': 'Neighborhood-level targeting for local SEO dominance',
    'faqs': 'Captures long-tail queries and Q&A schema opportunities',
    'testimonials': 'Social proof and E-E-A-T trust signals',
  };
  return reasons[category] || 'Completes comprehensive topic coverage';
}

function calculateRelevanceScore(category1: string, category2: string): number {
  // Categories that should be linked together
  const linkMatrix: Record<string, string[]> = {
    'types': ['costs', 'providers', 'best_practices'],
    'costs': ['types', 'providers', 'laws'],
    'providers': ['types', 'costs', 'neighborhoods', 'zip_codes'],
    'neighborhoods': ['providers', 'zip_codes'],
    'laws': ['costs', 'best_practices'],
    'best_practices': ['types', 'laws'],
    'zip_codes': ['providers', 'neighborhoods'],
    'faqs': ['types', 'costs'],
  };
  
  if (linkMatrix[category1]?.includes(category2) || linkMatrix[category2]?.includes(category1)) {
    return 80; // High relevance
  } else if (category1 === category2) {
    return 60; // Same category - moderate relevance
  } else {
    return 40; // Low relevance
  }
}
