"use client";

import { use, Suspense, useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, CheckSquare, ArrowLeft, Send, Upload, X, Users, Coins, AlertTriangle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

interface TitlePoolData {
  titles: string[];
  primaryKeywords?: string[];
  contentStrategy?: string;
}

interface BatchData {
  batch: {
    id: number;
    userId: number;
    coreTopic: string;
    targetUrl: string;
    status: string;
    numArticlesRequested: number;
    titlePoolJson: TitlePoolData | null;
    createdAt: string;
    businessName: string | null;
    businessAddress: string | null;
    businessPhone: string | null;
    companyLogoUrl: string | null;
  };
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

function SelectTitlesContent({ paramsPromise }: { paramsPromise: Promise<{ id: string }> }) {
  const resolvedParams = use(paramsPromise);
  const batchId = parseInt(resolvedParams.id);
  const router = useRouter();
  const { toast } = useToast();

  const [selectedTitles, setSelectedTitles] = useState<Set<string>>(new Set());
  const [tone, setTone] = useState("professional");
  const [wordCountMin, setWordCountMin] = useState(800);
  const [wordCountMax, setWordCountMax] = useState(2000);
  const [selectAll, setSelectAll] = useState(false);
  
  // Business information (NAP data) - businessName is REQUIRED
  const [businessName, setBusinessName] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [companyLogoUrl, setCompanyLogoUrl] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);

  // Psychographic targeting
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>("");

  // Auto-publish settings
  const [autoPublishEnabled, setAutoPublishEnabled] = useState(false);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<Set<number>>(new Set());

  // Intelligence gate state
  const [showIntelGateDialog, setShowIntelGateDialog] = useState(false);

  interface Persona {
    id: number;
    publicId: string;
    name: string;
    description: string | null;
    preferredTone: string;
    isDefault: number;
  }

  const { data, isLoading, error } = useQuery<BatchData>({
    queryKey: [`/api/batches/${batchId}`],
  });

  // Pre-populate business info from the batch (collected during title generation)
  useEffect(() => {
    if (!data?.batch) return;
    const b = data.batch;
    if (b.businessName) setBusinessName(b.businessName);
    if (b.businessAddress) setBusinessAddress(b.businessAddress);
    if (b.businessPhone) setBusinessPhone(b.businessPhone);
    if (b.companyLogoUrl) setCompanyLogoUrl(b.companyLogoUrl);
  }, [data?.batch?.id]);

  const { data: personasData, isLoading: personasLoading } = useQuery<{ success: boolean; personas: Persona[] }>({
    queryKey: ["/api/personas"],
  });
  const personas = personasData?.personas;

  interface PublishingConnection {
    id: number;
    name: string;
    channel: string;
    status: string;
  }

  const { data: connectionsData } = useQuery<{ success: boolean; data: PublishingConnection[] }>({
    queryKey: ["/api/publishing/connections"],
    enabled: autoPublishEnabled,
  });

  interface CreditPreview {
    totalCost: number;
    unitCost: number;
    totalRemaining: number;
    sufficient: boolean;
    insufficientBy: number;
  }
  const { data: creditPreview } = useQuery<CreditPreview>({
    queryKey: [`/api/billing/preview?operationType=article&quantity=${selectedTitles.size}`],
    enabled: selectedTitles.size > 0,
  });

  const submitBatchMutation = useMutation({
    mutationFn: async (submitData: {
      batchId: number;
      selectedTitles: string[];
      targetUrl: string;
      wordCountMin: number;
      wordCountMax: number;
      tone: string;
      businessName: string;
      businessAddress?: string;
      businessPhone?: string;
      companyLogoUrl?: string;
      autoPublishEnabled?: boolean;
      autoPublishConnectionIds?: number[];
      personaId?: number;
      skipIntelGate?: boolean;
    }) => {
      const { skipIntelGate, ...body } = submitData;
      return await apiRequest("/api/jobs/batch-submit", {
        method: "POST",
        headers: skipIntelGate ? { "X-Skip-Intelligence-Gate": "1" } : {},
        body: JSON.stringify(body),
      });
    },
    onSuccess: (responseData: any) => {
      toast({
        title: "Batch submitted!",
        description: `${selectedTitles.size} articles are being generated.`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/batches/${batchId}`] });
      router.push(`/batches/${batchId}`);
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

  const toggleTitle = (title: string) => {
    const newSelected = new Set(selectedTitles);
    if (newSelected.has(title)) {
      newSelected.delete(title);
    } else {
      newSelected.add(title);
    }
    setSelectedTitles(newSelected);
  };

  const handleSelectAll = () => {
    if (!data?.batch.titlePoolJson?.titles) return;

    if (selectAll) {
      setSelectedTitles(new Set());
      setSelectAll(false);
    } else {
      setSelectedTitles(new Set(data.batch.titlePoolJson.titles));
      setSelectAll(true);
    }
  };

  const handleSubmitBatch = () => {
    if (!data || selectedTitles.size === 0) {
      toast({
        title: "No titles selected",
        description: "Please select at least one title to generate.",
        variant: "destructive",
      });
      return;
    }

    if (!businessName || businessName.trim().length === 0) {
      toast({
        title: "Business name required",
        description: "Please enter your business name to ensure brand consistency in generated content.",
        variant: "destructive",
      });
      return;
    }

    if (wordCountMin > wordCountMax) {
      toast({
        title: "Invalid word count",
        description: "Minimum word count must be less than or equal to maximum word count",
        variant: "destructive",
      });
      return;
    }

    submitBatchMutation.mutate({
      batchId,
      selectedTitles: Array.from(selectedTitles),
      targetUrl: data.batch.targetUrl,
      wordCountMin,
      wordCountMax,
      tone,
      businessName: businessName.trim(),
      businessAddress: businessAddress.trim() || undefined,
      businessPhone: businessPhone.trim() || undefined,
      companyLogoUrl: companyLogoUrl.trim() || undefined,
      autoPublishEnabled: autoPublishEnabled && selectedConnectionIds.size > 0,
      autoPublishConnectionIds: autoPublishEnabled ? Array.from(selectedConnectionIds) : undefined,
      personaId: selectedPersonaId && selectedPersonaId !== "none" 
        ? personas?.find(p => p.publicId === selectedPersonaId)?.id 
        : undefined,
    });
  };

  const toggleConnection = (connectionId: number) => {
    const newSelected = new Set(selectedConnectionIds);
    if (newSelected.has(connectionId)) {
      newSelected.delete(connectionId);
    } else {
      newSelected.add(connectionId);
    }
    setSelectedConnectionIds(newSelected);
  };

  const activeConnections = connectionsData?.data?.filter(c => c.status === "active") || [];

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card>
          <CardHeader>
            <CardTitle>Batch not found</CardTitle>
            <CardDescription>The requested batch could not be loaded.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const { batch } = data;

  if (batch.status !== "PENDING") {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Batch Already Submitted</CardTitle>
            <CardDescription>
              This batch has already been submitted and is currently {batch.status.toLowerCase()}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href={`/batches/${batchId}`}>
              <Button data-testid="button-view-batch">
                <ArrowLeft className="w-4 h-4 mr-2" />
                View Batch Status
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!batch.titlePoolJson || !batch.titlePoolJson.titles || batch.titlePoolJson.titles.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>No Title Pool Available</CardTitle>
            <CardDescription>
              This batch does not have any generated titles to select from.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard">
              <Button data-testid="button-go-dashboard">
                <Sparkles className="w-4 h-4 mr-2" />
                Generate New Title Pool
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const titlePool = batch.titlePoolJson;

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Link href={`/batches/${batchId}`}>
                <Button variant="outline" size="sm" data-testid="button-back">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
              </Link>
              <Badge data-testid="badge-batch-status">{batch.status}</Badge>
            </div>
            <h1 className="text-3xl font-bold mb-2" data-testid="text-batch-title">{batch.coreTopic}</h1>
            <p className="text-muted-foreground" data-testid="text-batch-url">{batch.targetUrl}</p>
          </div>
        </div>

        {titlePool.contentStrategy && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Content Strategy</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{titlePool.contentStrategy}</p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckSquare className="w-5 h-5 text-primary" />
              Select Titles to Generate ({selectedTitles.size} of {titlePool.titles.length} selected)
            </CardTitle>
            <CardDescription>
              Choose which articles you want to generate from the title pool
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAll}
                data-testid="button-select-all"
              >
                {selectAll ? "Deselect All" : "Select All"}
              </Button>
            </div>

            <div className="max-h-96 overflow-y-auto space-y-2 border rounded-lg p-4">
              {titlePool.titles.map((title, index) => (
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Generation Settings</CardTitle>
            <CardDescription>
              Configure business information, article tone and length before generating
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4 border-b pb-4">
              <h3 className="text-sm font-semibold">Business Information (Required for Brand Consistency)</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="businessName">Business Name *</Label>
                  <Input
                    id="businessName"
                    data-testid="input-business-name"
                    placeholder="e.g., Acme Corporation"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">Required to prevent AI hallucination in content</p>
                </div>
                <div className="space-y-2">
                  <Label>Company Logo (Optional)</Label>
                  {companyLogoUrl ? (
                    <div className="flex items-center gap-2 p-2 border rounded-md bg-muted/50">
                      <img 
                        src={companyLogoUrl} 
                        alt="Logo preview" 
                        className="h-8 w-8 object-contain rounded"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                      <span className="text-sm truncate flex-1" data-testid="text-logo-filename">
                        {companyLogoUrl.split('/').pop()}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setCompanyLogoUrl("")}
                        data-testid="button-remove-logo"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="flex-1"
                          disabled={logoUploading}
                          onClick={() => {
                            const input = document.createElement('input');
                            input.type = 'file';
                            input.accept = 'image/png,image/jpeg,image/webp';
                            input.onchange = async (e) => {
                              const file = (e.target as HTMLInputElement).files?.[0];
                              if (!file) return;
                              setLogoUploading(true);
                              try {
                                const formData = new FormData();
                                formData.append('logo', file);
                                const token = sessionStorage.getItem("auth_token");
                                const res = await fetch('/api/upload/logo', {
                                  method: 'POST',
                                  headers: token ? { Authorization: `Bearer ${token}` } : {},
                                  body: formData,
                                });
                                const data = await res.json();
                                if (data.success && data.url) {
                                  setCompanyLogoUrl(data.url);
                                  toast({
                                    title: "Logo uploaded",
                                    description: "Your company logo has been uploaded.",
                                  });
                                } else {
                                  toast({
                                    title: "Upload failed",
                                    description: data.error || "Failed to upload logo",
                                    variant: "destructive",
                                  });
                                }
                              } catch {
                                toast({
                                  title: "Upload failed",
                                  description: "Network error uploading logo",
                                  variant: "destructive",
                                });
                              } finally {
                                setLogoUploading(false);
                              }
                            };
                            input.click();
                          }}
                          data-testid="button-upload-logo"
                        >
                          {logoUploading ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Upload className="w-4 h-4 mr-2" />
                          )}
                          {logoUploading ? "Uploading..." : "Upload Logo"}
                        </Button>
                      </div>
                      <div className="relative">
                        <Input
                          id="companyLogoUrl"
                          data-testid="input-logo-url"
                          placeholder="Or paste a URL: https://example.com/logo.png"
                          value={companyLogoUrl}
                          onChange={(e) => setCompanyLogoUrl(e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="businessAddress">Business Address (Optional)</Label>
                  <Input
                    id="businessAddress"
                    data-testid="input-business-address"
                    placeholder="123 Main St, City, State ZIP"
                    value={businessAddress}
                    onChange={(e) => setBusinessAddress(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="businessPhone">Business Phone (Optional)</Label>
                  <Input
                    id="businessPhone"
                    data-testid="input-business-phone"
                    placeholder="(555) 123-4567"
                    value={businessPhone}
                    onChange={(e) => setBusinessPhone(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="tone">Tone</Label>
                <select
                  id="tone"
                  data-testid="select-tone"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
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
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                Target Audience Persona (Optional)
              </Label>
              <Select
                value={selectedPersonaId}
                onValueChange={(value: string) => setSelectedPersonaId(value)}
              >
                <SelectTrigger data-testid="select-persona">
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
                Articles will be tailored to match the selected persona's personality traits and messaging style
              </p>
            </div>

            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="auto-publish" className="flex items-center gap-2">
                    <Send className="w-4 h-4" />
                    Auto-Publish When Complete
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Automatically publish articles to selected destinations when generation finishes
                  </p>
                </div>
                <Switch
                  id="auto-publish"
                  checked={autoPublishEnabled}
                  onCheckedChange={setAutoPublishEnabled}
                  data-testid="switch-auto-publish"
                />
              </div>

              {autoPublishEnabled && (
                <div className="space-y-2 pl-6 border-l-2 border-primary/20">
                  <Label className="text-sm">Select Publishing Destinations</Label>
                  {activeConnections.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No active publishing connections. <Link href="/settings/publishing" className="text-primary underline">Set up connections</Link> first.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {activeConnections.map((connection) => (
                        <div
                          key={connection.id}
                          className="flex items-center gap-3 p-2 rounded border"
                          data-testid={`connection-item-${connection.id}`}
                        >
                          <Checkbox
                            id={`connection-${connection.id}`}
                            checked={selectedConnectionIds.has(connection.id)}
                            onCheckedChange={() => toggleConnection(connection.id)}
                            data-testid={`checkbox-connection-${connection.id}`}
                          />
                          <label htmlFor={`connection-${connection.id}`} className="flex-1 cursor-pointer">
                            <span className="text-sm font-medium">{connection.name}</span>
                            <Badge variant="outline" className="ml-2 text-xs">{connection.channel}</Badge>
                          </label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {selectedTitles.size > 0 && creditPreview && (
              <div
                className={`flex items-center gap-2 p-3 rounded-md text-sm border ${
                  creditPreview.sufficient
                    ? "bg-muted/40 border-border text-muted-foreground"
                    : "bg-destructive/10 border-destructive/30 text-destructive"
                }`}
                data-testid="text-credit-estimate"
              >
                {creditPreview.sufficient ? (
                  <Coins className="w-4 h-4 flex-shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                )}
                <span>
                  {creditPreview.sufficient
                    ? `${creditPreview.totalCost} credits · ${creditPreview.totalRemaining} remaining`
                    : `Need ${creditPreview.totalCost} credits — ${creditPreview.totalRemaining} available (${creditPreview.insufficientBy} short)`}
                </span>
                {!creditPreview.sufficient && (
                  <a
                    href="/client/billing"
                    className="ml-auto text-xs underline whitespace-nowrap"
                    data-testid="link-top-up-credits"
                  >
                    Top up
                  </a>
                )}
              </div>
            )}

            <Button
              onClick={handleSubmitBatch}
              disabled={selectedTitles.size === 0 || submitBatchMutation.isPending || creditPreview?.sufficient === false}
              className="w-full"
              size="lg"
              data-testid="button-submit-batch"
            >
              {submitBatchMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Sparkles className="w-4 h-4 mr-2" />
              Generate {selectedTitles.size} Articles
              {autoPublishEnabled && selectedConnectionIds.size > 0 && (
                <span className="ml-1">& Auto-Publish</span>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

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

export default function SelectTitlesPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      }
    >
      <SelectTitlesContent paramsPromise={params} />
    </Suspense>
  );
}
