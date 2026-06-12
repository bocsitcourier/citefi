"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, ArrowLeft, Upload, X, Image as ImageIcon, FileText, MapPin, Target, Info, Users } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const socialFormSchema = z.object({
  articleId: z.string().optional(),
  standaloneTitle: z.string().optional(),
  topic: z.string().optional(),
  location: z.string().min(1, "Location is required for GEO optimization"),
  platforms: z.array(z.string()).min(1, "Select at least one platform"),
  tone: z.string().min(1, "Select a tone"),
  mood: z.string().min(1, "Select a mood"),
  personaId: z.string().optional(),
  industry: z.string().optional(),
  landingPageUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  userEmail: z.string().email("Must be a valid email").optional().or(z.literal("")),
  companyName: z.string().optional(),
  companyLogoUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  generateImages: z.boolean().default(true),
  includeHeroImage: z.boolean().default(true),
  generateVideos: z.boolean().default(false),
  useArticleKeywords: z.boolean().default(true),
  includeGeoHashtags: z.boolean().default(true),
  generateVariants: z.boolean().default(false),
  includeEmojis: z.boolean().default(true),
  includeCTA: z.boolean().default(true),
  variantsPerPlatform: z.string().default("3"),
}).refine((data) => data.articleId || data.standaloneTitle, {
  message: "Select an article OR enter a standalone title",
  path: ["standaloneTitle"],
}).refine((data) => !data.generateVideos || data.companyName, {
  message: "Company name is required when generating videos",
  path: ["companyName"],
});

type SocialFormValues = z.infer<typeof socialFormSchema>;

interface Article {
  id: number;
  title: string;
  word_count: number | null;
  location: string | null;
  seo_score: number | null;
  article_status: string;
}

interface Persona {
  id: number;
  publicId: string;
  name: string;
  description: string | null;
  preferredTone: string;
  isDefault: number;
}

const PLATFORMS = [
  { id: "twitter", label: "Twitter (X)" },
  { id: "instagram", label: "Instagram" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "facebook", label: "Facebook" },
  { id: "pinterest", label: "Pinterest" },
];

const TONES = ["Friendly", "Formal", "Conversational", "Professional"];
const MOODS = ["Energetic", "Calm", "Urgent", "Inspirational"];
const INDUSTRIES = [
  "Logistics & Delivery",
  "Healthcare",
  "Technology",
  "Finance",
  "Education",
  "Real Estate",
  "Legal Services",
  "Manufacturing",
  "Retail",
  "Hospitality",
  "Other",
];

export default function CreateSocialPostPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
      <CreateSocialPost />
    </Suspense>
  );
}

function CreateSocialPost() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [useStandalone, setUseStandalone] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string>("");
  const [logoUploading, setLogoUploading] = useState(false);
  const hasPreselectedArticle = useRef(false);
  const [authReady, setAuthReady] = useState(false);

  // Check authentication status before fetching articles
  const { data: authData, isLoading: authLoading, isError: authError } = useQuery<{ user: any }>({
    queryKey: ['/api/auth/me'],
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
  
  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && (authError || !authData?.user)) {
      router.push('/login?redirect=/social/create');
    }
  }, [authLoading, authError, authData, router]);
  
  // Set authReady when we have valid auth data
  useEffect(() => {
    if (authData?.user) {
      setAuthReady(true);
    }
  }, [authData]);

  // Fetch completed articles for dropdown - only when authenticated
  const { data: articles, isLoading: articlesLoading } = useQuery<Article[]>({
    queryKey: ["/api/articles/list"],
    enabled: authReady, // Only run when authenticated
  });

  // Fetch audience personas
  const { data: personasData, isLoading: personasLoading } = useQuery<{ success: boolean; personas: Persona[] }>({
    queryKey: ["/api/personas"],
    enabled: authReady,
  });
  const personas = personasData?.personas;

  const form = useForm<SocialFormValues>({
    resolver: zodResolver(socialFormSchema),
    defaultValues: {
      platforms: ["twitter", "instagram", "linkedin"],
      tone: "Friendly",
      mood: "Energetic",
      personaId: "",
      industry: "Logistics & Delivery",
      location: "",
      topic: "",
      landingPageUrl: "",
      userEmail: "",
      companyName: "",
      companyLogoUrl: "",
      generateImages: true,
      includeHeroImage: true,
      generateVideos: false,
      useArticleKeywords: true,
      includeGeoHashtags: true,
      generateVariants: false,
      includeEmojis: true,
      includeCTA: true,
      variantsPerPlatform: "3",
      articleId: "",
      standaloneTitle: "",
    },
  });

  // Pre-select article if articleId is in URL query parameters
  useEffect(() => {
    const articleIdParam = searchParams.get("articleId");
    console.log("Pre-select effect running:", { articleIdParam, hasArticles: !!articles, hasPreselected: hasPreselectedArticle.current });
    
    if (articleIdParam && articles && articles.length > 0 && !hasPreselectedArticle.current) {
      const article = articles.find((a) => a.id.toString() === articleIdParam);
      console.log("Found article for pre-selection:", article);
      
      if (article) {
        // Set the article ID in the form
        form.setValue("articleId", articleIdParam, { shouldValidate: true });
        setUseStandalone(false);
        
        // Pre-fill location if article has location
        if (article.location) {
          form.setValue("location", article.location, { shouldValidate: true });
        }
        
        hasPreselectedArticle.current = true;
        
        // Show toast notification
        setTimeout(() => {
          toast({
            title: "Article selected",
            description: `Pre-selected: ${article.title}`,
          });
        }, 100);
      }
    }
  }, [searchParams, articles]);

  const handleLogoUpload = async (file: File): Promise<string> => {
    setLogoUploading(true);
    try {
      const formData = new FormData();
      formData.append("logo", file);
      
      const authToken = sessionStorage.getItem("auth_token");
      const response = await fetch("/api/upload/logo", {
        method: "POST",
        body: formData,
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      
      if (!response.ok) {
        // Try to parse JSON error, fallback to generic message if HTML returned
        let errorMessage = "Failed to upload logo";
        try {
          const error = await response.json();
          errorMessage = error.error || error.message || errorMessage;
        } catch {
          // Server returned HTML (404 or 500), use status-based message
          errorMessage = `Server error (${response.status}): ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      return data.url;
    } finally {
      setLogoUploading(false);
    }
  };

  const handleLogoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type - explicitly allow only PNG, JPG, JPEG, WebP
    const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    if (!allowedTypes.includes(file.type.toLowerCase())) {
      toast({
        title: "Invalid file type",
        description: "Please select PNG, JPG, or WebP image",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Logo must be less than 5MB",
        variant: "destructive",
      });
      return;
    }

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setLogoPreview(reader.result as string);
    };
    reader.readAsDataURL(file);

    setLogoFile(file);
  };

  const removeLogoFile = () => {
    setLogoFile(null);
    setLogoPreview("");
    form.setValue("companyLogoUrl", "");
  };

  const generateMutation = useMutation({
    mutationFn: async (data: SocialFormValues) => {
      // Upload logo if file is selected
      let logoUrl = data.companyLogoUrl;
      if (logoFile) {
        try {
          logoUrl = await handleLogoUpload(logoFile);
        } catch (error: any) {
          throw new Error(`Logo upload failed: ${error.message}`);
        }
      }

      // Include logo URL in the payload
      const payload = {
        ...data,
        companyLogoUrl: logoUrl,
      };

      const response = await apiRequest("/api/social_posts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return response;
    },
    onSuccess: (data) => {
      toast({
        title: "Social posts queued!",
        description: `Generating posts for ${form.getValues("platforms").length} platforms...`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/social_posts"] });
      router.push("/social/dashboard");
    },
    onError: (error: Error) => {
      toast({
        title: "Generation failed",
        description: error.message || "Failed to queue social posts",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: SocialFormValues) => {
    generateMutation.mutate(data);
  };

  const selectedArticle = articles?.find(
    (a) => a.id.toString() === form.watch("articleId")
  );

  const selectedPlatforms = form.watch("platforms") || [];

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <Link href="/social">
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Social Dashboard
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            Generate Social Posts from Article
          </CardTitle>
          <CardDescription>
            Create platform-optimized social media content with AI-generated images and hashtags
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Article Selection or Standalone Title */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="standalone-mode"
                    checked={useStandalone}
                    onCheckedChange={(checked) => {
                      setUseStandalone(checked as boolean);
                      if (checked) {
                        form.setValue("articleId", "");
                      } else {
                        form.setValue("standaloneTitle", "");
                      }
                    }}
                    data-testid="checkbox-standalone"
                  />
                  <label htmlFor="standalone-mode" className="text-sm font-medium cursor-pointer">
                    Use standalone title (no article)
                  </label>
                </div>

                {/* Alert when no articles available */}
                {!useStandalone && !articlesLoading && !authLoading && authReady && (!articles || articles.length === 0) && (
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertTitle>No Articles Available</AlertTitle>
                    <AlertDescription className="space-y-2">
                      <p>You don't have any completed articles yet. You have two options:</p>
                      <ul className="list-disc list-inside space-y-1 text-sm">
                        <li>
                          <Link href="/batches/new" className="text-primary hover:underline font-medium">
                            Create articles first
                          </Link> to generate social posts from them
                        </li>
                        <li>
                          Check "Use standalone title" above to create social posts without an article
                        </li>
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}

                {!useStandalone ? (
                  <FormField
                    control={form.control}
                    name="articleId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Select Article</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                          disabled={articlesLoading || authLoading || !authReady}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-article">
                              <SelectValue placeholder="Choose an article..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {(articlesLoading || authLoading || !authReady) && (
                              <SelectItem value="loading" disabled>
                                {authLoading || !authReady ? "Checking authentication..." : "Loading articles..."}
                              </SelectItem>
                            )}
                            {articles?.map((article) => (
                              <SelectItem
                                key={article.id}
                                value={article.id.toString()}
                              >
                                {article.title}
                              </SelectItem>
                            ))}
                            {!articlesLoading && !authLoading && authReady && (!articles || articles.length === 0) && (
                              <SelectItem value="none" disabled>
                                No completed articles available
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                        {selectedArticle && (
                          <div className="flex gap-2 mt-2 text-sm text-muted-foreground">
                            <Badge variant="secondary" data-testid="badge-word-count" className="flex items-center gap-1">
                              <FileText className="w-3 h-3" />
                              {selectedArticle.word_count?.toLocaleString() || "N/A"} words
                            </Badge>
                            {selectedArticle.location && (
                              <Badge variant="secondary" data-testid="badge-geo" className="flex items-center gap-1">
                                <MapPin className="w-3 h-3" />
                                {selectedArticle.location}
                              </Badge>
                            )}
                            {selectedArticle.seo_score && (
                              <Badge variant="secondary" data-testid="badge-seo" className="flex items-center gap-1">
                                <Target className="w-3 h-3" />
                                SEO: {selectedArticle.seo_score}/100
                              </Badge>
                            )}
                          </div>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : (
                  <div className="space-y-2">
                    <label className="text-sm font-medium leading-none">Standalone Title</label>
                    <input
                      type="text"
                      placeholder="Enter a title for social post generation..."
                      value={form.watch("standaloneTitle") || ""}
                      onChange={(e) => form.setValue("standaloneTitle", e.target.value)}
                      autoFocus
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      data-testid="input-standalone-title"
                    />
                    <p className="text-sm text-muted-foreground">
                      AI will generate social content based on this title only
                    </p>
                  </div>
                )}
              </div>

              <Separator />

              {/* GEO and Business Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Location <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g., San Francisco, Mission District"
                          {...field}
                          data-testid="input-location"
                        />
                      </FormControl>
                      <FormDescription>
                        Required for GEO-optimized hashtags and local references
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="topic"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Topic (Optional)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g., Fast Delivery Services"
                          {...field}
                          data-testid="input-topic"
                        />
                      </FormControl>
                      <FormDescription>
                        Main theme or focus of the post
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="landingPageUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Landing Page URL (Optional)</FormLabel>
                      <FormControl>
                        <Input
                          type="url"
                          placeholder="https://yourwebsite.com/landing-page"
                          {...field}
                          data-testid="input-landing-page"
                        />
                      </FormControl>
                      <FormDescription>
                        URL for call-to-action hyperlinks in posts
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="userEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Email (Optional)</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="contact@yourcompany.com"
                          {...field}
                          data-testid="input-email"
                        />
                      </FormControl>
                      <FormDescription>
                        For mailto: links in hashtags and CTAs
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="companyName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Company Name {form.watch("generateVideos") && <span className="text-destructive">*</span>}
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Your Company Name"
                          {...field}
                          data-testid="input-company-name"
                        />
                      </FormControl>
                      <FormDescription>
                        {form.watch("generateVideos") 
                          ? "Required for video branding and text overlays"
                          : "Optional: for video branding if enabled"}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormItem>
                  <FormLabel>Company Logo (Optional)</FormLabel>
                  <div className="space-y-3">
                    {!logoPreview && (
                      <div className="flex items-center gap-2">
                        <Input
                          type="file"
                          accept="image/*"
                          onChange={handleLogoSelect}
                          disabled={logoUploading}
                          data-testid="input-logo-upload"
                          className="flex-1"
                        />
                        {logoUploading && <Loader2 className="w-4 h-4 animate-spin" />}
                      </div>
                    )}
                    
                    {logoPreview && (
                      <div className="relative inline-block">
                        <div className="w-32 h-32 border-2 border-dashed border-border rounded-lg overflow-hidden bg-muted flex items-center justify-center">
                          <img 
                            src={logoPreview} 
                            alt="Logo preview" 
                            className="max-w-full max-h-full object-contain"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
                          onClick={removeLogoFile}
                          data-testid="button-remove-logo"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
                    
                    <FormDescription>
                      Upload your company logo for video branding (PNG/JPG, max 5MB, transparent PNG recommended)
                    </FormDescription>
                  </div>
                </FormItem>
              </div>

              <Separator />

              {/* Platform Selection */}
              <FormField
                control={form.control}
                name="platforms"
                render={() => (
                  <FormItem>
                    <FormLabel>Select Platforms (Check all that apply)</FormLabel>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-2">
                      {PLATFORMS.map((platform) => (
                        <FormField
                          key={platform.id}
                          control={form.control}
                          name="platforms"
                          render={({ field }) => (
                            <FormItem key={platform.id}>
                              <FormControl>
                                <div className="flex items-center space-x-2">
                                  <Checkbox
                                    checked={field.value?.includes(platform.id)}
                                    onCheckedChange={(checked) => {
                                      const updated = checked
                                        ? [...(field.value || []), platform.id]
                                        : field.value?.filter((val) => val !== platform.id);
                                      field.onChange(updated);
                                    }}
                                    data-testid={`checkbox-platform-${platform.id}`}
                                  />
                                  <label className="text-sm font-medium cursor-pointer">
                                    {platform.label}
                                  </label>
                                </div>
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Separator />

              {/* Content Style & Tone */}
              <div className="space-y-4">
                <h3 className="font-semibold">Content Style & Tone</h3>
                
                <FormField
                  control={form.control}
                  name="tone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tone</FormLabel>
                      <FormControl>
                        <RadioGroup
                          onValueChange={field.onChange}
                          value={field.value}
                          className="flex flex-wrap gap-4"
                        >
                          {TONES.map((tone) => (
                            <FormItem
                              key={tone}
                              className="flex items-center space-x-2"
                            >
                              <FormControl>
                                <RadioGroupItem
                                  value={tone}
                                  data-testid={`radio-tone-${tone.toLowerCase()}`}
                                />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer">
                                {tone}
                              </FormLabel>
                            </FormItem>
                          ))}
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="mood"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mood</FormLabel>
                      <FormControl>
                        <RadioGroup
                          onValueChange={field.onChange}
                          value={field.value}
                          className="flex flex-wrap gap-4"
                        >
                          {MOODS.map((mood) => (
                            <FormItem
                              key={mood}
                              className="flex items-center space-x-2"
                            >
                              <FormControl>
                                <RadioGroupItem
                                  value={mood}
                                  data-testid={`radio-mood-${mood.toLowerCase()}`}
                                />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer">
                                {mood}
                              </FormLabel>
                            </FormItem>
                          ))}
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="personaId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Users className="w-4 h-4" />
                        Target Audience Persona (Optional)
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-persona">
                            <SelectValue placeholder="Select a persona for targeted content..." />
                          </SelectTrigger>
                        </FormControl>
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
                      <FormDescription>
                        Content will be tailored to match the selected persona's OCEAN traits and preferences
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="industry"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Industry</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-industry">
                            <SelectValue placeholder="Select industry..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {INDUSTRIES.map((industry) => (
                            <SelectItem key={industry} value={industry}>
                              {industry}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Separator />

              {/* Media Generation */}
              <div className="space-y-4">
                <h3 className="font-semibold">Media Generation (AI-Generated Images/Videos)</h3>
                
                <FormField
                  control={form.control}
                  name="generateImages"
                  render={({ field }) => (
                    <FormItem className="flex items-center space-x-2">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="checkbox-generate-images"
                        />
                      </FormControl>
                      <FormLabel className="font-normal cursor-pointer">
                        Generate platform-specific images (Twitter, Instagram, LinkedIn)
                      </FormLabel>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="includeHeroImage"
                  render={({ field }) => (
                    <FormItem className="flex items-center space-x-2">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="checkbox-hero-image"
                        />
                      </FormControl>
                      <FormLabel className="font-normal cursor-pointer">
                        Include article hero image as alternative
                      </FormLabel>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="generateVideos"
                  render={({ field }) => (
                    <FormItem className="flex items-center space-x-2">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="checkbox-generate-videos"
                        />
                      </FormControl>
                      <FormLabel className="font-normal cursor-pointer">
                        Generate short video clips (Instagram Reels, TikTok)
                      </FormLabel>
                    </FormItem>
                  )}
                />
              </div>

              <Separator />

              {/* Advanced Options */}
              <div className="space-y-4">
                <h3 className="font-semibold">Advanced Options</h3>
                
                <FormField
                  control={form.control}
                  name="useArticleKeywords"
                  render={({ field }) => (
                    <FormItem className="flex items-center space-x-2">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="checkbox-article-keywords"
                        />
                      </FormControl>
                      <FormLabel className="font-normal cursor-pointer">
                        Use article keywords for hashtag generation
                      </FormLabel>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="includeGeoHashtags"
                  render={({ field }) => (
                    <FormItem className="flex items-center space-x-2">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="checkbox-geo-hashtags"
                        />
                      </FormControl>
                      <FormLabel className="font-normal cursor-pointer">
                        Include GEO-specific hashtags (location-based)
                      </FormLabel>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="generateVariants"
                  render={({ field }) => (
                    <FormItem className="flex items-center space-x-2">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="checkbox-generate-variants"
                        />
                      </FormControl>
                      <FormLabel className="font-normal cursor-pointer">
                        Generate multiple variants (3-5 per platform)
                      </FormLabel>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="includeEmojis"
                  render={({ field }) => (
                    <FormItem className="flex items-center space-x-2">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="checkbox-emojis"
                        />
                      </FormControl>
                      <FormLabel className="font-normal cursor-pointer">
                        Include emojis (platform-appropriate)
                      </FormLabel>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="includeCTA"
                  render={({ field }) => (
                    <FormItem className="flex items-center space-x-2">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="checkbox-cta"
                        />
                      </FormControl>
                      <FormLabel className="font-normal cursor-pointer">
                        Add call-to-action (Learn More, Shop Now, etc.)
                      </FormLabel>
                    </FormItem>
                  )}
                />

                {form.watch("generateVariants") && (
                  <FormField
                    control={form.control}
                    name="variantsPerPlatform"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Number of variants per platform</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-variants">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="1">1 variant</SelectItem>
                            <SelectItem value="2">2 variants</SelectItem>
                            <SelectItem value="3">3 variants</SelectItem>
                            <SelectItem value="4">4 variants</SelectItem>
                            <SelectItem value="5">5 variants</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              <Separator />

              {/* Submit Button */}
              <div className="flex justify-end gap-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push("/social")}
                  disabled={generateMutation.isPending}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={generateMutation.isPending || selectedPlatforms.length === 0}
                  data-testid="button-generate"
                >
                  {generateMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Generate Social Posts ({selectedPlatforms.length} platforms)
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
