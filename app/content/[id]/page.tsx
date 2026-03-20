"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import { use, useState, useRef, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Download, Edit, Save, X, Trash2, Home, ArrowLeft, Copy, Check, RefreshCw, Image as ImageIcon, Mic2, Play, AlertCircle, ExternalLink as ExternalLinkIcon, Share2, Plus, Link as LinkIcon, Hash, ChevronDown, Stethoscope } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PublishDialog } from "@/components/PublishDialog";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RichTextEditor } from "@/components/RichTextEditor";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

interface ArticleAsset {
  id: number;
  url: string;
  altText: string;
  prompt: string;
  format: string;
}

interface ErrorLog {
  id: number;
  errorType: string;
  errorMessage: string;
  severity: string;
  createdAt: string;
}

interface Article {
  id: number;
  batchId: number;
  targetUrl: string | null;
  status: string;
  title: string;
  heroImageUrl: string | null;
  seoTitle: string | null;
  metaDescription: string | null;
  slug: string | null;
  keywords: string[] | null;
  hashtags: string[] | null;
  faq: Array<{ question: string; answer: string }> | null;
  wordCount: number | null;
  htmlContent: string | null;
  finalHtmlContent: string | null;
  seoScore: number | null;
  hyperlinkedKeywords: any[] | null;
  metaEnrichment: any | null;
  podcastUrl: string | null;
  podcastDuration: number | null;
  podcastStatus: string | null;
  podcastGeneratedAt: string | null;
  podcastScriptJson: any | null;
  businessName: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SocialPostVariant {
  id: number;
  platform: string;
  caption: string;
  hashtagsJson?: string[];
  emojisJson?: string[];
}

interface SocialPost {
  id: number;
  topic: string;
  title: string;
  location: string;
  platformsJson: string[];
  createdAt: string;
  variants: SocialPostVariant[];
}

interface ArticleResponse {
  article: Article;
  assets: ArticleAsset[];
  errors?: ErrorLog[];
}

export default function ArticleDetail({ params }: { params: Promise<{ id: string }> }) {
  const { toast } = useToast();
  const router = useRouter();
  const resolvedParams = use(params);
  const articleId = resolvedParams.id;
  
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [editedSeoTitle, setEditedSeoTitle] = useState("");
  const [editedMetaDescription, setEditedMetaDescription] = useState("");
  const [editedSlug, setEditedSlug] = useState("");
  const [editedContent, setEditedContent] = useState("");
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [regeneratingField, setRegeneratingField] = useState<string | null>(null);
  const [heroImagePrompt, setHeroImagePrompt] = useState("");
  const [generatingHeroImage, setGeneratingHeroImage] = useState(false);
  const [regeneratingImageId, setRegeneratingImageId] = useState<number | null>(null);
  const [generatingPodcast, setGeneratingPodcast] = useState(false);
  const [podcastStatusPolling, setPodcastStatusPolling] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [viewMode, setViewMode] = useState<'preview' | 'html'>('preview');
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false);
  const [customInstructions, setCustomInstructions] = useState("");
  const [editingPromptId, setEditingPromptId] = useState<number | null>(null);
  const [healingHyperlinks, setHealingHyperlinks] = useState(false);
  const [editedPrompts, setEditedPrompts] = useState<Record<number, string>>({});
  const [copiedPodcastEmbed, setCopiedPodcastEmbed] = useState(false);
  const [copiedPodcastLink, setCopiedPodcastLink] = useState(false);
  
  // Hyperlink management state
  const [isEditingHyperlinks, setIsEditingHyperlinks] = useState(false);
  const [editedHyperlinks, setEditedHyperlinks] = useState<any[]>([]);
  const [newHyperlinkPhrase, setNewHyperlinkPhrase] = useState("");
  const [newHyperlinkUrl, setNewHyperlinkUrl] = useState("");
  const [newHyperlinkType, setNewHyperlinkType] = useState<"internal" | "external">("external");
  const [savingHyperlinks, setSavingHyperlinks] = useState(false);
  const [editingHyperlinkIndex, setEditingHyperlinkIndex] = useState<number | null>(null);
  
  // Hashtag management state - hashtags are stored as objects with optional URL
  const [isEditingHashtags, setIsEditingHashtags] = useState(false);
  const [editedHashtags, setEditedHashtags] = useState<Array<{ tag: string; url?: string }>>([]);
  const [newHashtag, setNewHashtag] = useState("");
  const [newHashtagUrl, setNewHashtagUrl] = useState("");
  const [savingHashtags, setSavingHashtags] = useState(false);

  // Update playback rate when it changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Function to inject audio player into article content
  const injectAudioPlayer = (htmlContent: string, podcastUrl: string, duration: number | null) => {
    // Generate stable ID once to ensure audio element and controls reference the same element
    const audioId = `podcast-audio-${articleId}`;
    
    const audioPlayerHTML = `
      <div style="margin: 2rem 0; padding: 1.5rem; background: hsl(var(--muted)); border-radius: 0.5rem; border: 1px solid hsl(var(--border));">
        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem;">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: hsl(var(--primary));"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" x2="12" y1="19" y2="22"></line></svg>
          <strong style="color: hsl(var(--foreground));">🎧 Listen to this Article</strong>
          ${duration ? `<span style="margin-left: auto; font-size: 0.875rem; color: hsl(var(--muted-foreground));">${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}</span>` : ''}
        </div>
        <audio controls style="width: 100%; margin-bottom: 0.75rem;" id="${audioId}">
          <source src="${podcastUrl}" type="audio/mpeg" />
          Your browser does not support the audio element.
        </audio>
        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
          <span style="font-size: 0.75rem; color: hsl(var(--muted-foreground));">Speed:</span>
          ${[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map(rate => `
            <button 
              onclick="document.getElementById('${audioId}').playbackRate=${rate}; event.target.parentElement.querySelectorAll('button').forEach(b => b.style.background='transparent'); event.target.style.background='hsl(var(--primary))'; event.target.style.color='hsl(var(--primary-foreground))';"
              style="padding: 0.25rem 0.5rem; font-size: 0.75rem; border: 1px solid hsl(var(--border)); border-radius: 0.25rem; cursor: pointer; background: ${rate === 1.0 ? 'hsl(var(--primary))' : 'transparent'}; color: ${rate === 1.0 ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))'}; transition: all 0.2s;">
              ${rate}x
            </button>
          `).join('')}
        </div>
      </div>
    `;

    // Inject after first paragraph or at the start
    const firstParagraphMatch = htmlContent.match(/<\/p>/i);
    if (firstParagraphMatch && firstParagraphMatch.index) {
      return htmlContent.slice(0, firstParagraphMatch.index + 4) + audioPlayerHTML + htmlContent.slice(firstParagraphMatch.index + 4);
    }
    
    // Fallback: inject at the beginning
    return audioPlayerHTML + htmlContent;
  };

  const { data, isLoading, error } = useQuery<ArticleResponse>({
    queryKey: [`/api/content/${articleId}`],
  });

  const { data: socialPostsData, isLoading: socialPostsLoading } = useQuery<{ posts: SocialPost[], count: number }>({
    queryKey: [`/api/articles/${articleId}/social-posts`],
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: {
      htmlContent?: string;
      title?: string;
      seoTitle?: string;
      metaDescription?: string;
      slug?: string;
    }) => {
      return await apiRequest(`/api/content/${articleId}/update`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/content/${articleId}`] });
      setIsEditing(false);
      toast({
        title: "Article updated",
        description: "Your changes have been saved successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : "Failed to update article",
        variant: "destructive",
      });
    },
  });

  // Hyperlink management functions
  const startEditingHyperlinks = () => {
    setEditedHyperlinks(JSON.parse(JSON.stringify(data?.article.hyperlinkedKeywords || [])));
    setIsEditingHyperlinks(true);
    setEditingHyperlinkIndex(null);
  };

  const cancelEditingHyperlinks = () => {
    setIsEditingHyperlinks(false);
    setEditedHyperlinks([]);
    setEditingHyperlinkIndex(null);
    setNewHyperlinkPhrase("");
    setNewHyperlinkUrl("");
    setNewHyperlinkType("external");
  };

  const addHyperlink = () => {
    if (!newHyperlinkPhrase.trim() || !newHyperlinkUrl.trim()) {
      toast({
        title: "Missing information",
        description: "Please enter both a keyword phrase and URL",
        variant: "destructive",
      });
      return;
    }
    
    const newLink = {
      phrase: newHyperlinkPhrase.trim(),
      anchorText: newHyperlinkPhrase.trim(),
      url: newHyperlinkUrl.trim(),
      type: newHyperlinkType,
    };
    
    setEditedHyperlinks([...editedHyperlinks, newLink]);
    setNewHyperlinkPhrase("");
    setNewHyperlinkUrl("");
    setNewHyperlinkType("external");
  };

  const updateHyperlink = (index: number, field: 'phrase' | 'url' | 'type', value: string) => {
    const updated = [...editedHyperlinks];
    updated[index] = { ...updated[index], [field]: value };
    if (field === 'phrase') {
      updated[index].anchorText = value;
    }
    setEditedHyperlinks(updated);
  };

  const removeHyperlink = (index: number) => {
    setEditedHyperlinks(editedHyperlinks.filter((_, i) => i !== index));
  };

  const saveHyperlinks = async () => {
    setSavingHyperlinks(true);
    try {
      await apiRequest(`/api/content/${articleId}/update`, {
        method: "PATCH",
        body: JSON.stringify({ hyperlinkedKeywords: editedHyperlinks }),
      });
      
      queryClient.invalidateQueries({ queryKey: [`/api/content/${articleId}`] });
      setIsEditingHyperlinks(false);
      toast({
        title: "Hyperlinks saved",
        description: `${editedHyperlinks.length} hyperlinks saved successfully`,
      });
    } catch (error) {
      toast({
        title: "Failed to save hyperlinks",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSavingHyperlinks(false);
    }
  };

  // Hashtag management functions
  // Hashtags are stored as objects with { tag, url? } to support per-hashtag URLs
  const startEditingHashtags = () => {
    const currentHashtags = data?.article.hashtags || [];
    // Handle both old format (string[]) and new format (object[])
    const normalized = currentHashtags.map((h: string | { tag: string; url?: string }) => {
      if (typeof h === 'string') {
        return { tag: h, url: undefined };
      }
      return { tag: h.tag, url: h.url };
    });
    setEditedHashtags(JSON.parse(JSON.stringify(normalized)));
    setIsEditingHashtags(true);
  };

  const cancelEditingHashtags = () => {
    setIsEditingHashtags(false);
    setEditedHashtags([]);
    setNewHashtag("");
    setNewHashtagUrl("");
  };

  const addHashtag = () => {
    if (!newHashtag.trim()) {
      toast({
        title: "Missing hashtag",
        description: "Please enter a hashtag",
        variant: "destructive",
      });
      return;
    }
    
    let tagValue = newHashtag.trim();
    if (!tagValue.startsWith("#")) {
      tagValue = "#" + tagValue;
    }
    
    const newEntry = {
      tag: tagValue,
      url: newHashtagUrl.trim() || undefined,
    };
    
    setEditedHashtags([...editedHashtags, newEntry]);
    setNewHashtag("");
    setNewHashtagUrl("");
  };

  const removeHashtag = (index: number) => {
    setEditedHashtags(editedHashtags.filter((_, i) => i !== index));
  };

  const updateHashtagUrl = (index: number, url: string) => {
    const updated = [...editedHashtags];
    updated[index] = { ...updated[index]!, url: url.trim() || undefined };
    setEditedHashtags(updated);
  };

  const saveHashtags = async () => {
    setSavingHashtags(true);
    try {
      // Save hashtags as objects with URL support
      // Format: [{ tag: "#example", url: "https://..." }, ...]
      await apiRequest(`/api/content/${articleId}/update`, {
        method: "PATCH",
        body: JSON.stringify({ hashtags: editedHashtags }),
      });
      
      queryClient.invalidateQueries({ queryKey: [`/api/content/${articleId}`] });
      setIsEditingHashtags(false);
      toast({
        title: "Hashtags saved",
        description: `${editedHashtags.length} hashtags saved successfully`,
      });
    } catch (error) {
      toast({
        title: "Failed to save hashtags",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSavingHashtags(false);
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/articles/${articleId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      toast({
        title: "Article deleted",
        description: "Article has been permanently removed from the system.",
      });
      router.push("/content");
    },
    onError: (error) => {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Failed to delete article",
        variant: "destructive",
      });
    },
  });

  const regenerateArticleMutation = useMutation({
    mutationFn: async (customInstructions: string) => {
      return await apiRequest(`/api/articles/${articleId}/regenerate`, {
        method: "POST",
        body: JSON.stringify({ customInstructions: customInstructions || undefined }),
      });
    },
    onSuccess: () => {
      setShowRegenerateDialog(false);
      setCustomInstructions("");
      toast({
        title: "Article regeneration started",
        description: "Your article is being regenerated. This may take a few minutes.",
      });
      
      const pollInterval = setInterval(async () => {
        try {
          const token = localStorage.getItem("auth_token");
          const response = await fetch(`/api/content/${articleId}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          const data = await response.json();
          
          if (['COMPLETE', 'COMPLETED', 'GPT4_ENHANCED', 'CHATGPT_REVIEWED', 'GEMINI_COMPLETE'].includes(data.article.status)) {
            clearInterval(pollInterval);
            queryClient.invalidateQueries({ queryKey: [`/api/content/${articleId}`] });
            toast({
              title: "Article regenerated!",
              description: "Your article has been successfully regenerated.",
            });
          } else if (data.article.status === 'FAILED') {
            clearInterval(pollInterval);
            toast({
              title: "Regeneration failed",
              description: "Failed to regenerate article. Please try again.",
              variant: "destructive",
            });
          }
        } catch (error) {
          clearInterval(pollInterval);
        }
      }, 3000);
      
      setTimeout(() => {
        clearInterval(pollInterval);
      }, 300000);
    },
    onError: (error) => {
      toast({
        title: "Regeneration failed",
        description: error instanceof Error ? error.message : "Failed to start article regeneration",
        variant: "destructive",
      });
    },
  });

  const handleEdit = () => {
    if (!data) return;
    setEditedTitle(data.article.title);
    setEditedSeoTitle(data.article.seoTitle || "");
    setEditedMetaDescription(data.article.metaDescription || "");
    setEditedSlug(data.article.slug || "");
    setEditedContent(data.article.htmlContent || "");
    setIsEditing(true);
  };

  const handleSave = () => {
    updateMutation.mutate({
      htmlContent: editedContent,
      title: editedTitle,
      seoTitle: editedSeoTitle,
      metaDescription: editedMetaDescription,
      slug: editedSlug,
    });
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedTitle("");
    setEditedSeoTitle("");
    setEditedMetaDescription("");
    setEditedSlug("");
    setEditedContent("");
  };

  const handleExport = () => {
    if (!data) return;

    const exportData = {
      article: data.article,
      assets: data.assets,
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `article-${articleId}.json`;
    a.click();
    URL.revokeObjectURL(url);

    toast({
      title: "Article exported",
      description: "JSON file downloaded successfully.",
    });
  };

  const copyToClipboard = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 2000);
      toast({
        title: "Copied to clipboard",
        description: `${fieldName} copied successfully.`,
      });
    } catch (error) {
      toast({
        title: "Copy failed",
        description: "Failed to copy to clipboard.",
        variant: "destructive",
      });
    }
  };

  const copyArticleWithLinks = async (htmlContent: string) => {
    try {
      // Create a temporary div to parse the HTML
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = htmlContent;
      
      // Get plain text for fallback
      const plainText = tempDiv.innerText || tempDiv.textContent || '';
      
      // Copy both HTML (for rich text editors) and plain text (for fallback)
      const clipboardData = new ClipboardItem({
        'text/html': new Blob([htmlContent], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' })
      });
      
      await navigator.clipboard.write([clipboardData]);
      
      setCopiedField('full-article');
      setTimeout(() => setCopiedField(null), 2000);
      
      toast({
        title: "Copied to clipboard",
        description: "Full article with links copied! Paste into Word, Docs, or email.",
      });
    } catch (error) {
      // Fallback for browsers that don't support ClipboardItem
      try {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlContent;
        const plainText = tempDiv.innerText || tempDiv.textContent || '';
        await navigator.clipboard.writeText(plainText);
        
        setCopiedField('full-article');
        setTimeout(() => setCopiedField(null), 2000);
        
        toast({
          title: "Copied as plain text",
          description: "Article copied (links converted to plain text).",
        });
      } catch (fallbackError) {
        toast({
          title: "Copy failed",
          description: "Failed to copy to clipboard.",
          variant: "destructive",
        });
      }
    }
  };

  const regenerateField = async (fieldType: string) => {
    setRegeneratingField(fieldType);
    try {
      const response = await apiRequest(`/api/content/${articleId}/regenerate/${fieldType}`, {
        method: "POST",
      });
      
      // Update the query cache with the new value immediately
      // Use functional updater to avoid clobbering concurrent updates
      if (response) {
        const fieldMap: Record<string, string> = {
          "keywords": "keywords",
          "seo-title": "seoTitle",
          "meta-description": "metaDescription",
          "slug": "slug",
          "hashtags": "hashtags",
          "faq": "faqHtml"
        };
        
        const dbFieldName = fieldMap[fieldType];
        const responseFieldName = fieldType === "seo-title" ? "seoTitle" : 
                                  fieldType === "meta-description" ? "metaDescription" : 
                                  fieldType === "faq" ? "faqHtml" : fieldType;
        
        if (dbFieldName && response[responseFieldName] !== undefined) {
          // Optimistically update the cache using functional updater
          queryClient.setQueryData(
            [`/api/content/${articleId}`],
            (prev: any) => {
              if (!prev) return prev;
              return {
                ...prev,
                [dbFieldName]: response[responseFieldName]
              };
            }
          );
        }
      }
      
      // Also invalidate to fetch fresh data
      queryClient.invalidateQueries({ queryKey: [`/api/content/${articleId}`] });
      
      const displayName = fieldType.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
      
      toast({
        title: "Regenerated successfully ✓",
        description: `${displayName} has been updated using AI.`,
      });
    } catch (error) {
      const displayName = fieldType.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
      
      toast({
        title: `${displayName} regeneration failed`,
        description: error instanceof Error ? error.message : "An error occurred during regeneration",
        variant: "destructive",
      });
      
      console.error(`Failed to regenerate ${fieldType}:`, error);
    } finally {
      setRegeneratingField(null);
    }
  };

  const generatePodcast = async () => {
    setGeneratingPodcast(true);
    try {
      await apiRequest(`/api/podcast/generate`, {
        method: "POST",
        body: JSON.stringify({ articleId: Number(articleId) }),
      });
      
      toast({
        title: "Podcast generation started",
        description: "Your podcast is being generated. This may take a few minutes.",
      });
      
      setPodcastStatusPolling(true);
      const pollInterval = setInterval(async () => {
        try {
          const token = localStorage.getItem("auth_token");
          const statusResponse = await fetch(`/api/podcast/status/${articleId}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          const status = await statusResponse.json();
          
          if (status.status === 'ready') {
            clearInterval(pollInterval);
            setPodcastStatusPolling(false);
            queryClient.invalidateQueries({ queryKey: [`/api/content/${articleId}`] });
            toast({
              title: "Podcast ready!",
              description: "Your podcast has been generated successfully.",
            });
          } else if (status.status === 'failed') {
            clearInterval(pollInterval);
            setPodcastStatusPolling(false);
            toast({
              title: "Podcast generation failed",
              description: "Failed to generate podcast. Please try again.",
              variant: "destructive",
            });
          }
        } catch (error) {
          clearInterval(pollInterval);
          setPodcastStatusPolling(false);
        }
      }, 3000);
      
      setTimeout(() => {
        clearInterval(pollInterval);
        setPodcastStatusPolling(false);
      }, 300000);
      
    } catch (error) {
      toast({
        title: "Generation failed",
        description: error instanceof Error ? error.message : "Failed to start podcast generation",
        variant: "destructive",
      });
    } finally {
      setGeneratingPodcast(false);
    }
  };

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
            <CardTitle>Article not found</CardTitle>
            <CardDescription>The requested article could not be loaded.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const { article, assets, errors = [] } = data;
  const brandErrors = errors.filter((e: any) => e.errorType === 'BRAND_VALIDATION');
  const hasBrandError = article.status === 'FAILED' && brandErrors.length > 0;

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex gap-2">
            <Link href="/content">
              <Button variant="outline" className="border-primary text-primary hover:bg-primary hover:text-primary-foreground" data-testid="button-back">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Library
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

        {/* Brand Validation Error Alert */}
        {hasBrandError && (
          <Alert variant="destructive" data-testid="alert-brand-error">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Company Name Misspelling Detected</AlertTitle>
            <AlertDescription className="mt-2 space-y-2">
              <p className="font-medium">The AI misspelled your company name in this article:</p>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {brandErrors.map((err: any) => (
                  <li key={err.id}>{err.errorMessage}</li>
                ))}
              </ul>
              <div className="mt-4 p-3 bg-muted rounded-md">
                <p className="text-sm font-medium mb-2">✅ To fix this:</p>
                <ol className="text-sm space-y-1 ml-4 list-decimal">
                  <li>Click the <strong>"Regenerate"</strong> button below</li>
                  <li>In the dialog, add: <em>"Make sure to spell {article.businessName} correctly"</em></li>
                  <li>The article will be regenerated with proper spelling</li>
                </ol>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            {isEditing ? (
              <div className="space-y-2">
                <Label htmlFor="edit-title">Article Title</Label>
                <Input
                  id="edit-title"
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  data-testid="input-edit-title"
                  className="text-2xl font-bold"
                />
              </div>
            ) : (
              <>
                <h1 className="text-3xl font-bold mb-2" data-testid="text-article-title">{article.title}</h1>
                <Badge data-testid="badge-article-status">{article.status}</Badge>
              </>
            )}
          </div>
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <Button 
                  onClick={handleSave} 
                  disabled={updateMutation.isPending}
                  data-testid="button-save"
                >
                  {updateMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  Save
                </Button>
                <Button 
                  onClick={handleCancel} 
                  variant="outline"
                  disabled={updateMutation.isPending}
                  data-testid="button-cancel"
                >
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button onClick={handleEdit} data-testid="button-edit">
                  <Edit className="w-4 h-4 mr-2" />
                  Edit
                </Button>
                <Button 
                  onClick={() => setShowRegenerateDialog(true)} 
                  variant="outline"
                  data-testid="button-regenerate-article"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Regenerate
                </Button>
                <Button onClick={handleExport} variant="outline" data-testid="button-export">
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </Button>
                <PublishDialog
                  contentId={Number(articleId)}
                  contentType="article"
                  contentTitle={article.title}
                  disabled={!['COMPLETE', 'GPT4_ENHANCED', 'CHATGPT_REVIEWED', 'GEMINI_COMPLETE', 'COMPLETED'].includes(article.status)}
                />
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" data-testid="button-delete-article">
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Article Permanently?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete this article and all associated data from the system. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteMutation.mutate()}
                        disabled={deleteMutation.isPending}
                        data-testid="button-confirm-delete"
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Delete Permanently
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        </div>

        {/* AI Podcast Player */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Mic2 className="w-5 h-5 text-primary" />
                AI Podcast Summary
              </CardTitle>
              <div className="flex gap-2">
                {article.podcastUrl && article.podcastStatus === 'ready' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={generatePodcast}
                      disabled={generatingPodcast || podcastStatusPolling}
                      data-testid="button-regenerate-podcast"
                    >
                      {generatingPodcast || podcastStatusPolling ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3 mr-1" />
                      )}
                      Regenerate
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          const fullPodcastUrl = article.podcastUrl!.startsWith('/') 
                            ? `${window.location.origin}${article.podcastUrl}`
                            : article.podcastUrl!;
                          
                          await navigator.clipboard.writeText(fullPodcastUrl);
                          setCopiedPodcastLink(true);
                          setTimeout(() => setCopiedPodcastLink(false), 2000);
                          
                          toast({
                            title: "Link copied!",
                            description: "Direct podcast URL copied to clipboard.",
                          });
                        } catch (error) {
                          toast({
                            title: "Copy failed",
                            description: "Failed to copy link to clipboard",
                            variant: "destructive",
                          });
                        }
                      }}
                      data-testid="button-copy-podcast-link"
                    >
                      {copiedPodcastLink ? (
                        <Check className="w-3 h-3 mr-1 text-green-600" />
                      ) : (
                        <Copy className="w-3 h-3 mr-1" />
                      )}
                      {copiedPodcastLink ? "Copied!" : "Copy Link"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          const fullPodcastUrl = article.podcastUrl!.startsWith('/') 
                            ? `${window.location.origin}${article.podcastUrl}`
                            : article.podcastUrl!;
                          
                          const embedCode = `<!-- ApexContent Podcast Player - ${article.title} -->
<div style="max-width: 600px; margin: 2rem auto; padding: 1.5rem; background: #f9fafb; border-radius: 0.5rem; border: 1px solid #e5e7eb; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
  <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem;">
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
      <line x1="12" x2="12" y1="19" y2="22"></line>
    </svg>
    <strong style="color: #111827; font-size: 1rem;">🎧 ${article.title}</strong>${article.podcastDuration ? `\n    <span style="margin-left: auto; font-size: 0.875rem; color: #6b7280;">${Math.floor(article.podcastDuration / 60)}:${String(Math.floor(article.podcastDuration % 60)).padStart(2, '0')}</span>` : ''}
  </div>
  <audio controls style="width: 100%;">
    <source src="${fullPodcastUrl}" type="audio/mpeg" />
    Your browser does not support the audio element.
  </audio>
  <p style="margin-top: 0.75rem; font-size: 0.875rem; color: #6b7280; text-align: center;">AI-generated podcast summary</p>
</div>`;
                          
                          await navigator.clipboard.writeText(embedCode);
                          setCopiedPodcastEmbed(true);
                          setTimeout(() => setCopiedPodcastEmbed(false), 2000);
                          
                          toast({
                            title: "Embed code copied!",
                            description: "Paste this HTML into any website to embed the podcast player.",
                          });
                        } catch (error) {
                          toast({
                            title: "Copy failed",
                            description: "Failed to copy embed code to clipboard",
                            variant: "destructive",
                          });
                        }
                      }}
                      data-testid="button-copy-podcast-embed"
                    >
                      {copiedPodcastEmbed ? (
                        <Check className="w-3 h-3 mr-1 text-green-600" />
                      ) : (
                        <Copy className="w-3 h-3 mr-1" />
                      )}
                      {copiedPodcastEmbed ? "Copied!" : "Copy Embed"}
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      onClick={async () => {
                        try {
                          const fetchUrl = article.podcastUrl!.startsWith('/') 
                            ? `${window.location.origin}${article.podcastUrl}`
                            : article.podcastUrl!;
                          
                          const response = await fetch(fetchUrl);
                          const blob = await response.blob();
                          const url = window.URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `podcast-${article.slug || articleId}.mp3`;
                          a.click();
                          window.URL.revokeObjectURL(url);
                          toast({
                            title: "Download started",
                            description: "Podcast is being downloaded.",
                          });
                        } catch (error) {
                          toast({
                            title: "Download failed",
                            description: "Failed to download podcast",
                            variant: "destructive",
                          });
                        }
                      }}
                      data-testid="button-download-podcast"
                    >
                      <Download className="w-3 h-3 mr-1" />
                      Download
                    </Button>
                  </>
                )}
              </div>
            </div>
            <CardDescription>
              Two-host conversational summary generated by AI
            </CardDescription>
          </CardHeader>
          <CardContent>
            {article.podcastUrl && article.podcastStatus === 'ready' ? (
              <div className="space-y-4">
                <audio
                  controls
                  className="w-full"
                  preload="metadata"
                  data-testid="audio-podcast-player"
                >
                  <source src={article.podcastUrl} type="audio/mpeg" />
                  Your browser does not support the audio element.
                </audio>
                {article.podcastDuration && (
                  <div className="text-sm text-muted-foreground">
                    Duration: {Math.floor(article.podcastDuration / 60)}:{String(article.podcastDuration % 60).padStart(2, '0')} minutes
                  </div>
                )}
              </div>
            ) : article.podcastStatus === 'processing' || article.podcastStatus === 'pending' || podcastStatusPolling ? (
              <div className="flex items-center justify-center py-8 space-x-3">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span className="text-muted-foreground">Generating AI podcast...</span>
              </div>
            ) : article.podcastStatus === 'failed' ? (
              <div className="space-y-3">
                <p className="text-sm text-destructive">Podcast generation failed. Please try again.</p>
                <Button
                  onClick={generatePodcast}
                  disabled={generatingPodcast}
                  data-testid="button-retry-podcast"
                >
                  {generatingPodcast ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Mic2 className="w-4 h-4 mr-2" />
                  )}
                  Retry Generation
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Generate a conversational podcast summary of this article with two AI hosts discussing the key points.
                </p>
                <Button
                  onClick={generatePodcast}
                  disabled={generatingPodcast}
                  data-testid="button-generate-podcast"
                >
                  {generatingPodcast ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Mic2 className="w-4 h-4 mr-2" />
                  )}
                  Generate Podcast
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Social Media Posts Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Share2 className="w-5 h-5 text-primary" />
                Social Media Posts ({socialPostsData?.count || 0})
              </CardTitle>
              <Link href={`/social/create?articleId=${articleId}`}>
                <Button size="sm" variant="default" data-testid="button-generate-social-post">
                  <Share2 className="w-4 h-4 mr-2" />
                  Generate Social Posts
                </Button>
              </Link>
            </div>
            <CardDescription>
              Social media content generated from this article
            </CardDescription>
          </CardHeader>
          <CardContent>
            {socialPostsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              </div>
            ) : socialPostsData && socialPostsData.posts.length > 0 ? (
              <div className="space-y-4">
                {socialPostsData.posts.map((post) => (
                  <div
                    key={post.id}
                    className="p-4 rounded-lg border hover-elevate"
                    data-testid={`social-post-item-${post.id}`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <h3 className="font-semibold mb-1" data-testid={`text-social-post-title-${post.id}`}>
                          {post.title}
                        </h3>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                          <Badge variant="secondary" data-testid={`text-social-post-location-${post.id}`}>
                            {post.location}
                          </Badge>
                          <span>•</span>
                          <span data-testid={`text-social-post-date-${post.id}`}>
                            {new Date(post.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {Array.isArray(post.platformsJson) ? post.platformsJson.map((platform) => (
                            <Badge key={platform} variant="outline" data-testid={`badge-platform-${platform}-${post.id}`}>
                              {platform}
                            </Badge>
                          )) : null}
                        </div>
                      </div>
                      <Link href={`/social/${post.id}`}>
                        <Button variant="outline" size="sm" data-testid={`button-view-social-${post.id}`}>
                          <ExternalLinkIcon className="w-4 h-4 mr-2" />
                          View Details
                        </Button>
                      </Link>
                    </div>
                    {post.variants && post.variants.length > 0 && (
                      <div className="mt-3 pt-3 border-t">
                        <p className="text-sm font-medium mb-2">Generated Variants ({post.variants.length})</p>
                        <div className="space-y-2">
                          {post.variants.slice(0, 2).map((variant) => (
                            <div
                              key={variant.id}
                              className="p-3 bg-muted rounded-lg text-sm"
                              data-testid={`social-variant-${variant.id}`}
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <Badge variant="default" className="text-xs" data-testid={`badge-variant-platform-${variant.id}`}>
                                  {variant.platform}
                                </Badge>
                              </div>
                              <p className="text-muted-foreground line-clamp-2" data-testid={`text-variant-caption-${variant.id}`}>
                                {variant.caption}
                              </p>
                              {variant.hashtagsJson && variant.hashtagsJson.length > 0 && (
                                <div className="flex gap-1 flex-wrap mt-2">
                                  {variant.hashtagsJson.slice(0, 3).map((tagItem, idx) => (
                                    <Badge key={idx} variant="secondary" className="text-xs">
                                      {typeof tagItem === 'string' ? tagItem : ((tagItem as any)?.tag || (tagItem as any)?.hashtag || JSON.stringify(tagItem))}
                                    </Badge>
                                  ))}
                                  {variant.hashtagsJson.length > 3 && (
                                    <Badge variant="secondary" className="text-xs">
                                      +{variant.hashtagsJson.length - 3} more
                                    </Badge>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                          {post.variants.length > 2 && (
                            <p className="text-xs text-muted-foreground text-center">
                              +{post.variants.length - 2} more variants
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 space-y-4">
                <Share2 className="w-12 h-12 mx-auto text-muted-foreground opacity-50" />
                <div>
                  <h3 className="font-semibold mb-2">No social media posts yet</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Generate social media content optimized for different platforms based on this article.
                  </p>
                  <Link href={`/social/create?articleId=${articleId}`}>
                    <Button data-testid="button-generate-first-social">
                      <Share2 className="w-4 h-4 mr-2" />
                      Generate Social Posts
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Hero Image Section - Prominent display with controls */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-primary" />
                Hero Image
              </CardTitle>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="default"
                  onClick={async () => {
                    setGeneratingHeroImage(true);
                    try {
                      const response = await apiRequest(`/api/articles/${articleId}/regenerate-hero`, {
                        method: "POST",
                      });
                      
                      // Wait for database to commit
                      await new Promise(resolve => setTimeout(resolve, 500));
                      
                      // Force refetch the article data to show new image
                      await queryClient.invalidateQueries({ queryKey: [`/api/content/${articleId}`] });
                      await queryClient.refetchQueries({ queryKey: [`/api/content/${articleId}`] });
                      
                      toast({
                        title: article.heroImageUrl ? "Hero image regenerated!" : "Hero image generated!",
                        description: "Your hero image is now ready.",
                      });
                    } catch (error) {
                      toast({
                        title: "Generation failed",
                        description: error instanceof Error ? error.message : "Failed to generate hero image",
                        variant: "destructive",
                      });
                    } finally {
                      setGeneratingHeroImage(false);
                    }
                  }}
                  disabled={generatingHeroImage}
                  data-testid="button-generate-hero"
                >
                  {generatingHeroImage ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : article.heroImageUrl ? (
                    <RefreshCw className="w-3 h-3 mr-1" />
                  ) : (
                    <ImageIcon className="w-3 h-3 mr-1" />
                  )}
                  {article.heroImageUrl ? 'Regenerate' : 'Generate'}
                </Button>
              {article.heroImageUrl && (
                <>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={async () => {
                      try {
                        // Handle both relative URLs (new format) and absolute URLs (old format)
                        const imageUrl = article.heroImageUrl!;
                        const fetchUrl = imageUrl.startsWith('/') 
                          ? `${window.location.origin}${imageUrl}`
                          : imageUrl;
                        
                        const response = await fetch(fetchUrl);
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `hero-image-${article.slug || articleId}.webp`;
                        a.click();
                        window.URL.revokeObjectURL(url);
                        toast({
                          title: "Download started",
                          description: "Hero image is being downloaded.",
                        });
                      } catch (error) {
                        toast({
                          title: "Download failed",
                          description: "Failed to download hero image",
                          variant: "destructive",
                        });
                      }
                    }}
                    data-testid="button-download-hero"
                  >
                    <Download className="w-3 h-3 mr-1" />
                    Download
                  </Button>
                </>
              )}
              </div>
            </div>
            <CardDescription>Featured article image displayed at the top</CardDescription>
          </CardHeader>
          <CardContent>
            {article.heroImageUrl ? (
              <div className="space-y-3">
                <div 
                  className="w-full overflow-hidden rounded-lg border shadow-md cursor-pointer hover-elevate transition-transform" 
                  data-testid="hero-image-container"
                  role="button"
                  tabIndex={0}
                  onClick={() => setLightboxImage(article.heroImageUrl)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setLightboxImage(article.heroImageUrl);
                    }
                  }}
                  aria-label="Click to view hero image in full size"
                >
                  <img
                    src={article.heroImageUrl}
                    alt={article.title}
                    className="w-full h-auto object-cover max-h-[500px]"
                    data-testid="hero-image-display"
                  />
                </div>
                {assets.find(a => a.url === article.heroImageUrl)?.prompt && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Image Prompt</Label>
                    <p className="text-sm p-2 bg-muted rounded border" data-testid="text-hero-prompt">
                      {assets.find(a => a.url === article.heroImageUrl)?.prompt}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12 border-2 border-dashed rounded-lg">
                <ImageIcon className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No Hero Image</h3>
                <p className="text-sm text-muted-foreground">
                  Hero image is being generated...
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Embed Code Section */}
        <Card>
          <CardHeader>
            <CardTitle>Embed This Article</CardTitle>
            <CardDescription>Copy this code to embed the article in WordPress, blogs, or any website</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Responsive Embed Code (Recommended)</Label>
              <div className="relative">
                <pre className="p-4 bg-muted rounded-lg text-xs overflow-x-auto border">
{`<div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden;">
  <iframe 
    src="${typeof window !== 'undefined' ? window.location.origin : ''}/embed/${articleId}" 
    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;"
    allowfullscreen
    loading="lazy"
  ></iframe>
</div>`}
                </pre>
                <Button
                  size="sm"
                  variant="outline"
                  className="absolute top-2 right-2"
                  onClick={() => {
                    const embedCode = `<div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden;">
  <iframe 
    src="${window.location.origin}/embed/${articleId}" 
    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;"
    allowfullscreen
    loading="lazy"
  ></iframe>
</div>`;
                    copyToClipboard(embedCode, 'Responsive Embed Code');
                  }}
                  data-testid="button-copy-responsive-embed"
                >
                  {copiedField === 'Responsive Embed Code' ? (
                    <Check className="w-3 h-3 mr-1" />
                  ) : (
                    <Copy className="w-3 h-3 mr-1" />
                  )}
                  Copy
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Fixed Height Embed (800px)</Label>
              <div className="relative">
                <pre className="p-4 bg-muted rounded-lg text-xs overflow-x-auto border">
{`<iframe 
  src="${typeof window !== 'undefined' ? window.location.origin : ''}/embed/${articleId}" 
  width="100%" 
  height="800" 
  frameborder="0"
  loading="lazy"
></iframe>`}
                </pre>
                <Button
                  size="sm"
                  variant="outline"
                  className="absolute top-2 right-2"
                  onClick={() => {
                    const embedCode = `<iframe src="${window.location.origin}/embed/${articleId}" width="100%" height="800" frameborder="0" loading="lazy"></iframe>`;
                    copyToClipboard(embedCode, 'Fixed Height Embed');
                  }}
                  data-testid="button-copy-fixed-embed"
                >
                  {copiedField === 'Fixed Height Embed' ? (
                    <Check className="w-3 h-3 mr-1" />
                  ) : (
                    <Copy className="w-3 h-3 mr-1" />
                  )}
                  Copy
                </Button>
              </div>
            </div>

            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground">
                <strong>Note:</strong> The responsive embed automatically adjusts to container width. 
                Perfect for WordPress, Medium, Substack, and most blog platforms.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>SEO Metadata</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isEditing ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="edit-seo-title">SEO Title</Label>
                  <Input
                    id="edit-seo-title"
                    value={editedSeoTitle}
                    onChange={(e) => setEditedSeoTitle(e.target.value)}
                    data-testid="input-edit-seo-title"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-meta-description">Meta Description</Label>
                  <Input
                    id="edit-meta-description"
                    value={editedMetaDescription}
                    onChange={(e) => setEditedMetaDescription(e.target.value)}
                    data-testid="input-edit-meta-description"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-slug">Slug</Label>
                  <Input
                    id="edit-slug"
                    value={editedSlug}
                    onChange={(e) => setEditedSlug(e.target.value)}
                    data-testid="input-edit-slug"
                    className="font-mono"
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">SEO Title</p>
                  <p className="text-sm" data-testid="text-seo-title">{article.seoTitle || "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Meta Description</p>
                  <p className="text-sm" data-testid="text-meta-description">{article.metaDescription || "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Slug</p>
                  <p className="text-sm font-mono" data-testid="text-slug">{article.slug || "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Word Count</p>
                  <p className="text-sm" data-testid="text-word-count">{article.wordCount || "N/A"}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* SEO Title Card */}
        {article.seoTitle && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">SEO Title</CardTitle>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => regenerateField("seo-title")}
                    disabled={regeneratingField === "seo-title"}
                    data-testid="button-regenerate-seo-title"
                  >
                    {regeneratingField === "seo-title" ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3 mr-1" />
                    )}
                    Refresh
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => copyToClipboard(article.seoTitle || "", "SEO Title")}
                    data-testid="button-copy-seo-title"
                  >
                    {copiedField === "SEO Title" ? (
                      <Check className="w-3 h-3 mr-1" />
                    ) : (
                      <Copy className="w-3 h-3 mr-1" />
                    )}
                    Copy
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="p-3 bg-muted rounded-md text-sm font-mono">
                {article.seoTitle}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Meta Description Card */}
        {article.metaDescription && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Meta Description</CardTitle>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => regenerateField("meta-description")}
                    disabled={regeneratingField === "meta-description"}
                    data-testid="button-regenerate-meta-description"
                  >
                    {regeneratingField === "meta-description" ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3 mr-1" />
                    )}
                    Refresh
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => copyToClipboard(article.metaDescription || "", "Meta Description")}
                    data-testid="button-copy-meta-description"
                  >
                    {copiedField === "Meta Description" ? (
                      <Check className="w-3 h-3 mr-1" />
                    ) : (
                      <Copy className="w-3 h-3 mr-1" />
                    )}
                    Copy
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="p-3 bg-muted rounded-md text-sm">
                {article.metaDescription}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Slug Card */}
        {article.slug && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">URL Slug</CardTitle>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => regenerateField("slug")}
                    disabled={regeneratingField === "slug"}
                    data-testid="button-regenerate-slug"
                  >
                    {regeneratingField === "slug" ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3 mr-1" />
                    )}
                    Refresh
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => copyToClipboard(article.slug || "", "Slug")}
                    data-testid="button-copy-slug"
                  >
                    {copiedField === "Slug" ? (
                      <Check className="w-3 h-3 mr-1" />
                    ) : (
                      <Copy className="w-3 h-3 mr-1" />
                    )}
                    Copy
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="p-3 bg-muted rounded-md text-sm font-mono">
                {article.slug}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Long-Phrase Keywords Card */}
        {article.keywords && article.keywords.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Long-Phrase Keywords (Showing {Math.min(10, article.keywords.length)})</CardTitle>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => regenerateField("keywords")}
                    disabled={regeneratingField === "keywords"}
                    data-testid="button-regenerate-keywords"
                  >
                    {regeneratingField === "keywords" ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3 mr-1" />
                    )}
                    Refresh
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => copyToClipboard(article.keywords?.slice(0, 10).join(", ") || "", "Long-Phrase Keywords")}
                    data-testid="button-copy-keywords"
                  >
                    {copiedField === "Long-Phrase Keywords" ? (
                      <Check className="w-3 h-3 mr-1" />
                    ) : (
                      <Copy className="w-3 h-3 mr-1" />
                    )}
                    Copy All
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {article.keywords.slice(0, 10).map((keyword, index) => (
                  <a
                    key={index}
                    href={article.targetUrl || `https://www.google.com/search?q=${encodeURIComponent(keyword)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block"
                    data-testid={`link-keyword-${index}`}
                  >
                    <Badge variant="secondary" className="text-xs hover-elevate cursor-pointer" data-testid={`badge-keyword-${index}`}>
                      {keyword}
                    </Badge>
                  </a>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                {article.targetUrl ? `Click any keyword to visit ${new URL(article.targetUrl).hostname}` : 'Click any keyword to search Google'}
              </p>
            </CardContent>
          </Card>
        )}


        {/* Hashtags Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Hash className="w-4 h-4" />
                Hashtags ({isEditingHashtags ? editedHashtags.length : (article.hashtags?.length || 0)})
              </CardTitle>
              <div className="flex gap-2">
                {!isEditingHashtags ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => regenerateField("hashtags")}
                      disabled={regeneratingField === "hashtags"}
                      data-testid="button-regenerate-hashtags"
                    >
                      {regeneratingField === "hashtags" ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3 mr-1" />
                      )}
                      Refresh
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={startEditingHashtags}
                      data-testid="button-edit-hashtags"
                    >
                      <Edit className="w-3 h-3 mr-1" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => copyToClipboard(article.hashtags?.join(" ") || "", "Hashtags")}
                      data-testid="button-copy-hashtags"
                    >
                      {copiedField === "Hashtags" ? (
                        <Check className="w-3 h-3 mr-1" />
                      ) : (
                        <Copy className="w-3 h-3 mr-1" />
                      )}
                      Copy All
                    </Button>
                  </>
                ) : (
                  <>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={cancelEditingHashtags}
                      data-testid="button-cancel-hashtags"
                    >
                      <X className="w-3 h-3 mr-1" />
                      Cancel
                    </Button>
                    <Button 
                      size="sm" 
                      onClick={saveHashtags}
                      disabled={savingHashtags}
                      data-testid="button-save-hashtags"
                    >
                      {savingHashtags ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <Save className="w-3 h-3 mr-1" />
                      )}
                      Save
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isEditingHashtags ? (
              <div className="space-y-4">
                <div className="p-4 border rounded-lg bg-muted/50 space-y-3">
                  <Label className="text-sm font-medium">Add New Hashtag</Label>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Hashtag</Label>
                      <Input
                        placeholder="#YourHashtag"
                        value={newHashtag}
                        onChange={(e) => setNewHashtag(e.target.value)}
                        data-testid="input-new-hashtag"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Link URL (optional)</Label>
                      <Input
                        placeholder="https://example.com"
                        value={newHashtagUrl}
                        onChange={(e) => setNewHashtagUrl(e.target.value)}
                        data-testid="input-hashtag-url"
                      />
                    </div>
                    <Button 
                      onClick={addHashtag} 
                      className="mt-5"
                      data-testid="button-add-hashtag"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Add
                    </Button>
                  </div>
                </div>
                
                {editedHashtags.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No hashtags yet. Add your first hashtag above.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {editedHashtags.map((item, index) => (
                      <div key={index} className="flex items-center gap-3 p-3 border rounded-lg" data-testid={`hashtag-edit-${index}`}>
                        <Badge variant="outline" className="text-primary border-primary">
                          {item.tag}
                        </Badge>
                        <div className="flex-1">
                          <Input
                            placeholder="Optional URL for this hashtag"
                            value={item.url || ""}
                            onChange={(e) => updateHashtagUrl(index, e.target.value)}
                            className="h-8 text-xs"
                            data-testid={`input-hashtag-url-${index}`}
                          />
                        </div>
                        <Button 
                          variant="ghost" 
                          size="icon"
                          onClick={() => removeHashtag(index)}
                          data-testid={`button-remove-hashtag-${index}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                {(!article.hashtags || article.hashtags.length === 0) ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No hashtags. Click Edit to add hashtags.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {article.hashtags.map((hashtagItem: string | { tag: string; url?: string }, index: number) => {
                      // Handle both string and object format hashtags
                      const hashtag = typeof hashtagItem === 'string' ? hashtagItem : hashtagItem.tag;
                      const customUrl = typeof hashtagItem === 'object' ? hashtagItem.url : undefined;
                      const hashtagText = hashtag.startsWith('#') ? hashtag.slice(1) : hashtag;
                      const targetHref = customUrl || article.targetUrl || `https://twitter.com/hashtag/${encodeURIComponent(hashtagText)}`;
                      
                      return (
                        <a
                          key={index}
                          href={targetHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block"
                          data-testid={`link-hashtag-${index}`}
                        >
                          <Badge 
                            variant="outline" 
                            className={`text-xs text-primary border-primary hover-elevate cursor-pointer ${customUrl ? 'ring-1 ring-primary/30' : ''}`}
                            data-testid={`badge-hashtag-${index}`}
                          >
                            {hashtag}
                            {customUrl && <ExternalLinkIcon className="w-3 h-3 ml-1" />}
                          </Badge>
                        </a>
                      );
                    })}
                  </div>
                )}
                {article.hashtags && article.hashtags.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-3">
                    Click hashtags to visit their linked URLs or Twitter/X
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* FAQ Card */}
        {article.faq && article.faq.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">FAQ ({article.faq.length} items)</CardTitle>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => regenerateField("faq")}
                    disabled={regeneratingField === "faq"}
                    data-testid="button-regenerate-faq"
                  >
                    {regeneratingField === "faq" ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3 mr-1" />
                    )}
                    Refresh
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => {
                      const faqText = (article.faq ?? [])
                        .map((item: any, i: number) => `Q${i + 1}: ${item.question}\nA${i + 1}: ${item.answer}`)
                        .join("\n\n");
                      copyToClipboard(faqText, "FAQ");
                    }}
                    data-testid="button-copy-faq"
                  >
                    {copiedField === "FAQ" ? (
                      <Check className="w-3 h-3 mr-1" />
                    ) : (
                      <Copy className="w-3 h-3 mr-1" />
                    )}
                    Copy All
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {article.faq.map((item: any, index: number) => (
                <div key={index} className="space-y-1 pb-3 border-b last:border-0">
                  <p className="text-sm font-semibold text-primary">Q: {item.question}</p>
                  <p className="text-sm text-muted-foreground">A: {item.answer}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {article.seoScore !== null && article.seoScore !== undefined && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                ChatGPT SEO Analysis
                <Badge variant={article.seoScore >= 70 ? "default" : article.seoScore >= 50 ? "secondary" : "destructive"} data-testid="badge-seo-score">
                  {article.seoScore}/100
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="h-2 bg-secondary rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all ${article.seoScore >= 70 ? 'bg-primary' : article.seoScore >= 50 ? 'bg-yellow-500' : 'bg-destructive'}`}
                      style={{ width: `${article.seoScore}%` }}
                    />
                  </div>
                </div>
                <span className="text-2xl font-bold" data-testid="text-seo-score">{article.seoScore}</span>
              </div>
              {article.metaEnrichment?.readability && (
                <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                  <div>
                    <p className="text-xs text-muted-foreground">Flesch Reading Ease</p>
                    <p className="text-sm font-medium">{article.metaEnrichment.readability.fleschScore}/100</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Grade Level</p>
                    <p className="text-sm font-medium">{article.metaEnrichment.readability.gradeLevel}</p>
                  </div>
                </div>
              )}
              {article.metaEnrichment?.localSignals && (
                <div className="grid grid-cols-3 gap-4 pt-2 border-t">
                  <div>
                    <p className="text-xs text-muted-foreground">NAP Mentions</p>
                    <p className="text-sm font-medium">{article.metaEnrichment.localSignals.napMentions}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Location Keywords</p>
                    <p className="text-sm font-medium">{article.metaEnrichment.localSignals.locationKeywords}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Geo Relevance</p>
                    <p className="text-sm font-medium">{article.metaEnrichment.localSignals.geoRelevance}/100</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {article.metaEnrichment?.hashtags && article.metaEnrichment.hashtags.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>AI-Generated Hashtags ({article.metaEnrichment.hashtags.length})</CardTitle>
              <CardDescription>Localized hashtags for social media distribution</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {article.metaEnrichment.hashtags.map((hashtag: string, index: number) => {
                  const hashtagText = hashtag.startsWith('#') ? hashtag.slice(1) : hashtag;
                  return (
                    <a
                      key={index}
                      href={article.targetUrl || `https://twitter.com/hashtag/${encodeURIComponent(hashtagText)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block"
                      data-testid={`link-enriched-hashtag-${index}`}
                    >
                      <Badge variant="outline" className="text-primary border-primary hover-elevate cursor-pointer" data-testid={`badge-enriched-hashtag-${index}`}>
                        {hashtag}
                      </Badge>
                    </a>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {article.targetUrl ? `Click any hashtag to visit ${new URL(article.targetUrl).hostname}` : 'Click any hashtag to view on Twitter/X'}
              </p>
              {article.metaEnrichment?.hashtagCategories && (
                <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                  {article.metaEnrichment.hashtagCategories.seo?.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">SEO Tags</p>
                      <div className="flex flex-wrap gap-1">
                        {article.metaEnrichment.hashtagCategories.seo.map((tag: string, i: number) => (
                          <Badge key={i} variant="secondary" className="text-xs">{tag}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {article.metaEnrichment.hashtagCategories.geo?.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">Geo Tags</p>
                      <div className="flex flex-wrap gap-1">
                        {article.metaEnrichment.hashtagCategories.geo.map((tag: string, i: number) => (
                          <Badge key={i} variant="secondary" className="text-xs">{tag}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {article.metaEnrichment.hashtagCategories.brand?.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">Brand Tags</p>
                      <div className="flex flex-wrap gap-1">
                        {article.metaEnrichment.hashtagCategories.brand.map((tag: string, i: number) => (
                          <Badge key={i} variant="secondary" className="text-xs">{tag}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {article.metaEnrichment.hashtagCategories.trending?.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">Trending Tags</p>
                      <div className="flex flex-wrap gap-1">
                        {article.metaEnrichment.hashtagCategories.trending.map((tag: string, i: number) => (
                          <Badge key={i} variant="secondary" className="text-xs">{tag}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {article.metaEnrichment?.socialSnippets && (
          <Card>
            <CardHeader>
              <CardTitle>Social Media Snippets</CardTitle>
              <CardDescription>Platform-optimized content with emojis</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {article.metaEnrichment.socialSnippets.openGraph && (
                <div className="space-y-2 p-3 border rounded-lg">
                  <p className="text-xs font-medium text-muted-foreground">OpenGraph (Facebook)</p>
                  <p className="text-sm font-semibold" data-testid="text-og-title">{article.metaEnrichment.socialSnippets.openGraph.title}</p>
                  <p className="text-xs text-muted-foreground" data-testid="text-og-description">{article.metaEnrichment.socialSnippets.openGraph.description}</p>
                </div>
              )}
              {article.metaEnrichment.socialSnippets.twitter && (
                <div className="space-y-2 p-3 border rounded-lg">
                  <p className="text-xs font-medium text-muted-foreground">Twitter/X</p>
                  <p className="text-sm font-semibold" data-testid="text-twitter-title">{article.metaEnrichment.socialSnippets.twitter.title}</p>
                  <p className="text-xs text-muted-foreground" data-testid="text-twitter-description">{article.metaEnrichment.socialSnippets.twitter.description}</p>
                </div>
              )}
              {article.metaEnrichment.socialSnippets.linkedin && (
                <div className="space-y-2 p-3 border rounded-lg">
                  <p className="text-xs font-medium text-muted-foreground">LinkedIn</p>
                  <p className="text-sm font-semibold" data-testid="text-linkedin-title">{article.metaEnrichment.socialSnippets.linkedin.title}</p>
                  <p className="text-xs text-muted-foreground" data-testid="text-linkedin-description">{article.metaEnrichment.socialSnippets.linkedin.description}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <LinkIcon className="w-4 h-4" />
                  Strategic Hyperlinks ({isEditingHyperlinks ? editedHyperlinks.length : (article.hyperlinkedKeywords?.length || 0)})
                </CardTitle>
                <CardDescription>Long-phrase keywords with clickable links for SEO</CardDescription>
              </div>
              {!isEditingHyperlinks ? (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={startEditingHyperlinks}
                  data-testid="button-edit-hyperlinks"
                >
                  <Edit className="w-4 h-4 mr-2" />
                  Edit
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={cancelEditingHyperlinks}
                    data-testid="button-cancel-hyperlinks"
                  >
                    <X className="w-4 h-4 mr-2" />
                    Cancel
                  </Button>
                  <Button 
                    size="sm" 
                    onClick={saveHyperlinks}
                    disabled={savingHyperlinks}
                    data-testid="button-save-hyperlinks"
                  >
                    {savingHyperlinks ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    Save
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isEditingHyperlinks ? (
              <div className="space-y-4">
                <div className="p-4 border rounded-lg bg-muted/50 space-y-3">
                  <Label className="text-sm font-medium">Add New Hyperlink</Label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Keyword Phrase</Label>
                      <Input
                        placeholder="e.g., water heater repair"
                        value={newHyperlinkPhrase}
                        onChange={(e) => setNewHyperlinkPhrase(e.target.value)}
                        data-testid="input-hyperlink-phrase"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">URL</Label>
                      <Input
                        placeholder="https://example.com/page"
                        value={newHyperlinkUrl}
                        onChange={(e) => setNewHyperlinkUrl(e.target.value)}
                        data-testid="input-hyperlink-url"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Type</Label>
                      <Select value={newHyperlinkType} onValueChange={(v) => setNewHyperlinkType(v as "internal" | "external")}>
                        <SelectTrigger className="w-32" data-testid="select-hyperlink-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="internal">Internal</SelectItem>
                          <SelectItem value="external">External</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button 
                      onClick={addHyperlink} 
                      className="mt-5"
                      data-testid="button-add-hyperlink"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Add Link
                    </Button>
                  </div>
                </div>
                
                {editedHyperlinks.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No hyperlinks yet. Add your first keyword hyperlink above.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Existing Hyperlinks (click to edit)</Label>
                    {editedHyperlinks.map((link: any, index: number) => (
                      <div key={index} className="p-3 border rounded-lg space-y-2" data-testid={`hyperlink-edit-${index}`}>
                        <div className="flex items-center gap-2">
                          <Select 
                            value={link.type || 'external'} 
                            onValueChange={(v) => updateHyperlink(index, 'type', v)}
                          >
                            <SelectTrigger className="w-28" data-testid={`select-hyperlink-type-${index}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="internal">Internal</SelectItem>
                              <SelectItem value="external">External</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            value={link.phrase || link.anchorText || ''}
                            onChange={(e) => updateHyperlink(index, 'phrase', e.target.value)}
                            placeholder="Keyword phrase"
                            className="flex-1"
                            data-testid={`input-hyperlink-phrase-${index}`}
                          />
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => removeHyperlink(index)}
                            data-testid={`button-remove-hyperlink-${index}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                        <Input
                          value={link.url || ''}
                          onChange={(e) => updateHyperlink(index, 'url', e.target.value)}
                          placeholder="https://example.com"
                          className="font-mono text-xs"
                          data-testid={`input-hyperlink-url-${index}`}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {(!article.hyperlinkedKeywords || article.hyperlinkedKeywords.length === 0) ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No hyperlinks. Click Edit to add keyword hyperlinks.
                  </p>
                ) : (
                  article.hyperlinkedKeywords.map((link: any, index: number) => (
                    <div key={index} className="flex items-start gap-3 p-3 border rounded-lg hover-elevate" data-testid={`hyperlink-${index}`}>
                      <Badge variant={link.type === 'internal' ? 'default' : 'secondary'} className="mt-0.5">
                        {link.type === 'internal' ? 'Internal' : 'External'}
                      </Badge>
                      <div className="flex-1 space-y-1 min-w-0">
                        <p className="text-sm font-medium text-primary">{link.phrase || link.anchorText}</p>
                        <a 
                          href={link.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-xs text-muted-foreground font-mono hover:text-primary hover:underline block truncate"
                          data-testid={`link-url-${index}`}
                        >
                          {link.url}
                        </a>
                        <Button 
                          variant="outline" 
                          size="sm"
                          className="mt-2"
                          onClick={() => {
                            navigator.clipboard.writeText(link.url);
                            toast({
                              title: "Link copied",
                              description: "URL copied to clipboard",
                            });
                          }}
                          data-testid={`button-copy-url-${index}`}
                        >
                          Copy URL
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {article.keywords && article.keywords.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Keywords</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {article.keywords.map((keyword, index) => (
                  <Badge key={index} variant="secondary" data-testid={`badge-keyword-${index}`}>
                    {keyword}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {article.htmlContent && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Article Content</CardTitle>
                {!isEditing && (
                  <div className="flex gap-2">
                    <Button
                      variant={viewMode === 'preview' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setViewMode('preview')}
                      data-testid="button-view-preview"
                    >
                      Preview
                    </Button>
                    <Button
                      variant={viewMode === 'html' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setViewMode('html')}
                      data-testid="button-view-html"
                    >
                      HTML
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          await apiRequest(`/api/articles/${articleId}/reformat`, {
                            method: "POST",
                          });
                          
                          toast({
                            title: "Reformat queued ✓",
                            description: "Running in background. Article will auto-update in 20-30 seconds.",
                          });
                          
                          // Start auto-refreshing to show updated content
                          setTimeout(() => {
                            queryClient.invalidateQueries({ queryKey: [`/api/content/${articleId}`] });
                          }, 25000); // Check after 25 seconds
                          
                        } catch (error) {
                          toast({
                            title: "Reformat failed",
                            description: error instanceof Error ? error.message : "Failed to queue reformat",
                            variant: "destructive",
                          });
                        }
                      }}
                      data-testid="button-reformat-article"
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Reformat
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={healingHyperlinks}
                          data-testid="button-heal-hyperlinks"
                        >
                          {healingHyperlinks ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Stethoscope className="w-4 h-4 mr-2" />
                          )}
                          Heal Hyperlinks
                          <ChevronDown className="w-3 h-3 ml-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuLabel>Choose heal scope</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          data-testid="dropdown-heal-single"
                          onSelect={async () => {
                            setHealingHyperlinks(true);
                            try {
                              const result = await apiRequest(`/api/articles/${articleId}/apply-hyperlinks`, {
                                method: "POST",
                              });
                              const data = result as { linksApplied?: number; newAnchorTags?: number; message?: string };
                              toast({
                                title: "This article healed",
                                description: data.linksApplied
                                  ? `${data.linksApplied} phrases linked (+${data.newAnchorTags ?? data.linksApplied} new links). Refreshing...`
                                  : data.message || "No new hyperlinks could be matched.",
                              });
                              if ((data.linksApplied ?? 0) > 0) {
                                setTimeout(() => {
                                  queryClient.invalidateQueries({ queryKey: [`/api/content/${articleId}`] });
                                }, 800);
                              }
                            } catch (error) {
                              toast({
                                title: "Heal failed",
                                description: error instanceof Error ? error.message : "Failed to heal hyperlinks",
                                variant: "destructive",
                              });
                            } finally {
                              setHealingHyperlinks(false);
                            }
                          }}
                        >
                          <LinkIcon className="w-4 h-4 mr-2" />
                          Heal This Article
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          data-testid="dropdown-heal-batch"
                          onSelect={async () => {
                            const batchId = article?.batchId;
                            if (!batchId) {
                              toast({ title: "No batch found", variant: "destructive" });
                              return;
                            }
                            setHealingHyperlinks(true);
                            try {
                              const result = await apiRequest(`/api/batches/${batchId}/fix-hyperlinks`, {
                                method: "POST",
                              });
                              const data = result as { summary?: { fixed?: number; skipped?: number } };
                              toast({
                                title: "Entire batch healed",
                                description: `Fixed ${data.summary?.fixed ?? 0} articles, skipped ${data.summary?.skipped ?? 0}.`,
                              });
                              queryClient.invalidateQueries({ queryKey: [`/api/content/${articleId}`] });
                            } catch (error) {
                              toast({
                                title: "Batch heal failed",
                                description: error instanceof Error ? error.message : "Failed to heal batch",
                                variant: "destructive",
                              });
                            } finally {
                              setHealingHyperlinks(false);
                            }
                          }}
                        >
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Heal Entire Batch
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyArticleWithLinks(article.htmlContent!)}
                      data-testid="button-copy-full-article"
                    >
                      {copiedField === 'full-article' ? (
                        <Check className="w-4 h-4 mr-2" />
                      ) : (
                        <Copy className="w-4 h-4 mr-2" />
                      )}
                      Copy Full Article
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <RichTextEditor
                  content={editedContent}
                  onChange={setEditedContent}
                  placeholder="Write your article content here..."
                />
              ) : viewMode === 'html' ? (
                <div className="relative">
                  <pre className="p-4 bg-muted rounded-lg text-xs overflow-x-auto max-h-[600px] border">
                    <code>{article.htmlContent}</code>
                  </pre>
                  <Button
                    size="sm"
                    variant="outline"
                    className="absolute top-2 right-2"
                    onClick={() => copyToClipboard(article.htmlContent || '', 'HTML Content')}
                    data-testid="button-copy-html-content"
                  >
                    {copiedField === 'HTML Content' ? (
                      <Check className="w-3 h-3 mr-1" />
                    ) : (
                      <Copy className="w-3 h-3 mr-1" />
                    )}
                    Copy HTML
                  </Button>
                </div>
              ) : (
                <div
                  className="prose prose-sm max-w-none dark:prose-invert
                    prose-table:border-collapse prose-table:w-full
                    prose-th:border prose-th:border-border prose-th:p-2 prose-th:bg-muted prose-th:font-bold
                    prose-td:border prose-td:border-border prose-td:p-2
                    prose-img:rounded-lg prose-img:max-w-full prose-img:h-auto
                    prose-video:rounded-lg prose-video:max-w-full
                    [&_audio]:w-full [&_audio]:rounded-md
                    [&_ul[data-type='taskList']]:list-none [&_ul[data-type='taskList']]:pl-0
                    [&_li[data-type='taskItem']]:flex [&_li[data-type='taskItem']]:items-start [&_li[data-type='taskItem']]:gap-2
                    prose-iframe:w-full prose-iframe:aspect-video prose-iframe:rounded-lg
                    [&_.hashtags]:mt-8 [&_.hashtags]:pt-4 [&_.hashtags]:border-t [&_.hashtags]:border-border
                    [&_.hashtag-link]:inline-block [&_.hashtag-link]:px-2 [&_.hashtag-link]:py-1 [&_.hashtag-link]:mr-2 [&_.hashtag-link]:mb-2
                    [&_.hashtag-link]:text-sm [&_.hashtag-link]:font-medium [&_.hashtag-link]:text-primary
                    [&_.hashtag-link]:border [&_.hashtag-link]:border-primary [&_.hashtag-link]:rounded-md
                    [&_.hashtag-link]:no-underline [&_.hashtag-link:hover]:bg-primary [&_.hashtag-link:hover]:text-primary-foreground
                    [&_.hashtag-link]:transition-colors"
                  dangerouslySetInnerHTML={{ 
                    __html: article.podcastUrl && article.podcastStatus === 'ready' 
                      ? injectAudioPlayer(article.finalHtmlContent || article.htmlContent || '', article.podcastUrl, article.podcastDuration)
                      : article.finalHtmlContent || article.htmlContent || ''
                  }}
                  data-testid="content-html"
                />
              )}
            </CardContent>
          </Card>
        )}

        {/* All Images Section - Comprehensive Gallery */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-primary" />
                Your Images ({assets.filter(a => a.url && !a.url.includes('IMAGE_URL')).length})
              </CardTitle>
            </div>
            <CardDescription>
              AI-generated images with individual download and regenerate options
            </CardDescription>
          </CardHeader>
          <CardContent>
            {assets.length === 0 || !assets.some(a => a.url && !a.url.includes('IMAGE_URL')) ? (
              <div className="text-center py-12 border-2 border-dashed rounded-lg">
                <ImageIcon className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No Images Generated</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Images haven't been generated for this article yet
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {assets.filter(a => a.url && !a.url.includes('IMAGE_URL')).map((asset, index) => (
                  <div key={asset.id} className="border rounded-lg p-4 space-y-3" data-testid={`image-item-${index}`}>
                    <div className="flex items-center justify-between mb-2">
                      <Badge variant={index === 0 ? "default" : "secondary"}>
                        {index === 0 ? "Hero Image" : `Image ${index + 1}`}
                      </Badge>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            setRegeneratingImageId(asset.id);
                            try {
                              const promptToUse = editedPrompts[asset.id] || asset.prompt;
                              if (!promptToUse) {
                                toast({
                                  title: "No prompt available",
                                  description: "Please edit and save a prompt first.",
                                  variant: "destructive",
                                });
                                setRegeneratingImageId(null);
                                return;
                              }
                              
                              console.log(`🎨 Regenerating image ${asset.id} with prompt:`, promptToUse.slice(0, 100));
                              
                              const response = await apiRequest(`/api/content/${articleId}/regenerate-hero-image`, {
                                method: "POST",
                                body: JSON.stringify({
                                  prompt: promptToUse,
                                }),
                              });
                              
                              console.log('✅ Regeneration response:', response);
                              
                              // Wait a moment for database to commit
                              await new Promise(resolve => setTimeout(resolve, 500));
                              
                              // Force refetch the article data to show new image
                              await queryClient.invalidateQueries({ queryKey: [`/api/content/${articleId}`] });
                              await queryClient.refetchQueries({ queryKey: [`/api/content/${articleId}`] });
                              
                              toast({
                                title: "Image regenerated ✓",
                                description: "New image is now displayed in the gallery.",
                              });
                            } catch (error) {
                              console.error('❌ Regeneration error:', error);
                              toast({
                                title: "Regeneration failed",
                                description: error instanceof Error ? error.message : "Failed to regenerate image",
                                variant: "destructive",
                              });
                            } finally {
                              setRegeneratingImageId(null);
                            }
                          }}
                          disabled={regeneratingImageId === asset.id}
                          data-testid={`button-regenerate-image-${index}`}
                        >
                          {regeneratingImageId === asset.id ? (
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3 mr-1" />
                          )}
                          {regeneratingImageId === asset.id ? 'Generating...' : 'Regenerate'}
                        </Button>
                        <Button
                          size="sm"
                          variant="default"
                          onClick={async () => {
                            try {
                              const response = await fetch(asset.url);
                              const blob = await response.blob();
                              const url = window.URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `image-${index + 1}.${asset.format || 'webp'}`;
                              a.click();
                              window.URL.revokeObjectURL(url);
                              toast({
                                title: "Download started",
                                description: `Image ${index + 1} is being downloaded.`,
                              });
                            } catch (error) {
                              toast({
                                title: "Download failed",
                                description: "Failed to download image",
                                variant: "destructive",
                              });
                            }
                          }}
                          data-testid={`button-download-image-${index}`}
                        >
                          <Download className="w-3 h-3 mr-1" />
                          Download
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => copyToClipboard(asset.url, `Image ${index + 1} URL`)}
                          data-testid={`button-copy-image-url-${index}`}
                        >
                          {copiedField === `Image ${index + 1} URL` ? (
                            <Check className="w-3 h-3 mr-1" />
                          ) : (
                            <Copy className="w-3 h-3 mr-1" />
                          )}
                          Copy URL
                        </Button>
                      </div>
                    </div>
                    <div
                      role="button"
                      tabIndex={0}
                      className="w-full cursor-pointer"
                      onClick={() => setLightboxImage(asset.url)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setLightboxImage(asset.url);
                        }
                      }}
                      aria-label={`Click to view ${asset.altText || `Image ${index + 1}`} in full size`}
                    >
                      <img
                        src={asset.url}
                        alt={asset.altText || `Image ${index + 1}`}
                        className="w-full rounded-lg border shadow-md hover-elevate transition-transform"
                        data-testid={`img-preview-${index}`}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-muted-foreground">Image Prompt</Label>
                        {editingPromptId === asset.id ? (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditedPrompts(prev => {
                                  const updated = { ...prev };
                                  delete updated[asset.id];
                                  return updated;
                                });
                                setEditingPromptId(null);
                              }}
                              data-testid={`button-cancel-edit-prompt-${index}`}
                            >
                              <X className="w-3 h-3 mr-1" />
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => {
                                setEditingPromptId(null);
                                toast({
                                  title: "Prompt updated",
                                  description: "Use Regenerate to create a new image with this prompt.",
                                });
                              }}
                              data-testid={`button-save-prompt-${index}`}
                            >
                              <Save className="w-3 h-3 mr-1" />
                              Save
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingPromptId(asset.id);
                              setEditedPrompts(prev => ({
                                ...prev,
                                [asset.id]: asset.prompt || ""
                              }));
                            }}
                            data-testid={`button-edit-prompt-${index}`}
                          >
                            <Edit className="w-3 h-3 mr-1" />
                            Edit
                          </Button>
                        )}
                      </div>
                      {editingPromptId === asset.id ? (
                        <Textarea
                          value={editedPrompts[asset.id] || asset.prompt || ""}
                          onChange={(e) => setEditedPrompts(prev => ({
                            ...prev,
                            [asset.id]: e.target.value
                          }))}
                          className="text-sm min-h-[100px] resize-y"
                          placeholder="Enter a detailed image prompt..."
                          data-testid={`textarea-edit-prompt-${index}`}
                        />
                      ) : (
                        <p className="text-sm p-2 bg-muted rounded border" data-testid={`text-image-prompt-${index}`}>
                          {editedPrompts[asset.id] || asset.prompt || "No prompt available"}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Legacy Images Section - Keep for backward compatibility */}
        {assets.length > 0 && assets.some(a => !a.url.includes('IMAGE_URL')) && false && (
          <Card>
            <CardHeader>
              <CardTitle>Images ({assets.length})</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {assets.filter(a => !a.url.includes('IMAGE_URL')).map((asset, index) => (
                <div key={asset.id} className="space-y-2" data-testid={`legacy-image-item-${index}`}>
                  <img
                    src={asset.url}
                    alt={asset.altText}
                    className="w-full rounded-lg border"
                  />
                  <p className="text-xs text-muted-foreground">{asset.altText}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Image Lightbox Dialog */}
      <Dialog open={!!lightboxImage} onOpenChange={(open) => !open && setLightboxImage(null)}>
        <DialogContent className="max-w-7xl w-[95vw] p-2">
          <DialogTitle className="sr-only">Image Preview</DialogTitle>
          <div className="relative w-full h-[90vh] flex items-center justify-center">
            {/* Only render img when lightboxImage exists to prevent empty src errors */}
            {lightboxImage && (
              <img
                src={lightboxImage}
                alt="Full size preview"
                className="max-w-full max-h-full object-contain rounded-lg"
                data-testid="lightbox-image"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Article Regeneration Dialog */}
      <Dialog open={showRegenerateDialog} onOpenChange={setShowRegenerateDialog}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>Regenerate Article with Custom Instructions</DialogTitle>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="custom-instructions">Custom Instructions (Optional)</Label>
              <p className="text-sm text-muted-foreground">
                Describe what you want to change in the article. Leave empty to regenerate with the same settings.
              </p>
              <Textarea
                id="custom-instructions"
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder="Example: Add more statistics and make it more technical"
                className="min-h-32"
                data-testid="input-custom-instructions"
              />
            </div>
            
            <div className="bg-muted p-4 rounded-lg border">
              <h4 className="font-semibold text-sm mb-2">What will be preserved:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Original title and topic</li>
                <li>• Word count range</li>
                <li>• Tone of voice</li>
                <li>• Geographic focus</li>
                <li>• Target audience</li>
                <li>• SEO requirements</li>
              </ul>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowRegenerateDialog(false);
                  setCustomInstructions("");
                }}
                disabled={regenerateArticleMutation.isPending}
                data-testid="button-cancel-regenerate"
              >
                Cancel
              </Button>
              <Button
                onClick={() => regenerateArticleMutation.mutate(customInstructions)}
                disabled={regenerateArticleMutation.isPending}
                data-testid="button-confirm-regenerate"
              >
                {regenerateArticleMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Starting Regeneration...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Regenerate Article
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
