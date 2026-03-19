"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { 
  Loader2, 
  Brain, 
  TrendingUp, 
  Zap, 
  FileText, 
  Video, 
  MessageSquare, 
  Mic, 
  Image,
  RefreshCw,
  Sparkles,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Progress } from "@/components/ui/progress";

interface LearnedPattern {
  id: number;
  patternType: string;
  patternName: string;
  patternValue: string;
  successRate: number;
  confidence: number;
}

interface LearningAgent {
  id: number;
  name: string;
  contentType: string;
  totalGenerations: number;
  successfulGenerations: number;
  averageQualityScore: number;
  patternCount: number;
  topPatterns: LearnedPattern[];
}

const CONTENT_TYPE_ICONS: Record<string, any> = {
  article: FileText,
  video: Video,
  social: MessageSquare,
  podcast: Mic,
  image: Image,
};

const CONTENT_TYPE_COLORS: Record<string, string> = {
  article: "bg-blue-500",
  video: "bg-purple-500",
  social: "bg-pink-500",
  podcast: "bg-orange-500",
  image: "bg-green-500",
};

export default function LearningDashboard() {
  const { toast } = useToast();
  const [expandedAgent, setExpandedAgent] = useState<number | null>(null);

  const { data: agentsData, isLoading, refetch } = useQuery<{ success: boolean; agents: LearningAgent[] }>({
    queryKey: ["/api/learning/agents"],
  });

  const optimizeMutation = useMutation({
    mutationFn: async (agentId: number) => {
      return apiRequest(`/api/learning/agents/${agentId}/optimize`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      toast({ title: "Agent optimized", description: "Learning patterns have been updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/learning/agents"] });
    },
    onError: (error: any) => {
      toast({ title: "Optimization failed", description: error.message, variant: "destructive" });
    },
  });

  const seedMutation = useMutation({
    mutationFn: async ({ agentId, contentType }: { agentId: number; contentType: string }) => {
      return apiRequest(`/api/learning/agents/${agentId}/seed`, {
        method: "POST",
        body: JSON.stringify({ contentType }),
      });
    },
    onSuccess: () => {
      toast({ title: "Patterns seeded", description: "Default learning patterns have been added" });
      queryClient.invalidateQueries({ queryKey: ["/api/learning/agents"] });
    },
    onError: (error: any) => {
      toast({ title: "Seeding failed", description: error.message, variant: "destructive" });
    },
  });

  const agents = agentsData?.agents || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Brain className="w-6 h-6" />
            AI Learning Center
          </h1>
          <p className="text-muted-foreground mt-1">
            Your AI agents learn what works and improve over time
          </p>
        </div>
        <Button 
          variant="outline" 
          onClick={() => refetch()}
          data-testid="button-refresh"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-primary/10">
                <Zap className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-total-agents">{agents.length}</p>
                <p className="text-sm text-muted-foreground">Active Agents</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-green-500/10">
                <TrendingUp className="w-6 h-6 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-total-patterns">
                  {agents.reduce((sum, a) => sum + a.patternCount, 0)}
                </p>
                <p className="text-sm text-muted-foreground">Learned Patterns</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-blue-500/10">
                <Sparkles className="w-6 h-6 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-total-generations">
                  {agents.reduce((sum, a) => sum + a.totalGenerations, 0)}
                </p>
                <p className="text-sm text-muted-foreground">Total Generations</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Specialized Learning Agents</h2>
        
        {agents.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <Brain className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No learning agents yet. Generate some content to start learning!</p>
            </CardContent>
          </Card>
        ) : (
          agents.map((agent) => {
            const Icon = CONTENT_TYPE_ICONS[agent.contentType] || Brain;
            const colorClass = CONTENT_TYPE_COLORS[agent.contentType] || "bg-gray-500";
            const isExpanded = expandedAgent === agent.id;
            const successRate = agent.totalGenerations > 0 
              ? Math.round((agent.successfulGenerations / agent.totalGenerations) * 100) 
              : 0;

            return (
              <Card key={agent.id} data-testid={`card-agent-${agent.contentType}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${colorClass} text-white`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{agent.name}</CardTitle>
                        <CardDescription>
                          {agent.patternCount} patterns learned • {agent.totalGenerations} generations
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={successRate >= 70 ? "default" : "secondary"}>
                        {successRate}% success
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                        data-testid={`button-expand-${agent.contentType}`}
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-muted-foreground">Quality Score</span>
                          <span className="font-medium">{agent.averageQualityScore}%</span>
                        </div>
                        <Progress value={agent.averageQualityScore} className="h-2" />
                      </div>
                      
                      <div className="flex gap-2">
                        {agent.patternCount === 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => seedMutation.mutate({ agentId: agent.id, contentType: agent.contentType })}
                            disabled={seedMutation.isPending}
                            data-testid={`button-seed-${agent.contentType}`}
                          >
                            {seedMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <>
                                <Sparkles className="w-4 h-4 mr-1" />
                                Seed Patterns
                              </>
                            )}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => optimizeMutation.mutate(agent.id)}
                          disabled={optimizeMutation.isPending}
                          data-testid={`button-optimize-${agent.contentType}`}
                        >
                          {optimizeMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              <RefreshCw className="w-4 h-4 mr-1" />
                              Optimize
                            </>
                          )}
                        </Button>
                      </div>
                    </div>

                    {isExpanded && agent.topPatterns.length > 0 && (
                      <div className="pt-4 border-t space-y-3">
                        <h4 className="text-sm font-medium">Top Performing Patterns</h4>
                        {agent.topPatterns.map((pattern) => (
                          <div 
                            key={pattern.id} 
                            className="p-3 rounded-lg bg-muted/50"
                            data-testid={`pattern-${pattern.id}`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium">{pattern.patternName}</span>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-xs">
                                  {pattern.patternType}
                                </Badge>
                                <Badge 
                                  variant={pattern.successRate >= 70 ? "default" : "secondary"}
                                  className="text-xs"
                                >
                                  {pattern.successRate}% success
                                </Badge>
                              </div>
                            </div>
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {pattern.patternValue}
                            </p>
                            <div className="flex items-center gap-2 mt-2">
                              <span className="text-xs text-muted-foreground">
                                Confidence: {pattern.confidence}%
                              </span>
                              <Progress value={pattern.confidence} className="h-1 flex-1" />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {isExpanded && agent.topPatterns.length === 0 && (
                      <div className="pt-4 border-t text-center text-muted-foreground py-4">
                        <p className="text-sm">No patterns learned yet. Click "Seed Patterns" to add default patterns.</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            How Learning Works
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-muted/30">
              <h4 className="font-medium text-foreground mb-2">1. Generate Content</h4>
              <p>Each time you generate articles, videos, or social posts, the system uses learned patterns to optimize the output.</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/30">
              <h4 className="font-medium text-foreground mb-2">2. Track Performance</h4>
              <p>When content performs well (engagement, shares, quality scores), the patterns used get a success boost.</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/30">
              <h4 className="font-medium text-foreground mb-2">3. Continuous Improvement</h4>
              <p>Patterns with high success rates are prioritized in future generations, making your content better over time.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
