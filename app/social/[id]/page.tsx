"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Facebook,
  Twitter,
  Instagram,
  Linkedin,
  Pin,
  ArrowLeft,
  Copy,
  Download,
  Edit,
  Edit2,
  Trash2,
  Calendar,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  MapPin,
  Briefcase,
  MessageSquare,
  Video,
  Loader2 as LoaderIcon,
  Play,
  Upload,
  X,
  Image as ImageIcon,
  RefreshCw,
  ExternalLink,
  Hash,
  Share2,
} from "lucide-react";
import { PublishDialog } from "@/components/PublishDialog";
import { OptimizedVideo } from "@/components/OptimizedVideo";
import { Textarea } from "@/components/ui/textarea";
import Link from "next/link";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface SocialPostVariant {
  id: number;
  socialPostId: number;
  platform: string;
  variantIndex: number;
  caption: string;
  characterCount: number;
  hashtags: string;
  hashtagsJson: string[];
  emojisJson?: string[];
  imageUrl: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

interface SocialPostDetail {
  id: number;
  userId: number;
  articleId: number | null;
  topic: string;
  title: string;
  location: string;
  tone: string;
  mood: string | null;
  industry: string | null;
  landingPageUrl: string | null;
  userEmail: string | null;
  companyName: string | null;
  companyLogoUrl: string | null;
  videoUrl: string | null;
  videoStatus: string | null;
  videoProgress: number | null;
  videoStage: string | null;
  videoDuration: number | null;
  videoTitle: string | null;
  videoDescription: string | null;
  videoTagsJson: string[] | null;
  videoType: string | null;
  errorMessage: string | null;
  platformsJson: string[];
  status: string;
  scheduleAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  variants: SocialPostVariant[];
}

export default function SocialPostDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareModalData, setShareModalData] = useState<{ platform: string; fullText: string; shareUrl: string | null } | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [selectedVideoType, setSelectedVideoType] = useState<"slideshow" | "veo">("slideshow");
  const [editLogoFile, setEditLogoFile] = useState<File | null>(null);
  const [editLogoPreview, setEditLogoPreview] = useState<string>("");
  const [logoUploading, setLogoUploading] = useState(false);
  const [removeExistingLogo, setRemoveExistingLogo] = useState(false);
  const [editFormData, setEditFormData] = useState({
    title: "",
    topic: "",
    companyName: "",
    location: "",
    tone: "",
    mood: "",
    industry: "",
  });
  const [regeneratingVariants, setRegeneratingVariants] = useState<Set<number>>(new Set());

  const postId = params.id as string;

  const { data: post, isLoading } = useQuery<SocialPostDetail>({
    queryKey: [`/api/social_posts/${postId}`],
    enabled: !!postId,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest(`/api/social_posts/${postId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      toast({
        title: "Deleted",
        description: "Social post has been deleted",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/social_posts'] });
      router.push("/social/dashboard");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete post",
        variant: "destructive",
      });
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: async (scheduleData: { scheduleAt: string }) => {
      await apiRequest(`/api/social_posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scheduleData),
      });
    },
    onSuccess: () => {
      toast({
        title: "Scheduled",
        description: "Post has been scheduled successfully",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/social_posts/${postId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/social_posts'] });
      setScheduleDialogOpen(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to schedule post",
        variant: "destructive",
      });
    },
  });

  const handleEditLogoUpload = async (file: File): Promise<string> => {
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

  const handleEditLogoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
      setEditLogoPreview(reader.result as string);
    };
    reader.readAsDataURL(file);

    setEditLogoFile(file);
  };

  const removeEditLogoFile = () => {
    setEditLogoFile(null);
    setEditLogoPreview("");
    setRemoveExistingLogo(true); // Allow uploading a new logo after removing existing one
  };

  const updateMutation = useMutation({
    mutationFn: async (updateData: typeof editFormData) => {
      // Upload logo if new file is selected
      let updatedData: any = { ...updateData };
      if (editLogoFile) {
        try {
          const logoUrl = await handleEditLogoUpload(editLogoFile);
          updatedData.companyLogoUrl = logoUrl;
        } catch (error: any) {
          throw new Error(`Logo upload failed: ${error.message}`);
        }
      } else if (removeExistingLogo) {
        // User removed the logo without adding a new one
        updatedData.companyLogoUrl = null;
      }

      await apiRequest(`/api/social_posts/${postId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedData),
      });
    },
    onSuccess: async () => {
      toast({
        title: "Updated",
        description: "Post has been updated successfully",
      });
      // Force refetch to immediately update the UI
      await queryClient.refetchQueries({ queryKey: [`/api/social_posts/${postId}`] });
      await queryClient.invalidateQueries({ queryKey: ['/api/social_posts'] });
      setEditDialogOpen(false);
      setEditLogoFile(null);
      setEditLogoPreview("");
      setRemoveExistingLogo(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update post",
        variant: "destructive",
      });
    },
  });

  const regenerateVariantMutation = useMutation({
    mutationFn: async (variantId: number) => {
      const response = await apiRequest(`/api/social-posts/variants/${variantId}/regenerate`, {
        method: "POST",
      });
      return { variantId, response };
    },
    onSuccess: ({ variantId, response }) => {
      queryClient.setQueryData<SocialPostDetail>(
        [`/api/social_posts/${postId}`], 
        (prev) => {
          if (!prev || !response.variant) return prev;
          
          return {
            ...prev,
            variants: prev.variants.map(v => 
              v.id === variantId 
                ? { 
                    ...v, 
                    caption: response.variant.caption,
                    hashtags: response.variant.hashtags.map((h: any) => h.tag).join(' '),
                    hashtagsJson: response.variant.hashtags,
                    emojisJson: response.variant.emojis || [],
                    hyperlinksJson: response.variant.hyperlinks || [],
                    characterCount: response.variant.characterCount,
                    status: response.variant.status,
                    errorMessage: null,
                  }
                : v
            ),
          };
        }
      );
      
      queryClient.invalidateQueries({ queryKey: [`/api/social_posts/${postId}`] });
      
      const updatedPost = queryClient.getQueryData<SocialPostDetail>([`/api/social_posts/${postId}`]);
      const variant = updatedPost?.variants.find(v => v.id === variantId);
      const platform = variant?.platform || 'variant';
      
      toast({
        title: "Regenerated successfully",
        description: `${platform.charAt(0).toUpperCase() + platform.slice(1)} content has been regenerated.`,
      });
      
      setRegeneratingVariants(prev => {
        const next = new Set(prev);
        next.delete(variantId);
        return next;
      });
    },
    onError: (error: any, variantId) => {
      const variant = post?.variants.find(v => v.id === variantId);
      const platform = variant?.platform || 'variant';
      
      toast({
        title: `${platform.charAt(0).toUpperCase() + platform.slice(1)} regeneration failed`,
        description: error instanceof Error ? error.message : "An error occurred during regeneration",
        variant: "destructive",
      });
      
      console.error(`Failed to regenerate variant ${variantId}:`, error);
      setRegeneratingVariants(prev => {
        const next = new Set(prev);
        next.delete(variantId);
        return next;
      });
    },
  });

  const generateVideoMutation = useMutation({
    mutationFn: async (opts: { force?: boolean } = {}) => {
      const response = await apiRequest("/api/social/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          socialPostId: parseInt(postId),
          platform: "tiktok",
          videoType: selectedVideoType,
          force: opts.force ?? false,
        }),
      });
      return response;
    },
    onSuccess: (data: any) => {
      const timeEstimate = selectedVideoType === "veo" ? "60-80 minutes" : "2-3 minutes";
      toast({
        title: "Video generation started",
        description: `Your 60-second ${selectedVideoType === "veo" ? "AI motion" : ""} video is being generated. This will take ${timeEstimate}.`,
      });
      
      // CRITICAL: Optimistic cache update to fix double-click issue
      queryClient.setQueryData<SocialPostDetail>([`/api/social_posts/${postId}`], (old) => {
        if (!old) return old;
        return {
          ...old,
          videoStatus: data.videoStatus || "GENERATING",
          videoProgress: data.videoProgress || 0,
          videoStage: data.videoStage || "queued",
        };
      });
      
      // Also invalidate to ensure we get fresh data
      queryClient.invalidateQueries({ queryKey: [`/api/social_posts/${postId}`] });
    },
    onError: (error: Error) => {
      toast({
        title: "Video generation failed",
        description: error.message || "Failed to start video generation",
        variant: "destructive",
      });
    },
  });

  const cancelVideoMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/api/social/video/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ socialPostId: parseInt(postId) }),
      });
      return response;
    },
    onSuccess: () => {
      toast({ title: "Video generation stopped" });
      queryClient.invalidateQueries({ queryKey: [`/api/social_posts/${postId}`] });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not stop generation",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Poll for video generation status (tighter polling when generating)
  useEffect(() => {
    if (!post || !post.videoStatus) return;
    
    if (post.videoStatus === "GENERATING") {
      const pollInterval = setInterval(() => {
        queryClient.invalidateQueries({ queryKey: [`/api/social_posts/${postId}`] });
      }, 2000); // Poll every 2 seconds for real-time progress updates

      return () => clearInterval(pollInterval);
    }
    return undefined;
  }, [post?.videoStatus, postId]);

  const platformIcon = (platform: string, className = "w-4 h-4") => {
    switch (platform.toLowerCase()) {
      case 'x':
      case 'twitter':
        return <Twitter className={className} />;
      case 'facebook':
        return <Facebook className={className} />;
      case 'instagram':
        return <Instagram className={className} />;
      case 'linkedin':
        return <Linkedin className={className} />;
      case 'pinterest':
        return <Pin className={className} />;
      default:
        return <MessageSquare className={className} />;
    }
  };

  const statusIcon = (status: string | null | undefined) => {
    if (!status) {
      return <AlertCircle className="w-4 h-4 text-gray-400" />;
    }
    switch (status.toLowerCase()) {
      case 'published':
      case 'ready':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'scheduled':
        return <Clock className="w-4 h-4 text-blue-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'generating':
        return <Clock className="w-4 h-4 text-yellow-500 animate-spin" />;
      default:
        return <AlertCircle className="w-4 h-4 text-yellow-500" />;
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: `${label} copied to clipboard`,
    });
  };

  // Generate platform-specific share URLs
  const generateShareUrl = (platform: string, caption: string, hashtags: string, landingPageUrl?: string) => {
    const fullText = `${caption}\n\n${hashtags}`.trim();
    const encodedText = encodeURIComponent(fullText);
    const encodedUrl = landingPageUrl ? encodeURIComponent(landingPageUrl) : '';
    
    const normalizedPlatform = platform.toLowerCase();
    
    switch (normalizedPlatform) {
      case 'twitter':
      case 'x':
        // Twitter/X web intent (max 280 chars)
        return `https://twitter.com/intent/tweet?text=${encodedText}${landingPageUrl ? `&url=${encodedUrl}` : ''}`;
      
      case 'facebook':
        // Facebook sharer
        if (landingPageUrl) {
          return `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedText}`;
        }
        return `https://www.facebook.com/sharer/sharer.php?quote=${encodedText}`;
      
      case 'linkedin':
        // LinkedIn share (opens share dialog)
        if (landingPageUrl) {
          return `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`;
        }
        // For LinkedIn without URL, we'll copy to clipboard instead
        return null;
      
      case 'pinterest':
        // Pinterest pin creation
        if (landingPageUrl) {
          return `https://pinterest.com/pin/create/button/?url=${encodedUrl}&description=${encodedText}`;
        }
        return null;
      
      case 'instagram':
        // Instagram doesn't support web posting - copy to clipboard only
        return null;
      
      default:
        return null;
    }
  };

  const handleQuickShare = (platform: string, caption: string, hashtags: string) => {
    const fullText = `${caption}\n\n${hashtags}`.trim();
    const shareUrl = generateShareUrl(platform, caption, hashtags, post?.landingPageUrl || undefined);
    setShareCopied(false);
    setShareModalData({ platform, fullText, shareUrl });
    setShareModalOpen(true);
  };

  const handleCopyShareText = async () => {
    if (!shareModalData) return;
    await navigator.clipboard.writeText(shareModalData.fullText);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  };

  const handleOpenPlatform = () => {
    if (!shareModalData) return;
    navigator.clipboard.writeText(shareModalData.fullText);
    if (shareModalData.shareUrl) {
      window.open(shareModalData.shareUrl, '_blank', 'noopener,noreferrer,width=600,height=700');
    }
    setShareModalOpen(false);
  };

  const handleSchedule = () => {
    if (!scheduleDate || !scheduleTime) {
      toast({
        title: "Error",
        description: "Please select both date and time",
        variant: "destructive",
      });
      return;
    }

    const scheduleAt = new Date(`${scheduleDate}T${scheduleTime}`).toISOString();
    scheduleMutation.mutate({ scheduleAt });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto p-6">
          <div className="text-center py-16">
            <div className="text-lg text-muted-foreground">Loading post details...</div>
          </div>
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto p-6">
          <div className="text-center py-16">
            <div className="text-lg text-muted-foreground mb-4">Post not found</div>
            <Link href="/social/dashboard">
              <Button variant="outline">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/social/dashboard">
              <Button variant="outline" size="icon" data-testid="button-back">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold" data-testid="text-post-title">
                {post.title}
              </h1>
              <div className="flex items-center gap-2 mt-1">
                {statusIcon(post.status)}
                <Badge variant="outline" data-testid="badge-post-status">
                  {post.status}
                </Badge>
                {post.scheduleAt && (
                  <span className="text-sm text-muted-foreground">
                    Scheduled for {format(new Date(post.scheduleAt), "PPp")}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => {
              if (post) {
                setEditFormData({
                  title: post.title || "",
                  topic: post.topic || "",
                  companyName: post.companyName || "",
                  location: post.location || "",
                  tone: post.tone || "",
                  mood: post.mood || "",
                  industry: post.industry || "",
                });
                // Reset logo edit state when opening dialog
                setEditLogoFile(null);
                setEditLogoPreview("");
                setRemoveExistingLogo(false);
                setEditDialogOpen(true);
              }
            }} data-testid="button-edit">
              <Edit className="w-4 h-4 mr-2" />
              Edit
            </Button>
            <Button variant="outline" onClick={() => setScheduleDialogOpen(true)} data-testid="button-schedule">
              <Calendar className="w-4 h-4 mr-2" />
              Schedule
            </Button>
            <PublishDialog
              contentId={parseInt(postId)}
              contentType="social_post"
              contentTitle={post.title}
              disabled={post.status !== 'COMPLETED'}
            />
            <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)} data-testid="button-delete">
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
          </div>
        </div>

        {/* Post Overview */}
        <Card data-testid="card-overview">
          <CardHeader>
            <CardTitle>Post Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label className="text-sm font-medium text-muted-foreground">Topic</Label>
                <p className="text-base" data-testid="text-topic">{post.topic}</p>
              </div>
              <div>
                <Label className="text-sm font-medium text-muted-foreground">Location</Label>
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-muted-foreground" />
                  <p className="text-base" data-testid="text-location">{post.location}</p>
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium text-muted-foreground">Tone</Label>
                <p className="text-base" data-testid="text-tone">{post.tone}</p>
              </div>
              {post.mood && (
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Mood</Label>
                  <p className="text-base" data-testid="text-mood">{post.mood}</p>
                </div>
              )}
              {post.industry && (
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Industry</Label>
                  <div className="flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-muted-foreground" />
                    <p className="text-base" data-testid="text-industry">{post.industry}</p>
                  </div>
                </div>
              )}
              {post.companyName && (
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Company Name</Label>
                  <p className="text-base" data-testid="text-company-name">{post.companyName}</p>
                </div>
              )}
              {post.landingPageUrl && (
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Landing Page</Label>
                  <a href={post.landingPageUrl} target="_blank" rel="noopener noreferrer" className="text-base text-primary hover:underline" data-testid="link-landing-page">
                    {post.landingPageUrl}
                  </a>
                </div>
              )}
            </div>
            <Separator />
            <div>
              <Label className="text-sm font-medium text-muted-foreground mb-2 block">Platforms</Label>
              <div className="flex flex-wrap gap-2">
                {post.platformsJson && Array.isArray(post.platformsJson) ? (
                  post.platformsJson.map((platform) => (
                    <Badge key={platform} variant="secondary" data-testid={`badge-platform-${platform}`}>
                      {platform}
                    </Badge>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No platforms selected</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 60-Second Video */}
        <Card data-testid="card-video">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Video className="w-5 h-5 text-primary" />
                <CardTitle>60-Second Video</CardTitle>
              </div>
              {post.videoStatus && (
                <Badge variant={post.videoStatus === "READY" ? "default" : post.videoStatus === "FAILED" ? "destructive" : "secondary"}>
                  {post.videoStatus}
                </Badge>
              )}
            </div>
            <CardDescription>
              AI-generated 60-second video with images, voiceover, and company branding
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!post.videoUrl && (!post.videoStatus || post.videoStatus === "PENDING") && (
              <div className="text-center py-8 space-y-4">
                <Video className="w-16 h-16 mx-auto text-muted-foreground" />
                <div>
                  <p className="text-lg font-medium mb-2">No video generated yet</p>
                  <p className="text-sm text-muted-foreground mb-4">
                    {!post.companyName 
                      ? "Company name is required to generate videos. Please edit this post to add your company name."
                      : "Generate a professional 60-second video with AI-powered voiceover, images, and branding"}
                  </p>
                  {!post.companyName ? (
                    <div className="space-y-3">
                      <Button
                        variant="outline"
                        disabled
                        className="opacity-50 cursor-not-allowed"
                        data-testid="button-generate-video-disabled"
                      >
                        <Play className="w-4 h-4 mr-2" />
                        Generate 60-Second Video
                      </Button>
                      <div className="flex flex-col items-center gap-2">
                        <p className="text-xs text-destructive">
                          ⚠️ Company name required for video generation
                        </p>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setEditFormData({
                              title: post.title || "",
                              topic: post.topic || "",
                              companyName: post.companyName || "",
                              location: post.location || "",
                              tone: post.tone || "",
                              mood: post.mood || "",
                              industry: post.industry || "",
                            });
                            // Reset logo edit state when opening dialog
                            setEditLogoFile(null);
                            setEditLogoPreview("");
                            setRemoveExistingLogo(false);
                            setEditDialogOpen(true);
                          }}
                          data-testid="button-edit-to-add-company"
                        >
                          <Edit2 className="w-3 h-3 mr-2" />
                          Add Company Name
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex flex-col items-center gap-3">
                        <Label className="text-sm font-medium">Video Type</Label>
                        <div className="flex gap-2">
                          <Button
                            variant={selectedVideoType === "slideshow" ? "default" : "outline"}
                            size="sm"
                            onClick={() => setSelectedVideoType("slideshow")}
                            data-testid="button-video-type-slideshow"
                          >
                            Fast Slideshow
                          </Button>
                          <Button
                            variant={selectedVideoType === "veo" ? "default" : "outline"}
                            size="sm"
                            onClick={() => setSelectedVideoType("veo")}
                            data-testid="button-video-type-veo"
                          >
                            Veo AI Video
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground text-center max-w-sm">
                          {selectedVideoType === "slideshow" 
                            ? "Fast slideshow with AI images + voiceover (2-3 minutes)"
                            : "Premium AI-generated motion video clips (60-80 minutes)"}
                        </p>
                      </div>
                      
                      <Button
                        onClick={() => generateVideoMutation.mutate({})}
                        disabled={generateVideoMutation.isPending}
                        data-testid="button-generate-video"
                      >
                        {generateVideoMutation.isPending ? (
                          <>
                            <LoaderIcon className="w-4 h-4 mr-2 animate-spin" />
                            Starting Generation...
                          </>
                        ) : (
                          <>
                            <Play className="w-4 h-4 mr-2" />
                            Generate 60-Second Video
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {post.videoStatus === "GENERATING" && (
              <div className="text-center py-8 space-y-4">
                <LoaderIcon className="w-16 h-16 mx-auto text-primary animate-spin" />
                <div>
                  <p className="text-lg font-medium mb-2">Generating your video...</p>
                  <p className="text-sm text-muted-foreground mb-4">
                    {post.videoStage === "queued" && "Initializing video generation..."}
                    {post.videoStage === "script_complete" && "✍️ Video script written"}
                    {post.videoStage === "parallel_generation" && "🚀 Creating images and voiceover in parallel..."}
                    {post.videoStage === "assets_complete" && "🎬 Assets ready, composing video..."}
                    {post.videoStage === "composition_complete" && "✨ Finalizing your video..."}
                    {!post.videoStage && "Processing..."}
                  </p>
                  
                  {/* Progress Bar */}
                  <div className="max-w-md mx-auto">
                    <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
                      <div 
                        className="bg-primary h-full transition-all duration-500 ease-out"
                        style={{ width: `${post.videoProgress || 0}%` }}
                        data-testid="video-progress-bar"
                      />
                    </div>
                    <p className="text-sm text-muted-foreground mt-2" data-testid="video-progress-text">
                      {post.videoProgress || 0}% complete
                    </p>
                  </div>
                  
                  <p className="text-xs text-muted-foreground mt-4">
                    This process takes 2-3 minutes. The page updates automatically.
                  </p>

                  <div className="flex items-center justify-center gap-3 mt-4">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => cancelVideoMutation.mutate()}
                      disabled={cancelVideoMutation.isPending}
                      data-testid="button-stop-video"
                    >
                      <X className="w-4 h-4 mr-2" />
                      {cancelVideoMutation.isPending ? "Stopping..." : "Stop Generating"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => generateVideoMutation.mutate({ force: true })}
                      disabled={generateVideoMutation.isPending}
                      data-testid="button-retry-video"
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Stuck? Retry
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {post.videoStatus === "FAILED" && (
              <div className="text-center py-8 space-y-4">
                <XCircle className="w-16 h-16 mx-auto text-destructive" />
                <div>
                  <p className="text-lg font-medium mb-2">Video generation failed</p>
                  {post.errorMessage?.includes("RESOURCE_EXHAUSTED") || post.errorMessage?.includes("quota") ? (
                    <div className="text-sm text-muted-foreground mb-4 space-y-1">
                      <p className="text-destructive font-medium">Veo API quota exceeded</p>
                      <p>Your Veo AI video quota is used up. Try the <strong>Fast Slideshow</strong> option instead — it uses Gemini images and is much faster.</p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground mb-4">
                      {post.errorMessage ? post.errorMessage.slice(0, 200) : "Something went wrong. Please try again."}
                    </p>
                  )}
                  
                  {/* Video Type Selector for Retry */}
                  <div className="flex flex-col items-center gap-3 mb-4">
                    <Label className="text-sm font-medium">Video Type</Label>
                    <div className="flex gap-2">
                      <Button
                        variant={selectedVideoType === "slideshow" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setSelectedVideoType("slideshow")}
                        data-testid="button-retry-video-type-slideshow"
                      >
                        Fast Slideshow
                      </Button>
                      <Button
                        variant={selectedVideoType === "veo" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setSelectedVideoType("veo")}
                        data-testid="button-retry-video-type-veo"
                      >
                        Veo AI Video
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground text-center max-w-sm">
                      {selectedVideoType === "slideshow" 
                        ? "Fast slideshow with AI images + voiceover (2-3 minutes)"
                        : "Premium AI-generated motion video clips (60-80 minutes)"}
                    </p>
                  </div>
                  
                  <Button
                    onClick={() => generateVideoMutation.mutate({})}
                    disabled={generateVideoMutation.isPending}
                    variant="outline"
                    data-testid="button-retry-video"
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Retry Generation
                  </Button>
                </div>
              </div>
            )}

            {post.videoUrl && post.videoStatus === "READY" && (
              <div className="space-y-4">
                <div className="relative w-full h-screen rounded-lg overflow-hidden bg-black flex items-center justify-center">
                  <OptimizedVideo
                    src={post.videoUrl}
                    title={post.companyName ? `${post.companyName} Social Video` : 'Social Video'}
                    description={(post as any).caption || undefined}
                    duration={post.videoDuration ? `PT${post.videoDuration}S` : undefined}
                    preload="none"
                    lazy={false}
                    controls
                    className="w-full h-full"
                    ariaLabel="Social video player"
                  />
                </div>
                
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                      {post.videoDuration && (
                        <span>Duration: {post.videoDuration}s</span>
                      )}
                      {post.videoType && (
                        <span className="ml-2">• {post.videoType === "veo" ? "Veo AI" : "Slideshow"}</span>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => {
                        const link = document.createElement('a');
                        link.href = post.videoUrl!;
                        link.download = `social-video-${post.id}.mp4`;
                        link.click();
                      }}
                      data-testid="button-download-video"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download Video
                    </Button>
                  </div>
                  
                  {/* Regenerate Section with Video Type Selector */}
                  <div className="border-t pt-4">
                    <div className="flex flex-col items-center gap-3">
                      <Label className="text-sm font-medium">Regenerate with Different Type</Label>
                      <div className="flex gap-2">
                        <Button
                          variant={selectedVideoType === "slideshow" ? "default" : "outline"}
                          size="sm"
                          onClick={() => setSelectedVideoType("slideshow")}
                          data-testid="button-regen-video-type-slideshow"
                        >
                          Fast Slideshow
                        </Button>
                        <Button
                          variant={selectedVideoType === "veo" ? "default" : "outline"}
                          size="sm"
                          onClick={() => setSelectedVideoType("veo")}
                          data-testid="button-regen-video-type-veo"
                        >
                          Veo AI Video
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground text-center max-w-sm">
                        {selectedVideoType === "slideshow" 
                          ? "Fast slideshow with AI images + voiceover (2-3 minutes)"
                          : "Premium AI-generated motion video clips (60-80 minutes)"}
                      </p>
                      <Button
                        variant="outline"
                        onClick={() => generateVideoMutation.mutate({})}
                        disabled={generateVideoMutation.isPending}
                        data-testid="button-regenerate-video"
                      >
                        {generateVideoMutation.isPending ? (
                          <>
                            <LoaderIcon className="w-4 h-4 mr-2 animate-spin" />
                            Regenerating...
                          </>
                        ) : (
                          <>
                            <Play className="w-4 h-4 mr-2" />
                            Regenerate Video
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>

                {post.companyName && (
                  <div className="text-sm text-muted-foreground">
                    Branded with: {post.companyName}
                    {post.companyLogoUrl && " (with logo)"}
                  </div>
                )}

                {/* Video SEO/GEO Metadata */}
                {(post.videoTitle || post.videoTagsJson) && (
                  <div className="border-t pt-4 space-y-3">
                    <h4 className="font-semibold text-sm flex items-center gap-2">
                      <Hash className="w-4 h-4" />
                      Video SEO/GEO Metadata
                    </h4>
                    
                    {post.videoTitle && (
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Video Title (copy for upload)</label>
                        <div className="flex items-center gap-2">
                          <Input 
                            value={post.videoTitle} 
                            readOnly 
                            className="text-sm"
                            data-testid="input-video-title"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => {
                              navigator.clipboard.writeText(post.videoTitle!);
                              toast({ title: "Copied!", description: "Video title copied to clipboard" });
                            }}
                            data-testid="button-copy-video-title"
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    )}

                    {post.videoDescription && (
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Video Description</label>
                        <div className="flex items-start gap-2">
                          <Textarea 
                            value={post.videoDescription} 
                            readOnly 
                            className="text-sm min-h-[80px]"
                            data-testid="textarea-video-description"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => {
                              navigator.clipboard.writeText(post.videoDescription!);
                              toast({ title: "Copied!", description: "Video description copied to clipboard" });
                            }}
                            data-testid="button-copy-video-description"
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    )}

                    {post.videoTagsJson && post.videoTagsJson.length > 0 && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-medium text-muted-foreground">
                            Video Tags ({post.videoTagsJson.length})
                          </label>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const tagsText = post.videoTagsJson!.join(", ");
                              navigator.clipboard.writeText(tagsText);
                              toast({ title: "Copied!", description: `${post.videoTagsJson!.length} tags copied to clipboard` });
                            }}
                            data-testid="button-copy-video-tags"
                          >
                            <Copy className="w-3 h-3 mr-1" />
                            Copy All
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {post.videoTagsJson.map((tag, i) => (
                            <Badge 
                              key={i} 
                              variant="secondary" 
                              className="text-xs"
                              data-testid={`badge-video-tag-${i}`}
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Platform Variants */}
        <div className="space-y-4">
          <h2 className="text-2xl font-bold">Platform Content ({post.variants?.length || 0})</h2>
          {!post.variants || post.variants.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No content generated yet for this post
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {post.variants.map((variant) => (
                <Card key={variant.id} data-testid={`variant-card-${variant.id}`} className="hover-elevate">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {platformIcon(variant.platform)}
                        <CardTitle className="text-lg capitalize">{variant.platform}</CardTitle>
                      </div>
                      <div className="flex items-center gap-2">
                        {statusIcon(variant.status)}
                        <Badge variant="outline" data-testid={`variant-status-${variant.id}`}>
                          {variant.status}
                        </Badge>
                      </div>
                    </div>
                    {variant.errorMessage && (
                      <CardDescription className="text-red-500" data-testid={`variant-error-${variant.id}`}>
                        Error: {variant.errorMessage}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Image */}
                    {variant.imageUrl && (
                      <div className="relative aspect-video rounded-lg overflow-hidden bg-muted">
                        <img
                          src={variant.imageUrl}
                          alt={`${variant.platform} image`}
                          className="w-full h-full object-cover"
                          data-testid={`variant-image-${variant.id}`}
                        />
                      </div>
                    )}

                    {/* Caption */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-sm font-medium">Caption</Label>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => copyToClipboard(variant.caption, "Caption")}
                          data-testid={`button-copy-caption-${variant.id}`}
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                      <p className="text-sm whitespace-pre-wrap border rounded-lg p-3 bg-muted" data-testid={`variant-caption-${variant.id}`}>
                        {variant.caption}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {variant.characterCount} characters
                      </p>
                    </div>

                    {/* Hashtags */}
                    {variant.hashtagsJson && variant.hashtagsJson.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Label className="text-sm font-medium">Hashtags</Label>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => copyToClipboard(variant.hashtags || variant.hashtagsJson.join(' '), "Hashtags")}
                            data-testid={`button-copy-hashtags-${variant.id}`}
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {variant.hashtagsJson.map((tag, idx) => (
                            <Badge key={idx} variant="secondary" className="text-xs">
                              {typeof tag === 'string' ? tag : (tag as any).tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Emojis */}
                    {variant.emojisJson && variant.emojisJson.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Label className="text-sm font-medium">Emojis</Label>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => copyToClipboard(variant.emojisJson?.join(' ') || '', "Emojis")}
                            data-testid={`button-copy-emojis-${variant.id}`}
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {variant.emojisJson.map((emoji, idx) => (
                            <Badge key={idx} variant="secondary" className="text-xs">
                              {emoji}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Variant Actions */}
                    <div className="flex flex-col gap-3">
                      {/* Quick Share Button */}
                      <Button
                        variant="default"
                        className="w-full"
                        onClick={() => handleQuickShare(
                          variant.platform,
                          variant.caption,
                          variant.hashtags || variant.hashtagsJson?.join(' ') || ''
                        )}
                        disabled={variant.status !== "READY"}
                        data-testid={`button-quick-share-${variant.id}`}
                      >
                        {['instagram'].includes(variant.platform.toLowerCase()) ? (
                          <>
                            <Copy className="w-4 h-4 mr-2" />
                            Copy & Open {variant.platform}
                          </>
                        ) : (
                          <>
                            <Share2 className="w-4 h-4 mr-2" />
                            Quick Share to {variant.platform}
                          </>
                        )}
                      </Button>
                      
                      {/* Secondary Actions */}
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={() => {
                            setRegeneratingVariants(prev => new Set(prev).add(variant.id));
                            regenerateVariantMutation.mutate(variant.id);
                          }}
                          disabled={regeneratingVariants.has(variant.id) || variant.status === "GENERATING"}
                          data-testid={`button-regenerate-variant-${variant.id}`}
                        >
                          {regeneratingVariants.has(variant.id) ? (
                            <>
                              <LoaderIcon className="w-4 h-4 mr-2 animate-spin" />
                              Regenerating...
                            </>
                          ) : (
                            <>
                              <RefreshCw className="w-4 h-4 mr-2" />
                              Regenerate
                            </>
                          )}
                        </Button>
                        {variant.imageUrl && (
                          <Button
                            variant="outline"
                            onClick={() => {
                              const link = document.createElement('a');
                              link.href = variant.imageUrl!;
                              link.download = `${variant.platform}-${variant.id}.png`;
                              link.click();
                            }}
                            data-testid={`button-download-image-${variant.id}`}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Share Helper Modal */}
        <Dialog open={shareModalOpen} onOpenChange={setShareModalOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Share2 className="w-5 h-5" />
                Share to {shareModalData?.platform}
              </DialogTitle>
              <DialogDescription>
                {shareModalData?.shareUrl
                  ? `Copy your full post, then paste it into the ${shareModalData.platform} dialog that opens.`
                  : `Copy your full post and paste it into the ${shareModalData?.platform} app.`}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="relative">
                <Textarea
                  readOnly
                  value={shareModalData?.fullText || ""}
                  className="min-h-[160px] text-sm resize-none pr-10"
                  data-testid="textarea-share-content"
                />
                <div className="absolute bottom-2 right-2 text-xs text-muted-foreground">
                  {shareModalData?.fullText?.length || 0} chars
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={handleCopyShareText}
                data-testid="button-copy-share-text"
              >
                {shareCopied ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2 text-green-500" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-2" />
                    Copy Full Post
                  </>
                )}
              </Button>

              {shareModalData?.shareUrl ? (
                <div className="bg-muted rounded-md p-3 text-sm text-muted-foreground">
                  <strong className="text-foreground">Tip:</strong> Click the button below to open {shareModalData.platform}. When the dialog appears, paste your copied content with <kbd className="bg-background border rounded px-1">Ctrl+V</kbd> (or <kbd className="bg-background border rounded px-1">⌘V</kbd> on Mac).
                </div>
              ) : (
                <div className="bg-muted rounded-md p-3 text-sm text-muted-foreground">
                  <strong className="text-foreground">Note:</strong> {shareModalData?.platform} doesn't support web sharing. Copy the post above and paste it directly in the {shareModalData?.platform} app.
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 flex-wrap">
              <Button variant="outline" onClick={() => setShareModalOpen(false)} data-testid="button-share-cancel">
                Cancel
              </Button>
              {shareModalData?.shareUrl && (
                <Button onClick={handleOpenPlatform} data-testid="button-open-platform">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open {shareModalData.platform}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Post?</DialogTitle>
              <DialogDescription>
                This will permanently delete this social media post and all its platform variants. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} data-testid="button-cancel-delete">
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  deleteMutation.mutate();
                  setDeleteDialogOpen(false);
                }}
                disabled={deleteMutation.isPending}
                data-testid="button-confirm-delete"
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Schedule Dialog */}
        <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Schedule Post</DialogTitle>
              <DialogDescription>
                Choose when you want to publish this post to your social media accounts.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="schedule-date">Date</Label>
                <Input
                  id="schedule-date"
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  data-testid="input-schedule-date"
                />
              </div>
              <div>
                <Label htmlFor="schedule-time">Time</Label>
                <Input
                  id="schedule-time"
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  data-testid="input-schedule-time"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setScheduleDialogOpen(false)} data-testid="button-cancel-schedule">
                Cancel
              </Button>
              <Button
                onClick={handleSchedule}
                disabled={scheduleMutation.isPending || !scheduleDate || !scheduleTime}
                data-testid="button-confirm-schedule"
              >
                {scheduleMutation.isPending ? "Scheduling..." : "Schedule"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit Post Details</DialogTitle>
              <DialogDescription>
                Update the post information. Note: This will not regenerate existing content.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="edit-title">Title</Label>
                <Input
                  id="edit-title"
                  value={editFormData.title}
                  onChange={(e) => setEditFormData({ ...editFormData, title: e.target.value })}
                  data-testid="input-edit-title"
                />
              </div>
              <div>
                <Label htmlFor="edit-topic">Topic</Label>
                <Input
                  id="edit-topic"
                  value={editFormData.topic}
                  onChange={(e) => setEditFormData({ ...editFormData, topic: e.target.value })}
                  data-testid="input-edit-topic"
                />
              </div>
              <div>
                <Label htmlFor="edit-company">Company Name *</Label>
                <Input
                  id="edit-company"
                  value={editFormData.companyName}
                  onChange={(e) => setEditFormData({ ...editFormData, companyName: e.target.value })}
                  placeholder="Required for video generation"
                  data-testid="input-edit-company"
                />
              </div>
              <div>
                <Label htmlFor="edit-location">Location *</Label>
                <Input
                  id="edit-location"
                  value={editFormData.location}
                  onChange={(e) => setEditFormData({ ...editFormData, location: e.target.value })}
                  placeholder="e.g., San Francisco, CA"
                  data-testid="input-edit-location"
                />
              </div>
              <div>
                <Label htmlFor="edit-industry">Industry</Label>
                <Input
                  id="edit-industry"
                  value={editFormData.industry}
                  onChange={(e) => setEditFormData({ ...editFormData, industry: e.target.value })}
                  data-testid="input-edit-industry"
                />
              </div>
              <div>
                <Label>Company Logo (Optional)</Label>
                <div className="space-y-3 mt-2">
                  {/* Show file input when: no preview AND (no existing logo OR user removed existing logo) */}
                  {!editLogoPreview && (!post?.companyLogoUrl || removeExistingLogo) && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="file"
                        accept="image/*"
                        onChange={handleEditLogoSelect}
                        disabled={logoUploading}
                        data-testid="input-edit-logo-upload"
                        className="flex-1"
                      />
                      {logoUploading && <LoaderIcon className="w-4 h-4 animate-spin" />}
                    </div>
                  )}
                  
                  {/* Show preview when: there's a new preview OR (existing logo AND user hasn't removed it) */}
                  {(editLogoPreview || (post?.companyLogoUrl && !removeExistingLogo)) && (
                    <div className="relative inline-block">
                      <div className="w-32 h-32 border-2 border-dashed border-border rounded-lg overflow-hidden bg-muted flex items-center justify-center">
                        <img 
                          src={editLogoPreview || post?.companyLogoUrl || ""} 
                          alt="Logo preview" 
                          className="max-w-full max-h-full object-contain"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
                        onClick={removeEditLogoFile}
                        data-testid="button-remove-edit-logo"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                  
                  <p className="text-sm text-muted-foreground">
                    Upload your company logo for video branding (PNG/JPG, max 5MB)
                  </p>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)} data-testid="button-cancel-edit">
                Cancel
              </Button>
              <Button
                onClick={() => updateMutation.mutate(editFormData)}
                disabled={updateMutation.isPending || !editFormData.location}
                data-testid="button-save-edit"
              >
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
