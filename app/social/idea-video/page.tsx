"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, Sparkles, ArrowLeft, Video, Play, Download, RefreshCw, Film, Wand2, X, Upload, Trash2, Share2, Clock, Lightbulb, Pencil, Mic, Layers, Check, CheckCircle2, Users, Heart } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PublishDialog } from "@/components/PublishDialog";
import { OptimizedVideo } from "@/components/OptimizedVideo";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { NotificationBell } from "@/components/NotificationBell";

const videoIdeaSchema = z.object({
  ideaTitle: z.string().min(1, "Title is required").max(255),
  shortIdea: z.string().min(10, "Please provide more detail about your idea (at least 10 characters)").max(2000),
  companyName: z.string().min(1, "Company name is required").max(255),
  targetAudience: z.string().max(255).optional(),
  personaId: z.string().optional(),
  website: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  callToAction: z.string().min(1, "Call to action is required").max(255),
  companyLogoUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  style: z.enum(["cinematic", "comedy", "emotional", "tech", "minimal", "retro", "luxury", "action"]),
  tone: z.enum(["professional", "playful", "inspirational", "urgent", "mysterious", "friendly"]),
});

interface Persona {
  id: number;
  publicId: string;
  name: string;
  description: string | null;
  preferredTone: string;
  isDefault: number;
}

type VideoIdeaFormValues = z.infer<typeof videoIdeaSchema>;

const STYLES = [
  { id: "cinematic", name: "Cinematic", icon: "🎬", description: "Epic, dramatic, film-quality visuals" },
  { id: "comedy", name: "Comedy", icon: "😂", description: "Light-hearted, humorous, unexpected twists" },
  { id: "emotional", name: "Emotional", icon: "❤️", description: "Heartfelt, personal stories with empathy" },
  { id: "tech", name: "Tech", icon: "🚀", description: "Futuristic, clean, innovative aesthetics" },
  { id: "minimal", name: "Minimal", icon: "⚪", description: "Simple, elegant, focused composition" },
  { id: "retro", name: "Retro", icon: "🕹️", description: "Nostalgic, vintage-inspired visuals" },
  { id: "luxury", name: "Luxury", icon: "💎", description: "Premium, sophisticated, refined textures" },
  { id: "action", name: "Action", icon: "💥", description: "High-energy, dynamic, fast-paced" },
];

const TONES = [
  { id: "professional", name: "Professional", description: "Authoritative, trustworthy, polished" },
  { id: "playful", name: "Playful", description: "Fun, energetic, approachable" },
  { id: "inspirational", name: "Inspirational", description: "Uplifting, motivating, empowering" },
  { id: "urgent", name: "Urgent", description: "Time-sensitive, compelling, action-driving" },
  { id: "mysterious", name: "Mysterious", description: "Intriguing, curious, building anticipation" },
  { id: "friendly", name: "Friendly", description: "Warm, welcoming, conversational" },
];

interface VideoIdea {
  id: number;
  publicId: string;
  ideaTitle: string;
  shortIdea: string;
  companyName: string;
  style: string;
  tone: string;
  status: string;
  progress: number;
  currentStage: string;
  videoUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
  generatedAt: string | null;
}

export default function IdeaToVideoPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [selectedIdea, setSelectedIdea] = useState<VideoIdea | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string>("");
  const [logoUploading, setLogoUploading] = useState(false);
  const [mode, setMode] = useState<"create" | "like">("create");
  const [likeVideoUrl, setLikeVideoUrl] = useState("");
  const [likeTitle, setLikeTitle] = useState("");
  const [likeIdea, setLikeIdea] = useState("");
  const [likeCompanyName, setLikeCompanyName] = useState("");
  const [likeWebsite, setLikeWebsite] = useState("");
  const [likeCta, setLikeCta] = useState("Get Started Today!");
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [analyzingVideo, setAnalyzingVideo] = useState(false);
  const [likeVideoIdeaId, setLikeVideoIdeaId] = useState<number | null>(null);

  const { data: authData, isLoading: authLoading, isError: authError } = useQuery<{ user: any }>({
    queryKey: ['/api/auth/me'],
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const { data: myVideos, isLoading: videosLoading, refetch: refetchVideos } = useQuery<{ ideas: VideoIdea[] }>({
    queryKey: ['/api/social/video/idea'],
    enabled: !!authData?.user,
  });

  const { data: personasData, isLoading: personasLoading } = useQuery<{ success: boolean; personas: Persona[] }>({
    queryKey: ["/api/personas"],
    enabled: !!authData?.user,
  });
  const personas = personasData?.personas;

  useEffect(() => {
    if (!authLoading && (authError || !authData?.user)) {
      router.push('/login?redirect=/social/idea-video');
    }
  }, [authLoading, authError, authData, router]);

  const hasAutoSelected = useRef(false);
  
  useEffect(() => {
    if (!myVideos?.ideas || hasAutoSelected.current) return;
    
    const inProgressIdeas = myVideos.ideas
      .filter(idea => idea.status !== "DRAFT" && idea.status !== "READY" && idea.status !== "FAILED")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    if (inProgressIdeas.length > 0) {
      const mostRecent = inProgressIdeas[0]!;
      console.log(`🎬 Auto-selecting in-progress video: "${mostRecent.ideaTitle}" (${mostRecent.status})`);
      setSelectedIdea(mostRecent);
      setIsPolling(true);
      hasAutoSelected.current = true;
    }
  }, [myVideos]);

  const form = useForm<VideoIdeaFormValues>({
    resolver: zodResolver(videoIdeaSchema),
    defaultValues: {
      ideaTitle: "",
      shortIdea: "",
      companyName: "",
      targetAudience: "",
      personaId: "",
      website: "",
      callToAction: "Get Started Today!",
      companyLogoUrl: "",
      style: "cinematic",
      tone: "professional",
    },
  });

  const handleLogoUpload = async (file: File): Promise<string> => {
    setLogoUploading(true);
    try {
      const formData = new FormData();
      formData.append("logo", file);
      
      const authToken = localStorage.getItem("auth_token");
      const response = await fetch("/api/upload/logo", {
        method: "POST",
        body: formData,
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      
      if (!response.ok) {
        let errorMessage = "Failed to upload logo";
        try {
          const error = await response.json();
          errorMessage = error.error || error.message || errorMessage;
        } catch {
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

    const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    if (!allowedTypes.includes(file.type.toLowerCase())) {
      toast({
        title: "Invalid file type",
        description: "Please select PNG, JPG, or WebP image",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Logo must be less than 5MB",
        variant: "destructive",
      });
      return;
    }

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

  const createMutation = useMutation({
    mutationFn: async (data: VideoIdeaFormValues) => {
      let logoUrl = data.companyLogoUrl;
      if (logoFile) {
        try {
          logoUrl = await handleLogoUpload(logoFile);
        } catch (error: any) {
          throw new Error(`Logo upload failed: ${error.message}`);
        }
      }

      const payload = {
        ...data,
        companyLogoUrl: logoUrl,
      };

      return await apiRequest("/api/social/video/idea", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (data) => {
      toast({ title: "Video idea created!", description: "Starting video generation..." });
      setSelectedIdea(data.videoIdea);
      startGenerationMutation.mutate(data.videoIdea.id);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create video idea", variant: "destructive" });
    },
  });

  const startGenerationMutation = useMutation({
    mutationFn: async (ideaId: number) => {
      return await apiRequest(`/api/social/video/idea/${ideaId}/generate`, {
        method: "POST",
      });
    },
    onSuccess: (data) => {
      toast({ title: "Generation started!", description: "This will take 60-80 minutes for premium AI video." });
      setIsPolling(true);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to start generation", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (ideaId: number) => {
      return await apiRequest(`/api/social/video/idea/${ideaId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      toast({ title: "Video deleted", description: "The video has been removed." });
      queryClient.invalidateQueries({ queryKey: ['/api/social/video/idea'] });
      if (selectedIdea) {
        setSelectedIdea(null);
      }
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete video", variant: "destructive" });
    },
  });

  const createLikeVideoMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("/api/social/video/like", {
        method: "POST",
        body: JSON.stringify({
          referenceVideoUrl: likeVideoUrl,
          ideaTitle: likeTitle,
          shortIdea: likeIdea,
          companyName: likeCompanyName,
          website: likeWebsite || undefined,
          callToAction: likeCta,
        }),
      });
    },
    onSuccess: (data) => {
      setLikeVideoIdeaId(data.videoIdea.id);
      toast({ title: "Video created!", description: "Now analyzing reference video style..." });
      analyzeMutation.mutate(data.videoIdea.id);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create like video", variant: "destructive" });
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: async (ideaId: number) => {
      setAnalyzingVideo(true);
      return await apiRequest(`/api/social/video/like/${ideaId}/analyze`, {
        method: "POST",
      });
    },
    onSuccess: (data) => {
      setAnalysisResult(data.analysis);
      setAnalyzingVideo(false);
      toast({ title: "Analysis Complete!", description: `Style detected: ${data.analysis.mood}. Ready to generate.` });
    },
    onError: (error: any) => {
      setAnalyzingVideo(false);
      toast({ title: "Analysis Failed", description: error.message || "Failed to analyze reference video", variant: "destructive" });
    },
  });

  const generateLikeVideoMutation = useMutation({
    mutationFn: async (ideaId: number) => {
      return await apiRequest(`/api/social/video/like/${ideaId}/generate`, {
        method: "POST",
      });
    },
    onSuccess: (data) => {
      toast({ title: "Generation started!", description: "Your Like Video is being generated with the analyzed style." });
      if (likeVideoIdeaId) {
        const fakeIdea: VideoIdea = {
          id: likeVideoIdeaId,
          publicId: "",
          ideaTitle: likeTitle,
          shortIdea: likeIdea,
          companyName: likeCompanyName,
          style: analysisResult?.mood || "cinematic",
          tone: "professional",
          status: "EXPANDING",
          progress: 0,
          currentStage: "queued",
          videoUrl: null,
          errorMessage: null,
          createdAt: new Date().toISOString(),
          generatedAt: null,
        };
        setSelectedIdea(fakeIdea);
        setIsPolling(true);
      }
      queryClient.invalidateQueries({ queryKey: ['/api/social/video/idea'] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to start generation", variant: "destructive" });
    },
  });

  const isVideoInProgress = selectedIdea && 
    selectedIdea.status !== "DRAFT" && 
    selectedIdea.status !== "READY" && 
    selectedIdea.status !== "FAILED" &&
    selectedIdea.status !== "ANALYZED";

  const { data: ideaStatus } = useQuery<{ idea: VideoIdea }>({
    queryKey: [`/api/social/video/idea/${selectedIdea?.id}`],
    enabled: !!selectedIdea?.id && (isPolling || !!isVideoInProgress),
    refetchInterval: (isPolling || isVideoInProgress) ? 5000 : false,
  });

  useEffect(() => {
    if (ideaStatus?.idea) {
      setSelectedIdea(ideaStatus.idea);
      if (ideaStatus.idea.status === "READY" || ideaStatus.idea.status === "FAILED") {
        setIsPolling(false);
        queryClient.invalidateQueries({ queryKey: ['/api/social/video/idea'] });
        if (ideaStatus.idea.status === "READY") {
          toast({ title: "Video Ready!", description: "Your 60-second video has been generated." });
        } else if (ideaStatus.idea.status === "FAILED") {
          toast({ title: "Generation Failed", description: ideaStatus.idea.errorMessage || "Unknown error", variant: "destructive" });
        }
      }
    }
  }, [ideaStatus, toast]);

  const onSubmit = (data: VideoIdeaFormValues) => {
    createMutation.mutate(data);
  };

  const GENERATION_STAGES = [
    { id: "queued", label: "Queued", icon: "clock", progressRange: [0, 5] },
    { id: "analyze_reference", label: "Analyzing Style", icon: "film", progressRange: [0, 20] },
    { id: "expand_idea", label: "Expanding Concept", icon: "lightbulb", progressRange: [5, 15] },
    { id: "generate_script", label: "Writing Script", icon: "pencil", progressRange: [15, 30] },
    { id: "tts", label: "Creating Voiceover", icon: "mic", progressRange: [30, 50] },
    { id: "generate_clips", label: "Generating AI Clips", icon: "film", progressRange: [50, 90] },
    { id: "stitch_video", label: "Stitching Video", icon: "layers", progressRange: [90, 99] },
    { id: "complete", label: "Complete", icon: "check", progressRange: [99, 100] },
  ];

  const getStageLabel = (stage: string | null) => {
    const found = GENERATION_STAGES.find(s => s.id === stage);
    return found?.label || stage || "Processing";
  };

  const getCurrentStageIndex = (stage: string | null) => {
    const idx = GENERATION_STAGES.findIndex(s => s.id === stage);
    return idx >= 0 ? idx : 0;
  };

  const getEstimatedTimeRemaining = (progress: number) => {
    const remaining = 100 - progress;
    const minutesPerPercent = 0.7;
    const minutes = Math.ceil(remaining * minutesPerPercent);
    if (minutes > 60) {
      const hrs = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return `~${hrs}h ${mins}m remaining`;
    }
    return `~${minutes}m remaining`;
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/social">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Wand2 className="h-6 w-6 text-primary" />
              Idea to Video
            </h1>
            <p className="text-muted-foreground">Transform your brief idea into a 60-second AI-generated video</p>
          </div>
        </div>
        <NotificationBell />
      </div>

      {!selectedIdea || selectedIdea.status === "DRAFT" ? (
        <div className="flex gap-2 mb-6">
          <Button
            variant={mode === "create" ? "default" : "outline"}
            onClick={() => setMode("create")}
            data-testid="tab-create"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Create Video
          </Button>
          <Button
            variant={mode === "like" ? "default" : "outline"}
            onClick={() => setMode("like")}
            data-testid="tab-like"
          >
            <Film className="h-4 w-4 mr-2" />
            Like Video
          </Button>
        </div>
      ) : null}

      {selectedIdea && (selectedIdea.status !== "DRAFT") ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Film className="h-5 w-5" />
              {selectedIdea.ideaTitle}
            </CardTitle>
            <div className="text-sm text-muted-foreground">
              Style: <Badge variant="outline">{selectedIdea.style}</Badge>{" "}
              Tone: <Badge variant="outline">{selectedIdea.tone}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Visual Stage Stepper */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                {GENERATION_STAGES.map((stage, idx) => {
                  const currentIdx = getCurrentStageIndex(selectedIdea.currentStage);
                  const isCompleted = idx < currentIdx || selectedIdea.status === "READY";
                  const isCurrent = idx === currentIdx && selectedIdea.status !== "READY";
                  const isPending = idx > currentIdx;
                  
                  const StageIcon = {
                    clock: Clock,
                    lightbulb: Lightbulb,
                    pencil: Pencil,
                    mic: Mic,
                    film: Film,
                    layers: Layers,
                    check: CheckCircle2,
                  }[stage.icon] || Clock;
                  
                  return (
                    <div key={stage.id} className="flex flex-col items-center flex-1">
                      <div 
                        className={`relative flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all ${
                          isCompleted 
                            ? "bg-primary border-primary text-primary-foreground" 
                            : isCurrent 
                              ? "bg-primary/20 border-primary text-primary animate-pulse" 
                              : "bg-muted border-muted-foreground/30 text-muted-foreground"
                        }`}
                        data-testid={`stage-${stage.id}`}
                      >
                        {isCompleted ? (
                          <Check className="h-5 w-5" />
                        ) : isCurrent ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <StageIcon className="h-5 w-5" />
                        )}
                      </div>
                      <span className={`text-xs mt-1 text-center hidden md:block ${
                        isCurrent ? "text-primary font-medium" : isCompleted ? "text-foreground" : "text-muted-foreground"
                      }`}>
                        {stage.label}
                      </span>
                      {idx < GENERATION_STAGES.length - 1 && (
                        <div className={`absolute w-full h-0.5 top-5 left-1/2 -z-10 ${
                          isCompleted ? "bg-primary" : "bg-muted-foreground/30"
                        }`} style={{ width: 'calc(100% - 2.5rem)' }} />
                      )}
                    </div>
                  );
                })}
              </div>
              
              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-medium text-primary">
                    {getStageLabel(selectedIdea.currentStage)}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">
                      {selectedIdea.status !== "READY" && selectedIdea.status !== "FAILED" && getEstimatedTimeRemaining(selectedIdea.progress)}
                    </span>
                    <span className="font-bold text-lg">{selectedIdea.progress}%</span>
                  </div>
                </div>
                <div className="relative">
                  <Progress value={selectedIdea.progress} className="h-3" />
                  <div 
                    className="absolute top-0 left-0 h-3 bg-primary/30 rounded-full animate-pulse"
                    style={{ width: `${Math.min(selectedIdea.progress + 5, 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {selectedIdea.status === "READY" && selectedIdea.videoUrl && (
              <div className="space-y-4">
                <OptimizedVideo
                  src={selectedIdea.videoUrl}
                  title={selectedIdea.ideaTitle || selectedIdea.companyName || 'AI Video'}
                  description={`Video for ${selectedIdea.companyName}`}
                  preload="none"
                  lazy={false}
                  controls
                  className="w-full rounded-lg"
                  ariaLabel="AI generated video player"
                />
                <div className="flex gap-2">
                  <a href={selectedIdea.videoUrl} download>
                    <Button data-testid="button-download">
                      <Download className="h-4 w-4 mr-2" />
                      Download Video
                    </Button>
                  </a>
                </div>
              </div>
            )}

            {selectedIdea.status === "FAILED" && (
              <div className="text-destructive text-sm">
                Error: {selectedIdea.errorMessage || "Unknown error occurred"}
              </div>
            )}

            {isPolling && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating video... This takes 60-80 minutes for premium AI video.
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedIdea(null);
                setIsPolling(false);
                form.reset();
              }}
              data-testid="button-create-new"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Create Another Video
            </Button>
          </CardFooter>
        </Card>
      ) : mode === "create" ? (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Your Video Idea</CardTitle>
                <CardDescription>
                  Describe your video concept - our AI will expand it into a full 60-second production
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="ideaTitle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Video Title</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Why Local Businesses Choose Us" {...field} data-testid="input-title" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="shortIdea"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Brief Idea</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Describe your video idea in 1-3 sentences. What story do you want to tell? What problem does your product/service solve?"
                          className="min-h-[100px]"
                          {...field}
                          data-testid="input-idea"
                        />
                      </FormControl>
                      <FormDescription>
                        Our AI will expand this into a full narrative with Hook → Problem → Solution → Benefits → Proof → CTA
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="companyName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Your Company" {...field} data-testid="input-company" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="targetAudience"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Target Audience (Optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., Small business owners" {...field} data-testid="input-audience" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="personaId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Users className="w-4 h-4" />
                        Audience Persona (Optional)
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
                        Video script will be tailored to match the selected persona's OCEAN traits
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="website"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Website (Optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="https://yourcompany.com" {...field} data-testid="input-website" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="callToAction"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Call to Action</FormLabel>
                        <FormControl>
                          <Input placeholder="Get Started Today!" {...field} data-testid="input-cta" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

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
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Video Style</CardTitle>
                <CardDescription>Choose the visual style for your video</CardDescription>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="style"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {STYLES.map((style) => (
                            <div
                              key={style.id}
                              className={`cursor-pointer p-3 rounded-lg border-2 transition-all ${
                                field.value === style.id
                                  ? "border-primary bg-primary/5"
                                  : "border-border hover:border-primary/50"
                              }`}
                              onClick={() => field.onChange(style.id)}
                              data-testid={`style-${style.id}`}
                            >
                              <div className="text-2xl mb-1">{style.icon}</div>
                              <div className="font-medium text-sm">{style.name}</div>
                              <div className="text-xs text-muted-foreground">{style.description}</div>
                            </div>
                          ))}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Narration Tone</CardTitle>
                <CardDescription>Choose the tone for your video's narration</CardDescription>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="tone"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          {TONES.map((tone) => (
                            <div
                              key={tone.id}
                              className={`cursor-pointer p-3 rounded-lg border-2 transition-all ${
                                field.value === tone.id
                                  ? "border-primary bg-primary/5"
                                  : "border-border hover:border-primary/50"
                              }`}
                              onClick={() => field.onChange(tone.id)}
                              data-testid={`tone-${tone.id}`}
                            >
                              <div className="font-medium text-sm">{tone.name}</div>
                              <div className="text-xs text-muted-foreground">{tone.description}</div>
                            </div>
                          ))}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={createMutation.isPending || startGenerationMutation.isPending}
              data-testid="button-generate"
            >
              {createMutation.isPending || startGenerationMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Starting Generation...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate 60-Second Video
                </>
              )}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Premium AI video generation takes 60-80 minutes. Your video will include 10 AI-generated clips with professional voiceover.
            </p>
          </form>
        </Form>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Film className="h-5 w-5" />
                Like Video - Clone a Style
              </CardTitle>
              <CardDescription>
                Paste a video URL. We'll analyze its visual style and create a similar video with your content.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">Reference Video URL</label>
                <Input
                  placeholder="https://youtube.com/watch?v=... or https://youtu.be/... or direct .mp4 link"
                  value={likeVideoUrl}
                  onChange={(e) => setLikeVideoUrl(e.target.value)}
                  data-testid="input-like-video-url"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Supports YouTube, Vimeo, and direct .mp4 links
                </p>
              </div>

              <div>
                <label className="text-sm font-medium">Video Title</label>
                <Input
                  placeholder="e.g., Why Local Businesses Choose Us"
                  value={likeTitle}
                  onChange={(e) => setLikeTitle(e.target.value)}
                  data-testid="input-like-title"
                />
              </div>

              <div>
                <label className="text-sm font-medium">What should the video be about?</label>
                <Textarea
                  placeholder="Describe what you want in the new video (your topic/product/service). The style will come from the reference video."
                  className="min-h-[100px]"
                  value={likeIdea}
                  onChange={(e) => setLikeIdea(e.target.value)}
                  data-testid="input-like-idea"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Company Name</label>
                  <Input
                    placeholder="Your Company"
                    value={likeCompanyName}
                    onChange={(e) => setLikeCompanyName(e.target.value)}
                    data-testid="input-like-company"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Website (Optional)</label>
                  <Input
                    placeholder="https://yourcompany.com"
                    value={likeWebsite}
                    onChange={(e) => setLikeWebsite(e.target.value)}
                    data-testid="input-like-website"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">Call to Action</label>
                <Input
                  placeholder="Get Started Today!"
                  value={likeCta}
                  onChange={(e) => setLikeCta(e.target.value)}
                  data-testid="input-like-cta"
                />
              </div>
            </CardContent>
          </Card>

          {analysisResult && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  Style Analysis Complete
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium">Mood:</span>{" "}
                    <Badge variant="outline">{analysisResult.mood}</Badge>
                  </div>
                  <div>
                    <span className="font-medium">Pacing:</span>{" "}
                    <Badge variant="outline">{analysisResult.pacing}</Badge>
                  </div>
                  <div>
                    <span className="font-medium">Scenes:</span>{" "}
                    {analysisResult.sceneCount}
                  </div>
                  <div>
                    <span className="font-medium">Duration:</span>{" "}
                    {analysisResult.duration?.toFixed(1)}s
                  </div>
                </div>
                <div>
                  <span className="font-medium text-sm">Color Palette:</span>
                  <p className="text-sm text-muted-foreground">{analysisResult.colorPalette}</p>
                </div>
                <div>
                  <span className="font-medium text-sm">Camera Work:</span>
                  <p className="text-sm text-muted-foreground">{analysisResult.cameraWork}</p>
                </div>
                <div>
                  <span className="font-medium text-sm">Editing Style:</span>
                  <p className="text-sm text-muted-foreground">{analysisResult.editingStyle}</p>
                </div>
                <div>
                  <span className="font-medium text-sm">Style Description:</span>
                  <p className="text-sm text-muted-foreground">{analysisResult.styleDescription}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {!analysisResult ? (
            <Button
              size="lg"
              className="w-full"
              disabled={
                !likeVideoUrl || !likeTitle || !likeIdea || !likeCompanyName ||
                likeIdea.length < 5 ||
                createLikeVideoMutation.isPending || analyzeMutation.isPending || analyzingVideo
              }
              onClick={() => createLikeVideoMutation.mutate()}
              data-testid="button-analyze"
            >
              {createLikeVideoMutation.isPending || analyzingVideo ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {analyzingVideo ? "Analyzing Video Style..." : "Creating..."}
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4 mr-2" />
                  Analyze Video Style
                </>
              )}
            </Button>
          ) : (
            <div className="flex gap-3">
              <Button
                size="lg"
                className="flex-1"
                disabled={!likeVideoIdeaId || generateLikeVideoMutation.isPending}
                onClick={() => likeVideoIdeaId && generateLikeVideoMutation.mutate(likeVideoIdeaId)}
                data-testid="button-generate-like"
              >
                {generateLikeVideoMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Starting Generation...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Generate Video with This Style
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setAnalysisResult(null);
                  setLikeVideoIdeaId(null);
                }}
                data-testid="button-reset-analysis"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Re-analyze
              </Button>
            </div>
          )}

          <p className="text-center text-sm text-muted-foreground">
            Analysis takes 30-60 seconds. Video generation takes 60-80 minutes.
          </p>
        </div>
      )}

      {/* Your Videos Section */}
      <Separator className="my-8" />
      <div className="space-y-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Video className="h-5 w-5" />
          Your Idea Videos ({myVideos?.ideas?.length || 0})
        </h2>
        
        {videosLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : myVideos?.ideas && myVideos.ideas.length > 0 ? (
          <div className="grid gap-4">
            {myVideos.ideas.map((idea) => (
              <Card key={idea.id} className="overflow-hidden" data-testid={`video-card-${idea.id}`}>
                <div className="flex flex-col md:flex-row">
                  {idea.status === "READY" && idea.videoUrl ? (
                    <div className="md:w-1/2 aspect-video bg-black">
                      <OptimizedVideo
                        src={idea.videoUrl}
                        title={idea.ideaTitle || idea.companyName || 'AI Video'}
                        description={`Video for ${idea.companyName}`}
                        preload="none"
                        lazy
                        controls
                        className="w-full h-full object-contain"
                        ariaLabel={`Video for ${idea.ideaTitle || idea.companyName}`}
                      />
                    </div>
                  ) : (
                    <div className="md:w-1/2 aspect-video bg-muted flex items-center justify-center">
                      {idea.status === "PROCESSING" || idea.status === "QUEUED" || idea.status === "GENERATING" ? (
                        <div className="text-center p-4 w-full">
                          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-primary" />
                          <div className="text-sm font-medium text-primary mb-1">{getStageLabel(idea.currentStage)}</div>
                          <div className="w-48 mx-auto">
                            <Progress value={idea.progress} className="h-2" />
                            <div className="flex justify-between text-xs text-muted-foreground mt-1">
                              <span>{idea.progress}%</span>
                              <span>{getEstimatedTimeRemaining(idea.progress)}</span>
                            </div>
                          </div>
                        </div>
                      ) : idea.status === "FAILED" ? (
                        <div className="text-center p-4 text-destructive">
                          <X className="h-8 w-8 mx-auto mb-2" />
                          <div className="text-sm">Generation Failed</div>
                        </div>
                      ) : (
                        <Film className="h-12 w-12 text-muted-foreground" />
                      )}
                    </div>
                  )}
                  <div className="md:w-1/2 p-4 flex flex-col justify-between">
                    <div>
                      <h3 className="font-semibold text-lg mb-1">{idea.ideaTitle}</h3>
                      <p className="text-sm text-muted-foreground mb-2 line-clamp-2">{idea.shortIdea?.substring(0, 150)}...</p>
                      <div className="flex flex-wrap gap-2 mb-2">
                        <Badge variant="outline">{idea.companyName}</Badge>
                        <Badge variant="outline">{idea.style}</Badge>
                        <Badge variant="outline">{idea.tone}</Badge>
                        <Badge variant={idea.status === "READY" ? "default" : idea.status === "FAILED" ? "destructive" : "secondary"}>
                          {idea.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Created: {new Date(idea.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex gap-2 mt-4">
                      {(idea.status === "PENDING" || idea.status === "FAILED") && (
                        <Button
                          size="sm"
                          onClick={() => startGenerationMutation.mutate(idea.id)}
                          disabled={startGenerationMutation.isPending}
                          data-testid={`button-generate-${idea.id}`}
                        >
                          {startGenerationMutation.isPending ? (
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          ) : (
                            <Wand2 className="h-4 w-4 mr-1" />
                          )}
                          {idea.status === "FAILED" ? "Retry" : "Generate"}
                        </Button>
                      )}
                      {idea.status === "READY" && idea.videoUrl && (
                        <>
                          <a href={idea.videoUrl} download>
                            <Button size="sm" data-testid={`button-download-${idea.id}`}>
                              <Download className="h-4 w-4 mr-1" />
                              Download
                            </Button>
                          </a>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedIdea(idea);
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            data-testid={`button-view-${idea.id}`}
                          >
                            <Play className="h-4 w-4 mr-1" />
                            View
                          </Button>
                          <PublishDialog
                            contentId={idea.id}
                            contentType="video"
                            contentTitle={idea.ideaTitle}
                          />
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          if (confirm("Are you sure you want to delete this video?")) {
                            deleteMutation.mutate(idea.id);
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-${idea.id}`}
                      >
                        {deleteMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="p-8 text-center text-muted-foreground">
            <Film className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No videos yet. Create your first AI-generated video above!</p>
          </Card>
        )}
      </div>
    </div>
  );
}
