"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import {
  MapPin,
  TrendingUp,
  Users,
  Lightbulb,
  FileText,
  Network,
  Code,
  Target,
  Loader2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  SearchCheck,
  AlertCircle,
  CheckCircle2,
  Link,
  BarChart3,
  Zap,
  Activity,
  ListChecks,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export default function SEOToolsPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [expandedTool, setExpandedTool] = useState<string | null>("local");
  
  // Article Creation State
  const [articleTargetUrl, setArticleTargetUrl] = useState("");
  const [articleNumArticles, setArticleNumArticles] = useState("5");
  const [articleGeographicFocus, setArticleGeographicFocus] = useState("");
  const [showArticleForm, setShowArticleForm] = useState<string | null>(null);

  // Local Research State
  const [localLocation, setLocalLocation] = useState("");
  const [localBusiness, setLocalBusiness] = useState("");
  const [localTopic, setLocalTopic] = useState("");
  const [localResearch, setLocalResearch] = useState<any>(null);

  // Competitor Analysis State
  const [competitorUrl, setCompetitorUrl] = useState("");
  const [yourBusiness, setYourBusiness] = useState("");
  const [competitorAnalysis, setCompetitorAnalysis] = useState<any>(null);

  // Schema Markup State
  const [schemaType, setSchemaType] = useState("Article");
  const [schemaTitle, setSchemaTitle] = useState("");
  const [schemaDescription, setSchemaDescription] = useState("");
  const [schemaAuthor, setSchemaAuthor] = useState("");
  const [schemaPublishedDate, setSchemaPublishedDate] = useState("");
  const [schemaImageUrl, setSchemaImageUrl] = useState("");
  const [schemaMarkup, setSchemaMarkup] = useState<any>(null);

  // Content Structure State
  const [structureTopic, setStructureTopic] = useState("");
  const [structureAudience, setStructureAudience] = useState("");
  const [structureWordCount, setStructureWordCount] = useState("1500");
  const [contentStructure, setContentStructure] = useState<any>(null);

  // Pillar Cluster State
  const [pillarTopic, setPillarTopic] = useState("");
  const [pillarIndustry, setPillarIndustry] = useState("");
  const [pillarAudience, setPillarAudience] = useState("");
  const [pillarPages, setPillarPages] = useState("8");
  const [pillarStrategy, setPillarStrategy] = useState<any>(null);

  // Content Audit State
  const [auditArticleId, setAuditArticleId] = useState("");
  const [contentAudit, setContentAudit] = useState<any>(null);

  // Fetch user's articles for selection
  const { data: userArticles } = useQuery({
    queryKey: ["/api/articles/list"],
  });

  const contentAuditMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/seo/content-audit", {
        method: "POST",
        body: JSON.stringify({
          articleId: parseInt(auditArticleId),
        }),
      });
    },
    onSuccess: (data) => {
      setContentAudit(data);
      toast({
        title: "Audit Complete!",
        description: "Your content quality report is ready.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Audit Failed",
        description: error.message || "Failed to audit content",
        variant: "destructive",
      });
    },
  });

  const localResearchMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/seo/local-research", {
        method: "POST",
        body: JSON.stringify({
          location: localLocation,
          business_type: localBusiness,
          core_topic: localTopic || undefined,
        }),
      });
    },
    onSuccess: (data) => {
      setLocalResearch(data);
      toast({
        title: "Local Research Complete!",
        description: "Your local SEO insights are ready.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Research Failed",
        description: error.message || "Failed to research local SEO",
        variant: "destructive",
      });
    },
  });

  const competitorMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/seo/competitor-analysis", {
        method: "POST",
        body: JSON.stringify({
          competitor_url: competitorUrl,
          your_business_type: yourBusiness,
        }),
      });
    },
    onSuccess: (data) => {
      setCompetitorAnalysis(data);
      toast({
        title: "Analysis Complete!",
        description: "Competitor insights generated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Analysis Failed",
        description: error.message || "Failed to analyze competitor",
        variant: "destructive",
      });
    },
  });

  const schemaMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/seo/schema-markup", {
        method: "POST",
        body: JSON.stringify({
          content_type: schemaType,
          data: {
            title: schemaTitle,
            meta_description: schemaDescription,
            description: schemaDescription,
            author_name: schemaAuthor,
            published_date: schemaPublishedDate || undefined,
            image_url: schemaImageUrl || undefined,
          },
        }),
      });
    },
    onSuccess: (data) => {
      setSchemaMarkup(data);
      toast({
        title: "Schema Generated!",
        description: "Your schema markup is ready to copy.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to generate schema markup",
        variant: "destructive",
      });
    },
  });

  const structureMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/seo/content-structure", {
        method: "POST",
        body: JSON.stringify({
          topic: structureTopic,
          target_audience: structureAudience,
          word_count_target: parseInt(structureWordCount),
        }),
      });
    },
    onSuccess: (data) => {
      setContentStructure(data);
      toast({
        title: "Structure Optimized!",
        description: "Your content outline is ready.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Optimization Failed",
        description: error.message || "Failed to optimize structure",
        variant: "destructive",
      });
    },
  });

  const pillarMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/seo/pillar-cluster", {
        method: "POST",
        body: JSON.stringify({
          main_topic: pillarTopic,
          industry: pillarIndustry,
          target_audience: pillarAudience,
          num_cluster_pages: parseInt(pillarPages),
        }),
      });
    },
    onSuccess: (data) => {
      setPillarStrategy(data);
      toast({
        title: "Strategy Generated!",
        description: "Your pillar-cluster content plan is ready.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to generate strategy",
        variant: "destructive",
      });
    },
  });

  const createArticlesMutation = useMutation({
    mutationFn: async ({ seoToolType, seoToolOutput }: { seoToolType: string; seoToolOutput: any }) => {
      return apiRequest("/api/seo/create-articles", {
        method: "POST",
        body: JSON.stringify({
          seoToolType,
          seoToolOutput,
          targetUrl: articleTargetUrl,
          numArticles: parseInt(articleNumArticles),
          geographicFocus: articleGeographicFocus || undefined,
        }),
      });
    },
    onSuccess: (data) => {
      toast({
        title: "Title Pool Generated!",
        description: `${data.titleCount} titles ready. Taking you to configure and start generation...`,
      });
      setShowArticleForm(null);
      setArticleTargetUrl("");
      setArticleNumArticles("5");
      setArticleGeographicFocus("");
      router.push(`/batches/${data.batchId}/select`);
    },
    onError: (error: any) => {
      toast({
        title: "Creation Failed",
        description: error.message || "Failed to create articles",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="container mx-auto p-4 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">SEO Intelligence Tools</h1>
        <p className="text-muted-foreground">
          AI-powered tools to research, analyze, and optimize your content for search engines
        </p>
      </div>

      <div className="grid gap-6">
        {/* Content Audit Tool - Analyze Existing Articles */}
        <Card>
          <CardHeader 
            className="cursor-pointer"
            onClick={() => setExpandedTool(expandedTool === "audit" ? null : "audit")}
          >
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <SearchCheck className="w-5 h-5 text-primary" />
                  Content Audit & Quality Analysis
                </CardTitle>
                <CardDescription>
                  Analyze existing articles for GEO/AEO compliance, E-E-A-T signals, and internal linking opportunities
                </CardDescription>
              </div>
              {expandedTool === "audit" ? <ChevronUp /> : <ChevronDown />}
            </div>
          </CardHeader>
          {expandedTool === "audit" && (
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="audit-article">Select Article to Audit *</Label>
                <select
                  id="audit-article"
                  data-testid="select-audit-article"
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                  value={auditArticleId}
                  onChange={(e) => setAuditArticleId(e.target.value)}
                >
                  <option value="">Choose an article...</option>
                  {(userArticles as any[])?.map((article: any) => (
                    <option key={article.id} value={article.id}>
                      {article.title} {article.location ? `(${article.location})` : ""}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Select an article from your library to analyze its GEO compliance, E-E-A-T signals, and discover internal linking opportunities
                </p>
              </div>
              <Button
                onClick={() => contentAuditMutation.mutate()}
                disabled={!auditArticleId || contentAuditMutation.isPending}
                className="w-full"
                data-testid="button-audit-content"
              >
                {contentAuditMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Analyzing Article...
                  </>
                ) : (
                  <>
                    <SearchCheck className="w-4 h-4 mr-2" />
                    Run Quality Audit
                  </>
                )}
              </Button>

              {contentAudit && (
                <div className="mt-6 space-y-6">
                  {/* Overall Score Summary */}
                  <div className="border-t pt-4">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="w-5 h-5 text-primary" />
                        <h3 className="text-xl font-bold">Quality Score</h3>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-3xl font-bold">{contentAudit.overallScore}/5</span>
                        <Badge 
                          variant={
                            contentAudit.citationPotential === "high" ? "default" : 
                            contentAudit.citationPotential === "medium" ? "secondary" : 
                            "outline"
                          }
                          className="flex items-center gap-1 text-sm"
                        >
                          {contentAudit.citationPotential === "high" ? (
                            <>
                              <Target className="w-3 h-3" />
                              High Citation Potential
                            </>
                          ) : contentAudit.citationPotential === "medium" ? (
                            <>
                              <Zap className="w-3 h-3" />
                              Medium Citation Potential
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-3 h-3" />
                              Low Citation Potential
                            </>
                          )}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Criteria Scores */}
                  <div className="border-t pt-4">
                    <div className="flex items-center gap-2 mb-4">
                      <SearchCheck className="w-5 h-5 text-primary" />
                      <h3 className="text-lg font-semibold">Detailed Analysis</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {Object.entries(contentAudit.criteria || {}).map(([key, criterion]: [string, any]) => (
                        <Card key={key}>
                          <CardHeader className="pb-3">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-sm">
                                {key === "directAnswerCompliance" && "Direct Answer Compliance"}
                                {key === "entitySalience" && "Entity Salience (GEO)"}
                                {key === "eeeatSignals" && "E-E-A-T Signals"}
                                {key === "passageQuality" && "Passage Quality"}
                                {key === "schemaReadiness" && "Schema Readiness"}
                                {key === "geoOptimization" && "GEO Optimization"}
                              </CardTitle>
                              <div className="flex items-center gap-1">
                                {criterion.score >= 4 ? (
                                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                                ) : (
                                  <AlertCircle className="w-4 h-4 text-yellow-500" />
                                )}
                                <span className="font-bold text-lg">{criterion.score}/5</span>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            <p className="text-xs text-muted-foreground">{criterion.rationale}</p>
                            {criterion.suggestedEdit && criterion.score < 5 && (
                              <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
                                <div className="flex items-center gap-1 mb-1">
                                  <Lightbulb className="w-3 h-3 text-yellow-800 dark:text-yellow-200" />
                                  <p className="text-xs font-medium text-yellow-800 dark:text-yellow-200">
                                    Suggested Edit:
                                  </p>
                                </div>
                                <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                                  {criterion.suggestedEdit}
                                </p>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>

                  {/* Internal Link Opportunities */}
                  {contentAudit.internalLinkOpportunities && contentAudit.internalLinkOpportunities.length > 0 && (
                    <div className="border-t pt-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Link className="w-5 h-5 text-primary" />
                        <h3 className="text-lg font-semibold">Internal Linking Opportunities</h3>
                      </div>
                      <div className="space-y-3">
                        {contentAudit.internalLinkOpportunities.map((link: any, i: number) => (
                          <div key={i} className="p-4 bg-muted rounded-md">
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <Link className="w-4 h-4 text-primary" />
                                <p className="font-medium text-sm">Link to: {link.targetArticleTitle}</p>
                              </div>
                              <Badge variant="outline" className="text-xs">
                                {Math.round(link.relevanceScore * 100)}% relevance
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mb-2">
                              <strong>Anchor Text:</strong> "{link.anchorText}"
                            </p>
                            <p className="text-xs text-muted-foreground italic">
                              Context: {link.context}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recommendations */}
                  {contentAudit.recommendations && contentAudit.recommendations.length > 0 && (
                    <div className="border-t pt-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Sparkles className="w-5 h-5 text-primary" />
                        <h3 className="text-lg font-semibold">Recommendations</h3>
                      </div>
                      <div className="space-y-2">
                        {contentAudit.recommendations.map((rec: string, i: number) => (
                          <div key={i} className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                            <CheckCircle2 className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                            <p className="text-sm text-blue-900 dark:text-blue-100">{rec}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Compliance Issues */}
                  {contentAudit.complianceIssues && contentAudit.complianceIssues.length > 0 && (
                    <div className="border-t pt-4">
                      <div className="flex items-center gap-2 mb-3">
                        <AlertCircle className="w-5 h-5 text-destructive" />
                        <h3 className="text-lg font-semibold">Critical Issues</h3>
                      </div>
                      <div className="space-y-2">
                        {contentAudit.complianceIssues.map((issue: string, i: number) => (
                          <div key={i} className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                            <p className="text-sm text-red-900 dark:text-red-100">{issue}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          )}
        </Card>

        {/* Local SEO Research Tool */}
        <Card>
          <CardHeader 
            className="cursor-pointer"
            onClick={() => setExpandedTool(expandedTool === "local" ? null : "local")}
          >
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-primary" />
                  Local SEO Research
                </CardTitle>
                <CardDescription>
                  Discover location-specific keywords, seasonal trends, and local questions
                </CardDescription>
              </div>
              {expandedTool === "local" ? <ChevronUp /> : <ChevronDown />}
            </div>
          </CardHeader>
          {expandedTool === "local" && (
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="local-location">Location *</Label>
                  <Input
                    id="local-location"
                    data-testid="input-local-location"
                    placeholder="e.g., Boston, MA"
                    value={localLocation}
                    onChange={(e) => setLocalLocation(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="local-business">Business Type *</Label>
                  <Input
                    id="local-business"
                    data-testid="input-local-business"
                    placeholder="e.g., Courier Service"
                    value={localBusiness}
                    onChange={(e) => setLocalBusiness(e.target.value)}
                  />
                </div>
              </div>
              <Button
                onClick={() => localResearchMutation.mutate()}
                disabled={!localLocation || !localBusiness || localResearchMutation.isPending}
                className="w-full"
                data-testid="button-research-local"
              >
                {localResearchMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Researching...
                  </>
                ) : (
                  <>
                    <TrendingUp className="w-4 h-4 mr-2" />
                    Research Local SEO
                  </>
                )}
              </Button>

              {localResearch && (
                <div className="mt-6 space-y-6">
                  <div className="border-t pt-4 space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-lg font-semibold">✨ Create Articles from Local SEO Insights</h3>
                      <Button
                        onClick={() => setShowArticleForm(showArticleForm === "local" ? null : "local")}
                        variant="default"
                        data-testid="button-toggle-article-form-local"
                      >
                        <Sparkles className="w-4 h-4 mr-2" />
                        Create Articles
                      </Button>
                    </div>
                    
                    {showArticleForm === "local" && (
                      <Card>
                        <CardContent className="pt-6 space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="article-target-url-local">Target URL *</Label>
                            <Input
                              id="article-target-url-local"
                              data-testid="input-article-target-url-local"
                              placeholder="https://yoursite.com"
                              value={articleTargetUrl}
                              onChange={(e) => setArticleTargetUrl(e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="article-num-articles-local">Number of Articles (1-20)</Label>
                            <Input
                              id="article-num-articles-local"
                              type="number"
                              min={1}
                              max={20}
                              data-testid="input-article-num-articles-local"
                              value={articleNumArticles}
                              onChange={(e) => setArticleNumArticles(e.target.value)}
                            />
                          </div>
                          <Button
                            onClick={() => createArticlesMutation.mutate({ 
                              seoToolType: "local_research", 
                              seoToolOutput: { ...localResearch, location: localLocation, business_type: localBusiness } 
                            })}
                            disabled={!articleTargetUrl || createArticlesMutation.isPending}
                            className="w-full"
                            data-testid="button-create-articles-local"
                          >
                            {createArticlesMutation.isPending ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Generating Titles...
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-4 h-4 mr-2" />
                                Generate Title Pool
                              </>
                            )}
                          </Button>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                  
                  <div className="border-t pt-4">
                    <h3 className="text-lg font-semibold mb-3">📍 Location Keywords</h3>
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm font-medium mb-2">Primary Keywords:</p>
                        <div className="flex flex-wrap gap-2">
                          {localResearch.location_keywords?.primary?.map((kw: string, i: number) => (
                            <Badge key={i} variant="default">{kw}</Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t pt-4">
                    <h3 className="text-lg font-semibold mb-3">📅 Seasonal Trends</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {localResearch.seasonal_trends?.slice(0, 4).map((trend: any, i: number) => (
                        <Card key={i}>
                          <CardHeader className="pb-3">
                            <CardTitle className="text-base">{trend.season}</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            <p className="text-sm"><strong>Peak Months:</strong> {trend.peak_months?.join(", ")}</p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>

                  <div className="border-t pt-4">
                    <h3 className="text-lg font-semibold mb-3">❓ Local Questions</h3>
                    <div className="space-y-2">
                      {localResearch.local_questions?.slice(0, 5).map((q: any, i: number) => (
                        <div key={i} className="p-3 bg-muted rounded-md">
                          <p className="font-medium text-sm">{q.question}</p>
                          <div className="flex gap-2 mt-2">
                            <Badge variant="outline" className="text-xs">{q.search_intent}</Badge>
                            <Badge variant="outline" className="text-xs">{q.difficulty}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          )}
        </Card>

        {/* Competitor Analysis Tool */}
        <Card>
          <CardHeader 
            className="cursor-pointer"
            onClick={() => setExpandedTool(expandedTool === "competitor" ? null : "competitor")}
          >
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Target className="w-5 h-5 text-primary" />
                  Competitor Analysis
                </CardTitle>
                <CardDescription>
                  Analyze competitor profiles and get actionable improvement suggestions
                </CardDescription>
              </div>
              {expandedTool === "competitor" ? <ChevronUp /> : <ChevronDown />}
            </div>
          </CardHeader>
          {expandedTool === "competitor" && (
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="competitor-url">Competitor URL *</Label>
                <Input
                  id="competitor-url"
                  data-testid="input-competitor-url"
                  placeholder="https://competitor.com"
                  value={competitorUrl}
                  onChange={(e) => setCompetitorUrl(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="your-business">Your Business Type *</Label>
                <Input
                  id="your-business"
                  data-testid="input-your-business"
                  placeholder="e.g., E-commerce Store"
                  value={yourBusiness}
                  onChange={(e) => setYourBusiness(e.target.value)}
                />
              </div>
              <Button
                onClick={() => competitorMutation.mutate()}
                disabled={!competitorUrl || !yourBusiness || competitorMutation.isPending}
                className="w-full"
                data-testid="button-analyze-competitor"
              >
                {competitorMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Target className="w-4 h-4 mr-2" />
                    Analyze Competitor
                  </>
                )}
              </Button>

              {competitorAnalysis && (
                <div className="mt-6 space-y-4">
                  <div className="border-t pt-4 space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-lg font-semibold">✨ Create Articles from Competitor Insights</h3>
                      <Button
                        onClick={() => setShowArticleForm(showArticleForm === "competitor" ? null : "competitor")}
                        variant="default"
                        data-testid="button-toggle-article-form-competitor"
                      >
                        <Sparkles className="w-4 h-4 mr-2" />
                        Create Articles
                      </Button>
                    </div>
                    
                    {showArticleForm === "competitor" && (
                      <Card>
                        <CardContent className="pt-6 space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="article-target-url-competitor">Target URL *</Label>
                            <Input
                              id="article-target-url-competitor"
                              data-testid="input-article-target-url-competitor"
                              placeholder="https://yoursite.com"
                              value={articleTargetUrl}
                              onChange={(e) => setArticleTargetUrl(e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="article-geographic-focus-competitor">Geographic Focus *</Label>
                            <Input
                              id="article-geographic-focus-competitor"
                              data-testid="input-article-geographic-focus-competitor"
                              placeholder="e.g., Los Angeles, CA or New York City"
                              value={articleGeographicFocus}
                              onChange={(e) => setArticleGeographicFocus(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">Location for local SEO optimization</p>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="article-num-articles-competitor">Number of Articles (1-20)</Label>
                            <Input
                              id="article-num-articles-competitor"
                              type="number"
                              min={1}
                              max={20}
                              data-testid="input-article-num-articles-competitor"
                              value={articleNumArticles}
                              onChange={(e) => setArticleNumArticles(e.target.value)}
                            />
                          </div>
                          <Button
                            onClick={() => createArticlesMutation.mutate({ 
                              seoToolType: "competitor_analysis", 
                              seoToolOutput: { ...competitorAnalysis, competitor_url: competitorUrl } 
                            })}
                            disabled={!articleTargetUrl || !articleGeographicFocus || createArticlesMutation.isPending}
                            className="w-full"
                            data-testid="button-create-articles-competitor"
                          >
                            {createArticlesMutation.isPending ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Generating Titles...
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-4 h-4 mr-2" />
                                Generate Title Pool
                              </>
                            )}
                          </Button>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                  
                  <div className="border-t pt-4">
                    <h3 className="text-lg font-semibold mb-3">🎯 Suggested Improvements</h3>
                    <div className="space-y-3">
                      {competitorAnalysis.suggested_improvements?.slice(0, 5).map((imp: any, i: number) => (
                        <div key={i} className="p-3 bg-muted rounded-md">
                          <div className="flex justify-between items-start mb-2">
                            <p className="font-medium">{imp.area}</p>
                            <Badge variant="default" className="text-xs">{imp.priority}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{imp.recommended_action}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          )}
        </Card>

        {/* Schema Markup Generator Tool */}
        <Card>
          <CardHeader 
            className="cursor-pointer"
            onClick={() => setExpandedTool(expandedTool === "schema" ? null : "schema")}
          >
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Code className="w-5 h-5 text-primary" />
                  Schema Markup Generator
                </CardTitle>
                <CardDescription>
                  Generate structured data (Article, HowTo, FAQPage, LocalBusiness) for enhanced search visibility
                </CardDescription>
              </div>
              {expandedTool === "schema" ? <ChevronUp /> : <ChevronDown />}
            </div>
          </CardHeader>
          {expandedTool === "schema" && (
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="schema-type">Content Type *</Label>
                <select
                  id="schema-type"
                  data-testid="select-schema-type"
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                  value={schemaType}
                  onChange={(e) => setSchemaType(e.target.value)}
                >
                  <option value="Article">Article</option>
                  <option value="HowTo">HowTo</option>
                  <option value="FAQPage">FAQPage</option>
                  <option value="LocalBusiness">LocalBusiness</option>
                </select>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="schema-title">Title *</Label>
                  <Input
                    id="schema-title"
                    data-testid="input-schema-title"
                    placeholder="e.g., How to Brew Perfect Coffee"
                    value={schemaTitle}
                    onChange={(e) => setSchemaTitle(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="schema-author">Author *</Label>
                  <Input
                    id="schema-author"
                    data-testid="input-schema-author"
                    placeholder="e.g., Coffee Expert"
                    value={schemaAuthor}
                    onChange={(e) => setSchemaAuthor(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="schema-description">Description *</Label>
                <Input
                  id="schema-description"
                  data-testid="input-schema-description"
                  placeholder="Brief description of your content"
                  value={schemaDescription}
                  onChange={(e) => setSchemaDescription(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="schema-date">Published Date (Optional)</Label>
                  <Input
                    id="schema-date"
                    data-testid="input-schema-date"
                    type="date"
                    value={schemaPublishedDate}
                    onChange={(e) => setSchemaPublishedDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="schema-image">Image URL (Optional)</Label>
                  <Input
                    id="schema-image"
                    data-testid="input-schema-image"
                    placeholder="https://example.com/image.jpg"
                    value={schemaImageUrl}
                    onChange={(e) => setSchemaImageUrl(e.target.value)}
                  />
                </div>
              </div>
              <Button
                onClick={() => schemaMutation.mutate()}
                disabled={!schemaTitle || !schemaDescription || !schemaAuthor || schemaMutation.isPending}
                className="w-full"
                data-testid="button-generate-schema"
              >
                {schemaMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Code className="w-4 h-4 mr-2" />
                    Generate Schema
                  </>
                )}
              </Button>

              {schemaMarkup && (
                <div className="mt-6 space-y-4">
                  <div className="border-t pt-4">
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="text-lg font-semibold">📋 Schema Markup (JSON-LD)</h3>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(schemaMarkup.json_ld);
                          toast({ title: "Copied!", description: "Schema markup copied to clipboard" });
                        }}
                        data-testid="button-copy-schema"
                      >
                        Copy
                      </Button>
                    </div>
                    <pre className="bg-muted p-4 rounded-md overflow-x-auto text-xs" data-testid="pre-schema-output">
                      <code>{schemaMarkup.json_ld}</code>
                    </pre>
                  </div>
                </div>
              )}
            </CardContent>
          )}
        </Card>

        {/* Content Structure Tool */}
        <Card>
          <CardHeader 
            className="cursor-pointer"
            onClick={() => setExpandedTool(expandedTool === "structure" ? null : "structure")}
          >
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary" />
                  Content Structure Optimizer
                </CardTitle>
                <CardDescription>
                  Generate AI-friendly content outlines with headings, FAQs, and schema markup
                </CardDescription>
              </div>
              {expandedTool === "structure" ? <ChevronUp /> : <ChevronDown />}
            </div>
          </CardHeader>
          {expandedTool === "structure" && (
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="structure-topic">Topic *</Label>
                <Input
                  id="structure-topic"
                  data-testid="input-structure-topic"
                  placeholder="e.g., How to Start a Podcast"
                  value={structureTopic}
                  onChange={(e) => setStructureTopic(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="structure-audience">Target Audience *</Label>
                <Input
                  id="structure-audience"
                  data-testid="input-structure-audience"
                  placeholder="e.g., Beginner content creators"
                  value={structureAudience}
                  onChange={(e) => setStructureAudience(e.target.value)}
                />
              </div>
              <Button
                onClick={() => structureMutation.mutate()}
                disabled={!structureTopic || !structureAudience || structureMutation.isPending}
                className="w-full"
                data-testid="button-optimize-structure"
              >
                {structureMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Optimizing...
                  </>
                ) : (
                  <>
                    <Lightbulb className="w-4 h-4 mr-2" />
                    Generate Structure
                  </>
                )}
              </Button>

              {contentStructure && (
                <div className="mt-6 space-y-4">
                  <div className="border-t pt-4 space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-lg font-semibold">✨ Create Articles from Content Structure</h3>
                      <Button
                        onClick={() => setShowArticleForm(showArticleForm === "structure" ? null : "structure")}
                        variant="default"
                        data-testid="button-toggle-article-form-structure"
                      >
                        <Sparkles className="w-4 h-4 mr-2" />
                        Create Articles
                      </Button>
                    </div>
                    
                    {showArticleForm === "structure" && (
                      <Card>
                        <CardContent className="pt-6 space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="article-target-url-structure">Target URL *</Label>
                            <Input
                              id="article-target-url-structure"
                              data-testid="input-article-target-url-structure"
                              placeholder="https://yoursite.com"
                              value={articleTargetUrl}
                              onChange={(e) => setArticleTargetUrl(e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="article-geographic-focus-structure">Geographic Focus *</Label>
                            <Input
                              id="article-geographic-focus-structure"
                              data-testid="input-article-geographic-focus-structure"
                              placeholder="e.g., Los Angeles, CA or New York City"
                              value={articleGeographicFocus}
                              onChange={(e) => setArticleGeographicFocus(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">Location for local SEO optimization</p>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="article-num-articles-structure">Number of Articles (1-20)</Label>
                            <Input
                              id="article-num-articles-structure"
                              type="number"
                              min={1}
                              max={20}
                              data-testid="input-article-num-articles-structure"
                              value={articleNumArticles}
                              onChange={(e) => setArticleNumArticles(e.target.value)}
                            />
                          </div>
                          <Button
                            onClick={() => createArticlesMutation.mutate({ 
                              seoToolType: "content_structure", 
                              seoToolOutput: contentStructure 
                            })}
                            disabled={!articleTargetUrl || !articleGeographicFocus || createArticlesMutation.isPending}
                            className="w-full"
                            data-testid="button-create-articles-structure"
                          >
                            {createArticlesMutation.isPending ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Generating Titles...
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-4 h-4 mr-2" />
                                Generate Title Pool
                              </>
                            )}
                          </Button>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                  
                  <div className="border-t pt-4">
                    <h3 className="text-lg font-semibold mb-2">📝 Title</h3>
                    <p className="font-medium">{contentStructure.title}</p>
                  </div>

                  <div className="border-t pt-4">
                    <h3 className="text-lg font-semibold mb-3">📋 Content Outline</h3>
                    <div className="space-y-2">
                      {contentStructure.headings?.slice(0, 8).map((heading: any, i: number) => (
                        <div key={i} className="text-sm">
                          <p className="font-medium">{heading.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t pt-4">
                    <h3 className="text-lg font-semibold mb-3">❓ FAQ Section</h3>
                    <div className="space-y-2">
                      {contentStructure.faq_section?.slice(0, 5).map((faq: any, i: number) => (
                        <div key={i} className="p-3 bg-muted rounded-md">
                          <p className="font-medium text-sm mb-1">Q: {faq.question}</p>
                          <p className="text-sm text-muted-foreground">A: {faq.answer}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          )}
        </Card>

        {/* Pillar/Cluster Tool */}
        <Card>
          <CardHeader 
            className="cursor-pointer"
            onClick={() => setExpandedTool(expandedTool === "pillar" ? null : "pillar")}
          >
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Network className="w-5 h-5 text-primary" />
                  Pillar/Cluster Strategy
                </CardTitle>
                <CardDescription>
                  Build comprehensive topical authority with pillar pages and cluster content
                </CardDescription>
              </div>
              {expandedTool === "pillar" ? <ChevronUp /> : <ChevronDown />}
            </div>
          </CardHeader>
          {expandedTool === "pillar" && (
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pillar-topic">Main Topic (Pillar) *</Label>
                  <Input
                    id="pillar-topic"
                    data-testid="input-pillar-topic"
                    placeholder="e.g., Digital Marketing"
                    value={pillarTopic}
                    onChange={(e) => setPillarTopic(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pillar-industry">Industry *</Label>
                  <Input
                    id="pillar-industry"
                    data-testid="input-pillar-industry"
                    placeholder="e.g., SaaS"
                    value={pillarIndustry}
                    onChange={(e) => setPillarIndustry(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pillar-audience">Target Audience *</Label>
                <Input
                  id="pillar-audience"
                  data-testid="input-pillar-audience"
                  placeholder="e.g., Small business owners"
                  value={pillarAudience}
                  onChange={(e) => setPillarAudience(e.target.value)}
                />
              </div>
              <Button
                onClick={() => pillarMutation.mutate()}
                disabled={!pillarTopic || !pillarIndustry || !pillarAudience || pillarMutation.isPending}
                className="w-full"
                data-testid="button-generate-strategy"
              >
                {pillarMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating Strategy...
                  </>
                ) : (
                  <>
                    <Network className="w-4 h-4 mr-2" />
                    Generate Strategy
                  </>
                )}
              </Button>

              {pillarStrategy && (
                <div className="mt-6 space-y-4">
                  <div className="border-t pt-4">
                    <h3 className="text-lg font-semibold mb-3">🏛️ Pillar Page</h3>
                    <div className="p-3 bg-muted rounded-md">
                      <p className="font-bold">{pillarStrategy.pillar_page?.title}</p>
                      <p className="text-sm text-muted-foreground mt-1">{pillarStrategy.pillar_page?.description}</p>
                    </div>
                  </div>

                  <div className="border-t pt-4">
                    <h3 className="text-lg font-semibold mb-3">🔗 Cluster Pages ({pillarStrategy.cluster_pages?.length})</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {pillarStrategy.cluster_pages?.slice(0, 6).map((cluster: any, i: number) => (
                        <div key={i} className="p-3 bg-muted rounded-md">
                          <p className="font-semibold text-sm">{cluster.title}</p>
                          <p className="text-xs text-muted-foreground mt-1">{cluster.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t pt-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-lg font-semibold">✨ Create Articles from This Strategy</h3>
                      <Button
                        onClick={() => setShowArticleForm(showArticleForm === "pillar" ? null : "pillar")}
                        variant="default"
                        data-testid="button-toggle-article-form-pillar"
                      >
                        <Sparkles className="w-4 h-4 mr-2" />
                        Create Articles
                      </Button>
                    </div>

                    {showArticleForm === "pillar" && (
                      <Card>
                        <CardContent className="pt-6 space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="article-target-url-pillar">Target URL *</Label>
                            <Input
                              id="article-target-url-pillar"
                              data-testid="input-article-target-url-pillar"
                              placeholder="https://yoursite.com"
                              value={articleTargetUrl}
                              onChange={(e) => setArticleTargetUrl(e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="article-geo-pillar">Geographic Focus</Label>
                            <Input
                              id="article-geo-pillar"
                              data-testid="input-article-geo-pillar"
                              placeholder="e.g., Austin, TX"
                              value={articleGeographicFocus}
                              onChange={(e) => setArticleGeographicFocus(e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="article-num-articles-pillar">Number of Articles (1–20)</Label>
                            <Input
                              id="article-num-articles-pillar"
                              type="number"
                              min={1}
                              max={20}
                              data-testid="input-article-num-articles-pillar"
                              value={articleNumArticles}
                              onChange={(e) => setArticleNumArticles(e.target.value)}
                            />
                          </div>
                          <Button
                            onClick={() => createArticlesMutation.mutate({
                              seoToolType: "pillar_cluster",
                              seoToolOutput: pillarStrategy,
                            })}
                            disabled={!articleTargetUrl || createArticlesMutation.isPending}
                            className="w-full"
                            data-testid="button-create-articles-pillar"
                          >
                            {createArticlesMutation.isPending ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Generating Titles...
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-4 h-4 mr-2" />
                                Generate Title Pool
                              </>
                            )}
                          </Button>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
