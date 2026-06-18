"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronLeft, Sparkles, Users, CheckCircle2, ArrowRight, Loader2, FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";

interface Persona {
  id: number;
  publicId: string;
  name: string;
  description: string | null;
  preferredTone: string;
  isDefault: number;
}

function getAuthHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? sessionStorage.getItem("auth_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function ContentWizard() {
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    coreTopic: "",
    targetUrl: "",
    competitorUrls: [] as string[],
    geographicFocus: "",
    serpFeatureTarget: "none",
    semanticClusterId: undefined as number | undefined,
    tone: "professional",
    personaId: "",
    numTitles: 25,
  });

  // Exemplar capture state (step 4)
  const [exemplarText, setExemplarText] = useState("");
  const [exemplarSaved, setExemplarSaved] = useState(false);

  // Brand setup state (shown in review step for teams without intelligence)
  const [brandWebsite, setBrandWebsite] = useState("");
  const [brandCompany, setBrandCompany] = useState("");
  const [brandResearchStarted, setBrandResearchStarted] = useState(false);

  const { data: personasData, isLoading: personasLoading } = useQuery<{ success: boolean; personas: Persona[] }>({
    queryKey: ["/api/personas"],
  });
  const personas = personasData?.personas;

  const { data: intelligenceData, refetch: refetchIntelligence } = useQuery<{ profile: { status: string } | null }>({
    queryKey: ["/api/intelligence"],
    queryFn: async () => {
      const res = await fetch("/api/intelligence", { headers: getAuthHeaders() });
      if (!res.ok) return { profile: null };
      return res.json();
    },
  });
  const intelligenceActive = intelligenceData?.profile?.status === "complete";

  // Save a single exemplar to brand profile
  const saveExemplarMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch("/api/intelligence", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          action: "add_exemplar",
          exemplar: {
            contentType: "article",
            text: text.trim(),
            source: "wizard",
            humanApproved: true,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to save exemplar");
      return data as { success: boolean; action: "created" | "appended"; total: number };
    },
    onSuccess: (data) => {
      setExemplarSaved(true);
      toast({
        title: data.action === "created" ? "Style reference saved" : `Style reference updated (${data.total} total)`,
        description: "The AI will use this as a writing style reference for every content batch.",
      });
    },
    onError: () => {
      toast({ title: "Could not save exemplar", description: "You can add examples later from the Brand Intelligence page.", variant: "destructive" });
    },
  });

  // Auto-trigger intelligence research for non-agency teams
  const startIntelligenceMutation = useMutation({
    mutationFn: async ({ websiteUrl, companyName }: { websiteUrl: string; companyName: string }) => {
      const res = await fetch("/api/intelligence/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ websiteUrl, companyName }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to start research");
      }
      return res.json();
    },
    onSuccess: () => {
      setBrandResearchStarted(true);
      refetchIntelligence();
      toast({
        title: "Brand Intelligence research started",
        description: "Research runs in the background. Your first batch will be brand-aware once it completes.",
      });
    },
    onError: (err: any) => {
      toast({ title: "Could not start research", description: err.message, variant: "destructive" });
    },
  });

  const TOTAL_STEPS = 5;

  const steps = [
    { id: 1, title: "Topic & URL", description: "Define your content topic" },
    { id: 2, title: "Competitor Analysis", description: "Add competitor URLs" },
    { id: 3, title: "SEO Optimization", description: "Configure SEO features" },
    { id: 4, title: "Content Examples", description: "Add seed exemplars for style guidance" },
    { id: 5, title: "Review & Generate", description: "Review and create" },
  ];

  const handleNext = () => {
    if (step < TOTAL_STEPS) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleGenerate = () => {
    sessionStorage.setItem("wizardData", JSON.stringify(formData));
    router.push("/dashboard");
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold" data-testid="text-wizard-title">
            Guided Content Creation
          </h1>
          <p className="text-muted-foreground">
            Step-by-step wizard for creating SEO-optimized content
          </p>
        </div>

        <div className="flex items-center justify-center gap-2 flex-wrap">
          {steps.map((s, idx) => (
            <div key={s.id} className="flex items-center">
              <div
                className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
                  step >= s.id ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
              >
                <div className="w-6 h-6 rounded-full bg-background text-foreground flex items-center justify-center text-sm font-bold">
                  {s.id}
                </div>
                <span className="text-sm font-medium hidden md:inline">{s.title}</span>
              </div>
              {idx < steps.length - 1 && (
                <ChevronRight className="w-5 h-5 mx-2 text-muted-foreground" />
              )}
            </div>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{steps[step - 1]!.title}</CardTitle>
            <CardDescription>{steps[step - 1]!.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {step === 1 && (
              <>
                <div className="space-y-2">
                  <Label>Core Topic *</Label>
                  <Input
                    placeholder="e.g., Best CRM Software for Small Businesses"
                    value={formData.coreTopic}
                    onChange={(e) => setFormData({ ...formData, coreTopic: e.target.value })}
                    data-testid="input-core-topic"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Target URL *</Label>
                  <Input
                    placeholder="https://yoursite.com/target-page"
                    value={formData.targetUrl}
                    onChange={(e) => setFormData({ ...formData, targetUrl: e.target.value })}
                    data-testid="input-target-url"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Number of Titles</Label>
                  <Input
                    type="number"
                    min={5}
                    max={100}
                    value={formData.numTitles}
                    onChange={(e) => setFormData({ ...formData, numTitles: parseInt(e.target.value) })}
                    data-testid="input-num-titles"
                  />
                </div>
              </>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Add up to 5 competitor URLs to analyze their content strategy (optional)
                </p>
                {[0, 1, 2, 3, 4].map((idx) => (
                  <div key={idx} className="space-y-2">
                    <Label>Competitor URL {idx + 1}</Label>
                    <Input
                      placeholder={`https://competitor${idx + 1}.com/article`}
                      value={formData.competitorUrls[idx] || ""}
                      onChange={(e) => {
                        const newUrls = [...formData.competitorUrls];
                        if (e.target.value) {
                          newUrls[idx] = e.target.value;
                        } else {
                          newUrls.splice(idx, 1);
                        }
                        setFormData({ ...formData, competitorUrls: newUrls.filter(Boolean) });
                      }}
                      data-testid={`input-competitor-${idx}`}
                    />
                  </div>
                ))}
              </div>
            )}

            {step === 3 && (
              <>
                <div className="space-y-2">
                  <Label>SERP Feature Target</Label>
                  <Select
                    value={formData.serpFeatureTarget}
                    onValueChange={(value: string) => setFormData({ ...formData, serpFeatureTarget: value })}
                  >
                    <SelectTrigger data-testid="select-serp-feature-wizard">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="Featured Snippet">Featured Snippet</SelectItem>
                      <SelectItem value="PAA">People Also Ask</SelectItem>
                      <SelectItem value="List">List/Carousel</SelectItem>
                      <SelectItem value="Q&A">Q&A Schema</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Geographic Focus *</Label>
                  <Input
                    placeholder="e.g., Boston, Massachusetts or Seattle, Washington"
                    value={formData.geographicFocus}
                    onChange={(e) => setFormData({ ...formData, geographicFocus: e.target.value })}
                    data-testid="input-geo-focus-wizard"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    REQUIRED: All titles will include this location for local SEO.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Content Tone</Label>
                  <Select
                    value={formData.tone}
                    onValueChange={(value: string) => setFormData({ ...formData, tone: value })}
                  >
                    <SelectTrigger data-testid="select-tone-wizard">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="professional">Professional</SelectItem>
                      <SelectItem value="casual">Casual</SelectItem>
                      <SelectItem value="technical">Technical</SelectItem>
                      <SelectItem value="persuasive">Persuasive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Target Audience Persona (Optional)
                  </Label>
                  <Select
                    value={formData.personaId}
                    onValueChange={(value: string) => setFormData({ ...formData, personaId: value })}
                  >
                    <SelectTrigger data-testid="select-persona-wizard">
                      <SelectValue placeholder="Select a persona for targeted content..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No persona - General audience</SelectItem>
                      {personasLoading && (
                        <SelectItem value="loading" disabled>Loading personas...</SelectItem>
                      )}
                      {personas?.map((persona) => (
                        <SelectItem key={persona.publicId} value={persona.publicId}>
                          <div className="flex items-center gap-2">
                            {persona.name}
                            {persona.isDefault === 1 && (
                              <Badge variant="secondary" className="text-xs">Default</Badge>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Articles will be tailored to match the selected persona's OCEAN traits
                  </p>
                </div>
              </>
            )}

            {step === 4 && (
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-3 bg-muted rounded-md">
                  <FileText className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium">Paste a high-performing content example</p>
                    <p className="text-muted-foreground mt-0.5">
                      This teaches the AI your preferred writing style, depth, and structure. Paste 200–2000 words from your best-performing article, social post, or email.
                    </p>
                  </div>
                </div>

                {exemplarSaved ? (
                  <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800/40 rounded-md px-3 py-2" data-testid="banner-exemplar-saved">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    Example saved — the AI will use this as a style reference.
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="exemplar-text">Your best-performing content (optional)</Label>
                      <Textarea
                        id="exemplar-text"
                        placeholder="Paste your best-performing article, blog post, or social content here…"
                        value={exemplarText}
                        onChange={(e) => setExemplarText(e.target.value)}
                        className="min-h-[180px] text-sm"
                        data-testid="textarea-exemplar"
                      />
                      <p className="text-xs text-muted-foreground">
                        {exemplarText.length} characters
                        {exemplarText.length > 0 && exemplarText.length < 100 && " — try to paste at least 100 characters"}
                      </p>
                    </div>

                    {exemplarText.trim().length >= 100 && (
                      <Button
                        variant="outline"
                        onClick={() => saveExemplarMutation.mutate(exemplarText)}
                        disabled={saveExemplarMutation.isPending}
                        data-testid="button-save-exemplar"
                      >
                        {saveExemplarMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                        )}
                        Save as Style Reference
                      </Button>
                    )}
                  </>
                )}

                <p className="text-xs text-muted-foreground">
                  You can skip this step and add examples later from the Brand Intelligence page.
                </p>
              </div>
            )}

            {step === 5 && (
              <div className="space-y-4">
                {/* Brand Intelligence setup for non-agency teams (auto-trigger) */}
                {!intelligenceActive && !brandResearchStarted && (
                  <div className="border rounded-md p-4 space-y-3" data-testid="card-brand-setup">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary" />
                      <p className="font-medium text-sm">Set up Brand Intelligence (recommended)</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Enter your website URL and company name to auto-research your brand voice, competitors, and content gaps. Research runs in the background — your first batch will use it once complete.
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Website URL</Label>
                        <Input
                          placeholder="https://yourcompany.com"
                          value={brandWebsite}
                          onChange={(e) => setBrandWebsite(e.target.value)}
                          className="h-8 text-sm"
                          data-testid="input-brand-website-wizard"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Company Name</Label>
                        <Input
                          placeholder="Acme Corp"
                          value={brandCompany}
                          onChange={(e) => setBrandCompany(e.target.value)}
                          className="h-8 text-sm"
                          data-testid="input-brand-company-wizard"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => startIntelligenceMutation.mutate({ websiteUrl: brandWebsite, companyName: brandCompany })}
                        disabled={!brandWebsite.trim() || !brandCompany.trim() || startIntelligenceMutation.isPending}
                        data-testid="button-start-intelligence-wizard"
                      >
                        {startIntelligenceMutation.isPending ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <Sparkles className="w-3 h-3 mr-1" />
                        )}
                        Start Research
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setBrandResearchStarted(true)}
                        data-testid="button-skip-brand-setup"
                      >
                        Skip for now
                      </Button>
                    </div>
                  </div>
                )}

                {(intelligenceActive || brandResearchStarted) && (
                  <div
                    className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                      intelligenceActive
                        ? "bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800/40"
                        : "bg-primary/5 border border-primary/10"
                    }`}
                    data-testid="banner-intelligence-active"
                  >
                    {intelligenceActive ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                        <span className="text-green-800 dark:text-green-300 font-medium">Brand Intelligence active</span>
                        <span className="text-green-700 dark:text-green-400 text-xs">— brand voice, policy, and competitive gaps will be injected automatically.</span>
                      </>
                    ) : (
                      <>
                        <Loader2 className="w-4 h-4 text-primary shrink-0 animate-spin" />
                        <span className="font-medium">Brand Intelligence research running</span>
                        <span className="text-muted-foreground text-xs">— your first batch will use it once complete.</span>
                      </>
                    )}
                  </div>
                )}

                {!intelligenceActive && !brandResearchStarted && (
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 bg-primary/5 border border-primary/10 rounded-md px-3 py-2 text-sm"
                    data-testid="banner-intelligence-setup"
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary shrink-0" />
                      <span className="font-medium">Brand Intelligence not set up</span>
                      <span className="text-muted-foreground text-xs hidden sm:inline">— set it up to inject brand voice into every article.</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => router.push("/intelligence")}
                      data-testid="button-setup-intelligence-wizard"
                    >
                      Set up
                      <ArrowRight className="w-3 h-3 ml-1" />
                    </Button>
                  </div>
                )}

                <h3 className="font-semibold">Review Your Configuration</h3>
                <div className="grid gap-3 p-4 bg-muted rounded-lg">
                  <div>
                    <span className="text-sm font-medium">Topic:</span>
                    <p className="text-sm text-muted-foreground">{formData.coreTopic}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium">Competitor URLs:</span>
                    <p className="text-sm text-muted-foreground">
                      {formData.competitorUrls.length} URL(s)
                    </p>
                  </div>
                  <div>
                    <span className="text-sm font-medium">SERP Target:</span>
                    <Badge>{formData.serpFeatureTarget}</Badge>
                  </div>
                  {formData.geographicFocus && (
                    <div>
                      <span className="text-sm font-medium">Geographic Focus:</span>
                      <p className="text-sm text-muted-foreground">{formData.geographicFocus}</p>
                    </div>
                  )}
                  {formData.personaId && formData.personaId !== "none" && (
                    <div>
                      <span className="text-sm font-medium">Target Persona:</span>
                      <p className="text-sm text-muted-foreground">
                        {personas?.find(p => p.publicId === formData.personaId)?.name || formData.personaId}
                      </p>
                    </div>
                  )}
                  {exemplarSaved && (
                    <div>
                      <span className="text-sm font-medium">Style Reference:</span>
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-green-600" />
                        1 exemplar saved
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={step === 1}
            data-testid="button-back"
          >
            <ChevronLeft className="w-4 h-4 mr-2" />
            Back
          </Button>

          {step < TOTAL_STEPS ? (
            <Button onClick={handleNext} data-testid="button-next">
              Next
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button onClick={handleGenerate} data-testid="button-generate">
              <Sparkles className="w-4 h-4 mr-2" />
              Generate Content
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
