"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronLeft, Sparkles, Users, CheckCircle2, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";

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

  const { data: personasData, isLoading: personasLoading } = useQuery<{ success: boolean; personas: Persona[] }>({
    queryKey: ["/api/personas"],
  });
  const personas = personasData?.personas;

  const { data: intelligenceData } = useQuery<{ profile: { status: string } | null }>({
    queryKey: ["/api/intelligence"],
    queryFn: async () => {
      const res = await fetch("/api/intelligence", { headers: getAuthHeaders() });
      if (!res.ok) return { profile: null };
      return res.json();
    },
  });
  const intelligenceActive = intelligenceData?.profile?.status === "complete";

  const steps = [
    { id: 1, title: "Topic & URL", description: "Define your content topic" },
    { id: 2, title: "Competitor Analysis", description: "Add competitor URLs" },
    { id: 3, title: "SEO Optimization", description: "Configure SEO features" },
    { id: 4, title: "Review & Generate", description: "Review and create" },
  ];

  const handleNext = () => {
    if (step < 4) setStep(step + 1);
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

        <div className="flex items-center justify-center gap-2">
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
                {/* Brand Intelligence awareness banner */}
                {intelligenceActive ? (
                  <div
                    className="flex items-center gap-2 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800/40 rounded-md px-3 py-2 text-sm"
                    data-testid="banner-intelligence-active"
                  >
                    <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                    <span className="text-green-800 dark:text-green-300 font-medium">Brand Intelligence active</span>
                    <span className="text-green-700 dark:text-green-400 text-xs">— brand voice, policy, and competitive gaps will be injected automatically.</span>
                  </div>
                ) : (
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
                  {formData.personaId && (
                    <div>
                      <span className="text-sm font-medium">Target Persona:</span>
                      <p className="text-sm text-muted-foreground">
                        {personas?.find(p => p.publicId === formData.personaId)?.name || formData.personaId}
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

          {step < 4 ? (
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
