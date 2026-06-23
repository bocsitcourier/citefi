"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles, CheckCircle2, Clock, Network, ChevronDown, ChevronUp, Home, Calendar, Send, Settings } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { GenerationProgress } from "./components/GenerationProgress";
import { Badge } from "@/components/ui/badge";
import { AdvancedOptions } from "./components/AdvancedOptions";
import Link from "next/link";
import { BrandConfirmationModal } from "@/components/BrandConfirmationModal";
import { NotificationBell } from "@/components/NotificationBell";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

interface TitlePoolData {
  titles: string[];
  primaryKeywords: string[];
  contentStrategy: string;
}

interface Batch {
  id: number;
  status: string;
  coreTopic: string;
  targetUrl: string;
  numArticlesRequested: number;
  titlePool: TitlePoolData | null;
  createdAt: string;
}

const TONE_OPTIONS = [
  { value: "professional", label: "Professional" },
  { value: "casual", label: "Casual" },
  { value: "conversational", label: "Conversational" },
  { value: "technical", label: "Technical" },
  { value: "persuasive", label: "Persuasive" },
  { value: "educational", label: "Educational" },
  { value: "entertaining", label: "Entertaining" },
  { value: "authoritative", label: "Authoritative" },
];

export default function Dashboard() {
  const { toast } = useToast();
  const [coreTopic, setCoreTopic] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [numTitles, setNumTitles] = useState(25);
  const [tone, setTone] = useState("professional");
  const [wordCountMin, setWordCountMin] = useState(800);
  const [wordCountMax, setWordCountMax] = useState(2000);
  const [selectedTitles, setSelectedTitles] = useState<Set<string>>(new Set());
  const [currentBatch, setCurrentBatch] = useState<Batch | null>(null);
  const [generatingBatchId, setGeneratingBatchId] = useState<number | null>(null);
  
  // NAP (Name, Address, Phone) Location Data
  const [businessName, setBusinessName] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [companyLogoUrl, setCompanyLogoUrl] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  
  // Brand Confirmation State
  const [showBrandModal, setShowBrandModal] = useState(false);
  const [confirmedBrandName, setConfirmedBrandName] = useState("");

  // Intelligence gate state
  const [showIntelGateDialog, setShowIntelGateDialog] = useState(false);
  
  // Pillar/Cluster Strategy State
  const [showPillarStrategy, setShowPillarStrategy] = useState(false);
  const [pillarTopic, setPillarTopic] = useState("");
  const [pillarIndustry, setPillarIndustry] = useState("");
  const [pillarAudience, setPillarAudience] = useState("");
  const [pillarPages, setPillarPages] = useState("8");
  const [pillarStrategy, setPillarStrategy] = useState<any>(null);
  
  // Advanced SEO Features State
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [competitorUrls, setCompetitorUrls] = useState<string[]>([]);
  const [serpFeatureTarget, setSerpFeatureTarget] = useState("none");
  const [geographicFocus, setGeographicFocus] = useState("");
  const [semanticClusterId, setSemanticClusterId] = useState<number | undefined>();
  const [audience, setAudience] = useState("");

  const generateTitlesMutation = useMutation({
    mutationFn: async (data: { 
      userId: number; 
      coreTopic: string; 
      targetUrl: string; 
      numTitles: number; 
      tone: string;
      competitorUrls?: string[];
      serpFeatureTarget?: string;
      semanticClusterId?: number;
      geographicFocus?: string;
      audience?: string;
      businessName?: string;
      businessAddress?: string;
      businessPhone?: string;
      companyLogoUrl?: string;
    }) => {
      return await apiRequest("/api/jobs/title-pool", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: async (data) => {
      toast({
        title: "Title pool generated!",
        description: `${data.titles.length} SEO-optimized titles ready for selection.`,
      });
      
      const statusData = await apiRequest(`/api/jobs/status/${data.batchId}`);
      setCurrentBatch(statusData);
    },
    onError: (error: Error) => {
      toast({
        title: "Generation failed",
        description: error.message || "Failed to generate titles",
        variant: "destructive",
      });
    },
  });

  const submitBatchMutation = useMutation({
    mutationFn: async (data: { 
      batchId: number; 
      selectedTitles: string[]; 
      targetUrl: string; 
      wordCountMin: number; 
      wordCountMax: number; 
      tone: string;
      competitorUrls?: string[];
      serpFeatureTarget?: string;
      semanticClusterId?: number;
      geographicFocus?: string;
      audience?: string;
      businessName?: string;
      businessAddress?: string;
      businessPhone?: string;
      companyLogoUrl?: string;
      skipIntelGate?: boolean;
    }) => {
      const { skipIntelGate, ...body } = data;
      return await apiRequest("/api/jobs/batch-submit", {
        method: "POST",
        headers: skipIntelGate ? { "X-Skip-Intelligence-Gate": "1" } : {},
        body: JSON.stringify(body),
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Batch submitted!",
        description: `${selectedTitles.size} articles are being generated.`,
      });
      setGeneratingBatchId(data.batchId || currentBatch?.id || null);
      setSelectedTitles(new Set());
      setCurrentBatch(null);
      setCoreTopic("");
      setTargetUrl("");
    },
    onError: (error: Error) => {
      const err = error as any;
      if (err.status === 428 && err.data?.intelligenceGate) {
        setShowIntelGateDialog(true);
        return;
      }
      toast({
        title: "Submission failed",
        description: error.message || "Failed to submit batch",
        variant: "destructive",
      });
    },
  });

  const regenerateTitlesMutation = useMutation({
    mutationFn: async (batchId: number) => {
      return await apiRequest(`/api/batches/${batchId}/regenerate-titles`, {
        method: "POST",
      });
    },
    onSuccess: async (data) => {
      toast({
        title: "Titles regenerated!",
        description: `${data.titles.length} new SEO-optimized titles ready.`,
      });
      const statusData = await apiRequest(`/api/jobs/status/${data.batch.id}`);
      setCurrentBatch(statusData);
      setSelectedTitles(new Set());
    },
    onError: (error: Error) => {
      toast({
        title: "Regeneration failed",
        description: error.message || "Failed to regenerate titles",
        variant: "destructive",
      });
    },
  });

  const pillarStrategyMutation = useMutation({
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

  const handleGenerateTitles = async () => {
    if (!coreTopic || !targetUrl) {
      toast({
        title: "Missing information",
        description: "Please provide both core topic and target URL.",
        variant: "destructive",
      });
      return;
    }

    if (!geographicFocus) {
      toast({
        title: "Location required",
        description: "Geographic focus is required for local SEO-optimized titles. Please specify a location (city, region, or area).",
        variant: "destructive",
      });
      return;
    }

    if (uploadingLogo) {
      toast({
        title: "Upload in progress",
        description: "Please wait for the logo upload to finish before generating titles.",
        variant: "destructive",
      });
      return;
    }

    // Logo URL is validated at upload time — no need to re-verify here

    if (businessName && businessName.trim().length > 0 && confirmedBrandName !== businessName) {
      setShowBrandModal(true);
      return;
    }

    proceedWithGeneration();
  };

  const proceedWithGeneration = (overrideBrandName?: string) => {
    const finalBrandName = overrideBrandName 
      ? overrideBrandName
      : (businessName && businessName.trim().length > 0 
          ? (confirmedBrandName || businessName) 
          : undefined);
    
    generateTitlesMutation.mutate({
      userId: 1,
      coreTopic,
      targetUrl,
      numTitles,
      tone,
      competitorUrls: competitorUrls.length > 0 ? competitorUrls : undefined,
      serpFeatureTarget: serpFeatureTarget !== "none" ? serpFeatureTarget : undefined,
      semanticClusterId,
      geographicFocus,
      audience: audience || undefined,
      businessName: finalBrandName,
      businessAddress: businessAddress || undefined,
      businessPhone: businessPhone || undefined,
      companyLogoUrl: companyLogoUrl || undefined,
    });
  };

  const handleBrandConfirm = (confirmedName: string) => {
    setConfirmedBrandName(confirmedName);
    setBusinessName(confirmedName);
    setShowBrandModal(false);
    proceedWithGeneration(confirmedName);
  };

  const handleBusinessNameChange = (newName: string) => {
    setBusinessName(newName);
    if (newName.trim().length === 0 || newName !== confirmedBrandName) {
      setConfirmedBrandName("");
    }
  };

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file",
        description: "Please upload an image file (PNG, JPG, etc.)",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Logo must be under 5MB",
        variant: "destructive",
      });
      return;
    }

    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('logo', file);

      const token = sessionStorage.getItem("auth_token");
      const response = await fetch('/api/upload/logo', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'Upload failed');
      }

      setCompanyLogoUrl(data.url);
      
      toast({
        title: "Logo uploaded",
        description: "Your company logo has been uploaded successfully",
      });
    } catch (error) {
      console.error('Logo upload error:', error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload logo. Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSubmitBatch = () => {
    if (!currentBatch || selectedTitles.size === 0) {
      toast({
        title: "No titles selected",
        description: "Please select at least one title to generate.",
        variant: "destructive",
      });
      return;
    }

    submitBatchMutation.mutate({
      batchId: currentBatch.id,
      selectedTitles: Array.from(selectedTitles),
      targetUrl: currentBatch.targetUrl,
      wordCountMin,
      wordCountMax,
      tone,
      competitorUrls: competitorUrls.length > 0 ? competitorUrls : undefined,
      serpFeatureTarget: serpFeatureTarget !== "none" ? serpFeatureTarget : undefined,
      semanticClusterId,
      geographicFocus: geographicFocus || undefined,
      audience: audience || undefined,
      businessName: businessName || undefined,
      businessAddress: businessAddress || undefined,
      businessPhone: businessPhone || undefined,
      companyLogoUrl: companyLogoUrl || undefined,
    });
  };

  const toggleTitle = (title: string) => {
    const newSelected = new Set(selectedTitles);
    if (newSelected.has(title)) {
      newSelected.delete(title);
    } else {
      newSelected.add(title);
    }
    setSelectedTitles(newSelected);
  };

  const handleUsePillarPage = (title: string, description: string, targetKeywords: string[]) => {
    setCoreTopic(`${title} - ${description}`);
    setShowPillarStrategy(false);
    toast({
      title: "Pillar Page Selected",
      description: "Generate titles for this pillar page",
    });
  };

  const handleUseClusterPage = (title: string, description: string, targetKeywords: string[]) => {
    setCoreTopic(`${title} - ${description}`);
    setShowPillarStrategy(false);
    toast({
      title: "Cluster Page Selected",
      description: "Generate titles for this cluster page",
    });
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2" data-testid="text-page-title">Citefi</h1>
            <p className="text-muted-foreground" data-testid="text-page-description">
              Generate SEO-optimized content with dual-AI orchestration
            </p>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <Link href="/settings/schedules">
              <Button variant="outline" data-testid="button-schedules">
                <Calendar className="w-4 h-4 mr-2" />
                Schedules
              </Button>
            </Link>
            <Link href="/settings/publishing">
              <Button variant="outline" data-testid="button-publishing">
                <Send className="w-4 h-4 mr-2" />
                Publishing
              </Button>
            </Link>
            <Link href="/home">
              <Button variant="default" className="bg-primary hover:bg-primary/90" data-testid="button-home">
                <Home className="w-4 h-4 mr-2" />
                Home
              </Button>
            </Link>
          </div>
        </div>

        <Card>
          <CardHeader 
            className="cursor-pointer"
            onClick={() => setShowPillarStrategy(!showPillarStrategy)}
          >
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Network className="w-5 h-5 text-primary" />
                  Step 1: SEO Strategy Planner (Optional)
                </CardTitle>
                <CardDescription>
                  Create pillar-cluster content strategies. Use cluster IDs in Step 2 below for semantic linking between articles.
                </CardDescription>
              </div>
              {showPillarStrategy ? <ChevronUp /> : <ChevronDown />}
            </div>
          </CardHeader>
          {showPillarStrategy && (
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pillar-topic">Main Topic *</Label>
                  <Input
                    id="pillar-topic"
                    data-testid="input-pillar-topic"
                    placeholder="e.g., Last-Mile Delivery Solutions"
                    value={pillarTopic}
                    onChange={(e) => setPillarTopic(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pillar-industry">Industry *</Label>
                  <Input
                    id="pillar-industry"
                    data-testid="input-pillar-industry"
                    placeholder="e.g., Courier Services"
                    value={pillarIndustry}
                    onChange={(e) => setPillarIndustry(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pillar-audience">Target Audience *</Label>
                  <Input
                    id="pillar-audience"
                    data-testid="input-pillar-audience"
                    placeholder="e.g., Business owners in Massachusetts"
                    value={pillarAudience}
                    onChange={(e) => setPillarAudience(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pillar-pages">Number of Cluster Pages</Label>
                  <Input
                    id="pillar-pages"
                    type="number"
                    min={3}
                    max={20}
                    data-testid="input-pillar-pages"
                    value={pillarPages}
                    onChange={(e) => setPillarPages(e.target.value)}
                  />
                </div>
              </div>
              <Button
                onClick={() => pillarStrategyMutation.mutate()}
                disabled={!pillarTopic || !pillarIndustry || !pillarAudience || pillarStrategyMutation.isPending}
                className="w-full"
                data-testid="button-generate-strategy"
              >
                {pillarStrategyMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating Strategy...
                  </>
                ) : (
                  <>
                    <Network className="w-4 h-4 mr-2" />
                    Generate Content Strategy
                  </>
                )}
              </Button>

              {pillarStrategy && (
                <div className="mt-6 space-y-6">
                  <div className="border-t pt-4">
                    <h3 className="text-lg font-semibold mb-3">🎯 Pillar Page</h3>
                    <Card className="hover-elevate">
                      <CardHeader>
                        <CardTitle className="text-base">{pillarStrategy.pillar_page?.title}</CardTitle>
                        <CardDescription>{pillarStrategy.pillar_page?.description}</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div>
                          <p className="text-sm font-medium mb-2">Target Keywords:</p>
                          <div className="flex flex-wrap gap-2">
                            {pillarStrategy.pillar_page?.target_keywords?.map((kw: string, i: number) => (
                              <Badge key={i} variant="default">{kw}</Badge>
                            ))}
                          </div>
                        </div>
                        <Button
                          onClick={() => handleUsePillarPage(
                            pillarStrategy.pillar_page.title,
                            pillarStrategy.pillar_page.description,
                            pillarStrategy.pillar_page.target_keywords
                          )}
                          className="w-full"
                          data-testid="button-use-pillar"
                        >
                          Use This Pillar Page
                        </Button>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="border-t pt-4">
                    <h3 className="text-lg font-semibold mb-3">📚 Cluster Pages</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {pillarStrategy.cluster_pages?.map((cluster: any, i: number) => (
                        <Card key={i} className="hover-elevate">
                          <CardHeader>
                            <CardTitle className="text-sm">{cluster.title}</CardTitle>
                            <CardDescription className="text-xs">{cluster.description}</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div>
                              <p className="text-xs font-medium mb-2">Keywords:</p>
                              <div className="flex flex-wrap gap-1">
                                {cluster.target_keywords?.slice(0, 3).map((kw: string, j: number) => (
                                  <Badge key={j} variant="secondary" className="text-xs">{kw}</Badge>
                                ))}
                              </div>
                            </div>
                            <Button
                              onClick={() => handleUseClusterPage(
                                cluster.title,
                                cluster.description,
                                cluster.target_keywords
                              )}
                              size="sm"
                              className="w-full"
                              data-testid={`button-use-cluster-${i}`}
                            >
                              Use This Cluster
                            </Button>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              Step 2: Article Generation with Advanced SEO
            </CardTitle>
            <CardDescription>
              Generate SEO-optimized content with competitor analysis, SERP targeting, geo-optimization, and semantic clustering. All features below are integrated into each article.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="coreTopic">Core Topic</Label>
                <Input
                  id="coreTopic"
                  data-testid="input-core-topic"
                  placeholder="e.g., Email Marketing Best Practices"
                  value={coreTopic}
                  onChange={(e) => setCoreTopic(e.target.value)}
                  disabled={generateTitlesMutation.isPending || currentBatch !== null}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="targetUrl">Target URL</Label>
                <Input
                  id="targetUrl"
                  data-testid="input-target-url"
                  placeholder="https://example.com"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  disabled={generateTitlesMutation.isPending || currentBatch !== null}
                />
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                📍 NAP Local SEO Data (Optional)
              </h3>
              <p className="text-xs text-muted-foreground mb-4">
                Provide business location details to optimize articles for local search and geo-targeting
              </p>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="businessName">Business Name</Label>
                  <Input
                    id="businessName"
                    data-testid="input-business-name"
                    placeholder="e.g., Acme Marketing Inc."
                    value={businessName}
                    onChange={(e) => handleBusinessNameChange(e.target.value)}
                    disabled={generateTitlesMutation.isPending || currentBatch !== null}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="businessAddress">Business Address</Label>
                  <Input
                    id="businessAddress"
                    data-testid="input-business-address"
                    placeholder="e.g., 123 Main St, Boston, MA 02101"
                    value={businessAddress}
                    onChange={(e) => setBusinessAddress(e.target.value)}
                    disabled={generateTitlesMutation.isPending || currentBatch !== null}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="businessPhone">Business Phone</Label>
                  <Input
                    id="businessPhone"
                    data-testid="input-business-phone"
                    placeholder="e.g., (555) 123-4567"
                    value={businessPhone}
                    onChange={(e) => setBusinessPhone(e.target.value)}
                    disabled={generateTitlesMutation.isPending || currentBatch !== null}
                  />
                </div>
              </div>
              
              <div className="mt-4 space-y-2">
                <Label htmlFor="companyLogo">Company Logo (for AI-generated images)</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Upload your logo so AI can reference it when generating branded images with your company uniforms and branding
                </p>
                <div className="flex items-center gap-4">
                  <Input
                    id="companyLogo"
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    disabled={uploadingLogo || generateTitlesMutation.isPending || currentBatch !== null}
                    data-testid="input-company-logo"
                    className="max-w-md"
                  />
                  {uploadingLogo && (
                    <span className="text-sm text-muted-foreground">Uploading...</span>
                  )}
                  {companyLogoUrl && !uploadingLogo && (
                    <div className="flex items-center gap-2">
                      <img src={companyLogoUrl} alt="Company logo preview" className="h-8 w-8 object-contain rounded border" />
                      <span className="text-sm text-green-600">✓ Uploaded</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="numTitles">Number of Titles (5-100)</Label>
                <Input
                  id="numTitles"
                  type="number"
                  min={5}
                  max={100}
                  data-testid="input-num-titles"
                  value={numTitles}
                  onChange={(e) => setNumTitles(parseInt(e.target.value) || 25)}
                  disabled={generateTitlesMutation.isPending || currentBatch !== null}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tone">Tone</Label>
                <select
                  id="tone"
                  data-testid="select-tone"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  disabled={generateTitlesMutation.isPending || currentBatch !== null}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {TONE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Article Length</Label>
                <div className="text-sm text-muted-foreground">
                  {wordCountMin} - {wordCountMax} words
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="wordCountMin">Min Words (500-5000)</Label>
                <Input
                  id="wordCountMin"
                  type="number"
                  min={500}
                  max={5000}
                  data-testid="input-word-count-min"
                  value={wordCountMin}
                  onChange={(e) => setWordCountMin(parseInt(e.target.value) || 800)}
                  disabled={generateTitlesMutation.isPending || currentBatch !== null}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wordCountMax">Max Words (500-5000)</Label>
                <Input
                  id="wordCountMax"
                  type="number"
                  min={500}
                  max={5000}
                  data-testid="input-word-count-max"
                  value={wordCountMax}
                  onChange={(e) => setWordCountMax(parseInt(e.target.value) || 2000)}
                  disabled={generateTitlesMutation.isPending || currentBatch !== null}
                />
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Network className="w-5 h-5 text-primary" />
                Advanced SEO Features
              </h3>
              <AdvancedOptions
                competitorUrls={competitorUrls}
                setCompetitorUrls={setCompetitorUrls}
                serpFeatureTarget={serpFeatureTarget}
                setSerpFeatureTarget={setSerpFeatureTarget}
                geographicFocus={geographicFocus}
                setGeographicFocus={setGeographicFocus}
                semanticClusterId={semanticClusterId}
                setSemanticClusterId={setSemanticClusterId}
              />
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                onClick={handleGenerateTitles}
                disabled={generateTitlesMutation.isPending || currentBatch !== null || uploadingLogo}
                className="flex-1"
                data-testid="button-generate-titles"
              >
                {generateTitlesMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                <Sparkles className="w-4 h-4 mr-2" />
                Generate Title Pool with Advanced SEO
              </Button>
            </div>
          </CardContent>
        </Card>

        {currentBatch && currentBatch.titlePool && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    Select Titles to Generate ({selectedTitles.size} selected)
                  </CardTitle>
                  <CardDescription>
                    Choose which articles you want to generate from the title pool
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCurrentBatch(null);
                      setSelectedTitles(new Set());
                    }}
                    data-testid="button-cancel-batch"
                  >
                    Cancel & Edit
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => currentBatch && regenerateTitlesMutation.mutate(currentBatch.id)}
                    disabled={regenerateTitlesMutation.isPending}
                    data-testid="button-regenerate-titles"
                  >
                    {regenerateTitlesMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Regenerate Titles
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="max-h-96 overflow-y-auto space-y-2">
                {currentBatch.titlePool.titles.map((title, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-3 p-3 rounded-lg border hover-elevate"
                    data-testid={`title-item-${index}`}
                  >
                    <Checkbox
                      id={`title-${index}`}
                      checked={selectedTitles.has(title)}
                      onCheckedChange={() => toggleTitle(title)}
                      data-testid={`checkbox-title-${index}`}
                    />
                    <label
                      htmlFor={`title-${index}`}
                      className="text-sm cursor-pointer flex-1"
                    >
                      {title}
                    </label>
                  </div>
                ))}
              </div>
              <Button
                onClick={handleSubmitBatch}
                disabled={selectedTitles.size === 0 || submitBatchMutation.isPending}
                className="w-full"
                data-testid="button-submit-batch"
              >
                {submitBatchMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Generate {selectedTitles.size} Articles
              </Button>
            </CardContent>
          </Card>
        )}

        {generatingBatchId && (
          <GenerationProgress
            batchId={generatingBatchId}
            onComplete={() => {
              toast({
                title: "Generation complete!",
                description: "Your articles are ready to view.",
              });
            }}
          />
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              Recent Batches
            </CardTitle>
            <CardDescription>
              Track your content generation jobs
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Batch tracking coming soon. Use the job status API to monitor progress.
            </p>
          </CardContent>
        </Card>
      </div>

      <BrandConfirmationModal
        open={showBrandModal}
        onOpenChange={setShowBrandModal}
        initialBrandName={businessName}
        onConfirm={handleBrandConfirm}
        title="Confirm Company Name for Content Generation"
        description="Please verify the exact spelling of your company name. This will be used across all generated articles, podcasts, and videos. The spelling cannot be changed after generation starts."
      />

      {/* Intelligence Gate Dialog */}
      <Dialog open={showIntelGateDialog} onOpenChange={setShowIntelGateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set up Brand Intelligence first?</DialogTitle>
            <DialogDescription>
              Brand Intelligence researches your brand, competitors, and customer pain points so every article is on-brand and strategically targeted. This is a one-time setup that takes a few minutes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => {
                setShowIntelGateDialog(false);
                if (submitBatchMutation.variables) {
                  submitBatchMutation.mutate({ ...submitBatchMutation.variables, skipIntelGate: true });
                }
              }}
            >
              Skip for now
            </Button>
            <Link href="/intelligence">
              <Button>
                <Sparkles className="w-4 h-4 mr-2" />
                Set up Brand Intelligence
              </Button>
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
