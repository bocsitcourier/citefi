"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MediaUploader, type MediaType } from "@/components/MediaUploader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Image, Music, Video, Trash2, ExternalLink, Copy, CheckCircle2, Home, Download, Edit, RefreshCw, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { OptimizedVideo } from "@/components/OptimizedVideo";

interface MediaAsset {
  id: number;
  articleId: number | null;
  socialPostId?: number | null;
  assetType: string;
  storageUrl: string;
  altText: string | null;
  fileFormat: string;
  metadataJson: any;
  imagePromptUsed: string | null;
  createdAt: Date;
  articleTitle: string | null;
  isHero?: boolean;
  source?: 'article' | 'social';
}

export default function MediaLibraryPage() {
  const [activeTab, setActiveTab] = useState<MediaType>("image");
  const [copiedUrl, setCopiedUrl] = useState<number | null>(null);
  const [editingAsset, setEditingAsset] = useState<MediaAsset | null>(null);
  const [editedAltText, setEditedAltText] = useState("");
  const [redoingAsset, setRedoingAsset] = useState<MediaAsset | null>(null);
  const [redoPrompt, setRedoPrompt] = useState("");
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<MediaAsset | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: mediaData, isLoading } = useQuery({
    queryKey: ['/api/media/list', activeTab],
    queryFn: async () => {
      const response = await fetch(`/api/media/list?type=${activeTab}&limit=100`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error('Failed to fetch media');
      return response.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (assetId: number) => {
      const response = await fetch(`/api/media/${assetId}`, {
        method: 'DELETE',
        credentials: "include",
      });
      if (!response.ok) throw new Error('Failed to delete asset');
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['/api/media/list'] });
      toast({
        title: "Deleted",
        description: "Media asset deleted successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Delete Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, altText }: { id: number; altText: string }) => {
      return await apiRequest(`/api/media/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ altText }),
      });
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['/api/media/list'] });
      setEditingAsset(null);
      toast({
        title: "Updated",
        description: "Image details updated successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const copyToClipboard = (url: string, id: number) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(id);
    toast({
      title: "Copied!",
      description: "URL copied to clipboard",
    });
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const handleDownload = async (asset: MediaAsset) => {
    try {
      // Handle both relative and absolute URLs
      const fetchUrl = asset.storageUrl.startsWith('/') 
        ? `${window.location.origin}${asset.storageUrl}`
        : asset.storageUrl;
      
      const response = await fetch(fetchUrl);
      if (!response.ok) throw new Error('Download failed');
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = asset.altText || asset.storageUrl.split('/').pop() || 'download';
      a.click();
      URL.revokeObjectURL(url);
      
      toast({
        title: "Downloaded",
        description: "File downloaded successfully",
      });
    } catch (error) {
      toast({
        title: "Download Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleEdit = (asset: MediaAsset) => {
    setEditingAsset(asset);
    setEditedAltText(asset.altText || "");
  };

  const handleSaveEdit = () => {
    if (!editingAsset) return;
    updateMutation.mutate({ id: editingAsset.id, altText: editedAltText });
  };

  const handleRedo = (asset: MediaAsset) => {
    setRedoingAsset(asset);
    setRedoPrompt(asset.imagePromptUsed || "");
  };

  const handleRegenerateImage = async () => {
    if (!redoingAsset || !redoPrompt.trim()) {
      toast({
        title: "Invalid Input",
        description: "Please enter a prompt for the image",
        variant: "destructive",
      });
      return;
    }

    setIsRegenerating(true);
    try {
      await apiRequest(`/api/media/${redoingAsset.id}/regenerate`, {
        method: "POST",
        body: JSON.stringify({ prompt: redoPrompt }),
      });
      
      queryClient.invalidateQueries({ queryKey: ['/api/media/list'] });
      setRedoingAsset(null);
      
      toast({
        title: "Image Regenerated",
        description: "New image has been generated successfully",
      });
    } catch (error) {
      toast({
        title: "Regeneration Failed",
        description: error instanceof Error ? error.message : "Failed to regenerate image",
        variant: "destructive",
      });
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleRegenerateVideo = async (asset: MediaAsset) => {
    if (!asset.socialPostId) {
      toast({
        title: "Error",
        description: "Cannot regenerate: social post ID not found",
        variant: "destructive",
      });
      return;
    }

    try {
      toast({
        title: "Regenerating Video",
        description: "This may take 60-180 seconds. You'll be notified when complete.",
      });

      const response = await fetch('/api/social/video/generate', {
        method: 'POST',
        credentials: "include",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          socialPostId: asset.socialPostId,
          platform: 'tiktok'
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to regenerate video');
      }

      toast({
        title: "Video Queued",
        description: "Video regeneration has started. Refresh the page in a few minutes to see the new video.",
      });

      // Refresh the media list after a short delay
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['/api/media/list'] });
      }, 3000);

    } catch (error) {
      toast({
        title: "Regeneration Failed",
        description: error instanceof Error ? error.message : "Failed to regenerate video",
        variant: "destructive",
      });
    }
  };

  const renderMediaPreview = (asset: MediaAsset) => {
    switch (asset.assetType) {
      case 'image':
        return (
          <div 
            className="w-full h-48 relative cursor-pointer group"
            onClick={() => setFullscreenImage(asset)}
            data-testid={`image-preview-${asset.id}`}
          >
            <img 
              src={asset.storageUrl} 
              alt={asset.altText || 'Media asset'} 
              className="w-full h-48 object-cover rounded-t-lg"
            />
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-t-lg">
              <ExternalLink className="w-8 h-8 text-white" />
            </div>
          </div>
        );
      case 'audio':
        return (
          <div className="w-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-t-lg p-4">
            <div className="flex items-center justify-center mb-3">
              <Music className="w-12 h-12 text-purple-500" />
            </div>
            <audio
              controls
              className="w-full"
              preload="metadata"
              data-testid={`audio-player-${asset.id}`}
            >
              <source src={asset.storageUrl} type="audio/mpeg" />
              Your browser does not support the audio element.
            </audio>
            {asset.metadataJson?.duration && (
              <p className="text-xs text-center text-muted-foreground mt-2">
                Duration: {Math.floor(asset.metadataJson.duration / 60)}:{String(asset.metadataJson.duration % 60).padStart(2, '0')}
              </p>
            )}
          </div>
        );
      case 'video':
        return (
          <div className="w-full bg-gradient-to-br from-blue-500/20 to-cyan-500/20 rounded-t-lg p-4">
            <div className="flex items-center justify-center mb-3">
              <Video className="w-12 h-12 text-blue-500" />
            </div>
            <OptimizedVideo
              src={asset.storageUrl}
              title={asset.altText || asset.articleTitle || asset.metadataJson?.companyName || 'Media Video'}
              description={asset.metadataJson?.companyName ? `Video for ${asset.metadataJson.companyName}` : undefined}
              duration={asset.metadataJson?.duration ? `PT${Math.floor(asset.metadataJson.duration / 60)}M${asset.metadataJson.duration % 60}S` : undefined}
              preload="none"
              lazy
              controls
              className="w-full rounded"
              ariaLabel={`Video player for ${asset.altText || 'media asset'}`}
            />
            {asset.metadataJson?.duration && (
              <p className="text-xs text-center text-muted-foreground mt-2" data-testid={`video-player-${asset.id}`}>
                Duration: {Math.floor(asset.metadataJson.duration / 60)}:{String(asset.metadataJson.duration % 60).padStart(2, '0')}
              </p>
            )}
            {asset.metadataJson?.companyName && (
              <p className="text-xs text-center text-muted-foreground">
                Company: {asset.metadataJson.companyName}
              </p>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  const assets: MediaAsset[] = mediaData?.assets || [];

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Media Library</h1>
          <p className="text-muted-foreground">
            Manage your images, audio files, and videos
          </p>
        </div>
        <Link href="/home">
          <Button variant="outline" size="sm" data-testid="button-home">
            <Home className="w-4 h-4 mr-2" />
            Home
          </Button>
        </Link>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as MediaType)}>
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="image" data-testid="tab-images">
            <Image className="w-4 h-4 mr-2" />
            Images
          </TabsTrigger>
          <TabsTrigger value="audio" data-testid="tab-audio">
            <Music className="w-4 h-4 mr-2" />
            Audio
          </TabsTrigger>
          <TabsTrigger value="video" data-testid="tab-videos">
            <Video className="w-4 h-4 mr-2" />
            Videos
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="space-y-6">
          {/* Upload Section */}
          <MediaUploader
            assetType={activeTab}
            onUploadComplete={() => {
              queryClient.invalidateQueries({ queryKey: ['/api/media/list'] });
            }}
          />

          {/* Media Grid */}
          <div>
            <h2 className="text-xl font-semibold mb-4">
              Your {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}s
              {!isLoading && <span className="text-muted-foreground ml-2">({assets.length})</span>}
            </h2>

            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <Card key={i} className="animate-pulse">
                    <div className="h-48 bg-muted rounded-t-lg" />
                    <CardContent className="p-4 space-y-2">
                      <div className="h-4 bg-muted rounded w-3/4" />
                      <div className="h-3 bg-muted rounded w-1/2" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : assets.length === 0 ? (
              <Card>
                <CardContent className="p-12 text-center">
                  <div className="flex flex-col items-center gap-3">
                    {activeTab === 'image' && <Image className="w-16 h-16 text-muted-foreground" />}
                    {activeTab === 'audio' && <Music className="w-16 h-16 text-muted-foreground" />}
                    {activeTab === 'video' && <Video className="w-16 h-16 text-muted-foreground" />}
                    <div>
                      <p className="text-lg font-medium">No {activeTab}s yet</p>
                      <p className="text-sm text-muted-foreground">
                        Upload your first {activeTab} using the form above
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {assets.map((asset) => (
                  <Card key={asset.id} className="overflow-hidden hover-elevate" data-testid={`media-card-${asset.id}`}>
                    {renderMediaPreview(asset)}
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {asset.altText || asset.storageUrl.split('/').pop()}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(asset.createdAt), { addSuffix: true })}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {asset.isHero && (
                            <Badge variant="default" className="bg-purple-600">
                              Hero
                            </Badge>
                          )}
                          {asset.source === 'social' && (
                            <Badge variant="default" className="bg-blue-600">
                              Social
                            </Badge>
                          )}
                          <Badge variant="secondary">{asset.fileFormat}</Badge>
                        </div>
                      </div>

                      {asset.articleTitle && (
                        <p className="text-xs text-muted-foreground truncate">
                          Article: {asset.articleTitle}
                        </p>
                      )}

                      {asset.metadataJson && (
                        <div className="text-xs text-muted-foreground space-y-1">
                          {asset.metadataJson.width && (
                            <p>Dimensions: {asset.metadataJson.width}×{asset.metadataJson.height}</p>
                          )}
                          {asset.metadataJson.originalSize && (
                            <p>Size: {(asset.metadataJson.originalSize / 1024 / 1024).toFixed(2)} MB</p>
                          )}
                        </div>
                      )}

                      <div className="flex gap-2 flex-wrap">
                        {asset.articleId && (
                          <Link href={`/content/${asset.articleId}`}>
                            <Button
                              variant="default"
                              size="sm"
                              data-testid={`button-view-article-${asset.id}`}
                            >
                              <ExternalLink className="w-4 h-4 mr-1" />
                              View Article
                            </Button>
                          </Link>
                        )}
                        {asset.socialPostId && (
                          <Link href={`/social/${asset.socialPostId}`}>
                            <Button
                              variant="default"
                              size="sm"
                              data-testid={`button-view-social-${asset.id}`}
                            >
                              <ExternalLink className="w-4 h-4 mr-1" />
                              View Post
                            </Button>
                          </Link>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyToClipboard(asset.storageUrl, asset.id)}
                          data-testid={`button-copy-${asset.id}`}
                        >
                          {copiedUrl === asset.id ? (
                            <CheckCircle2 className="w-4 h-4" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownload(asset)}
                          data-testid={`button-download-${asset.id}`}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEdit(asset)}
                          data-testid={`button-edit-${asset.id}`}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        {asset.assetType === 'image' && asset.imagePromptUsed && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRedo(asset)}
                            data-testid={`button-redo-${asset.id}`}
                          >
                            <RefreshCw className="w-4 h-4" />
                          </Button>
                        )}
                        {asset.assetType === 'video' && asset.source === 'social' && asset.socialPostId && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRegenerateVideo(asset)}
                            data-testid={`button-regenerate-video-${asset.id}`}
                          >
                            <RefreshCw className="w-4 h-4 mr-1" />
                            Regenerate
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => deleteMutation.mutate(asset.id)}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-${asset.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Edit Dialog */}
      <Dialog open={!!editingAsset} onOpenChange={() => setEditingAsset(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Image Details</DialogTitle>
            <DialogDescription>
              Update the alt text and description for this image
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {editingAsset && (
              <>
                <div className="space-y-2">
                  <img 
                    src={editingAsset.storageUrl} 
                    alt={editingAsset.altText || ''} 
                    className="w-full rounded-lg border"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="alt-text">Alt Text</Label>
                  <Input
                    id="alt-text"
                    value={editedAltText}
                    onChange={(e) => setEditedAltText(e.target.value)}
                    placeholder="Describe this image..."
                    data-testid="input-alt-text"
                  />
                </div>
                {editingAsset.imagePromptUsed && (
                  <div className="space-y-2">
                    <Label>Original Prompt</Label>
                    <p className="text-sm text-muted-foreground p-2 bg-muted rounded border">
                      {editingAsset.imagePromptUsed}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingAsset(null)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSaveEdit} 
              disabled={updateMutation.isPending}
              data-testid="button-save-edit"
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Regenerate Image Dialog */}
      <Dialog open={!!redoingAsset} onOpenChange={() => setRedoingAsset(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Regenerate Image</DialogTitle>
            <DialogDescription>
              Edit the prompt below and regenerate the image with AI
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {redoingAsset && (
              <>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Current Image</Label>
                    <img 
                      src={redoingAsset.storageUrl} 
                      alt={redoingAsset.altText || ''} 
                      className="w-full rounded-lg border"
                    />
                  </div>
                  
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold">Prompt Tips for Better Images</Label>
                    <div className="text-xs text-muted-foreground space-y-2 bg-muted/50 p-3 rounded-lg border max-h-[300px] overflow-y-auto">
                      <p><strong>Be Specific and Detailed:</strong> Include setting, objects, colors, mood, and specific elements you want.</p>
                      <p><strong>Mood and Atmosphere:</strong> Use words like "serene," "chaotic," "mystical," or "futuristic" to set the tone.</p>
                      <p><strong>Use Descriptive Adjectives:</strong> Instead of "a dog," say "a fluffy, small, brown dog."</p>
                      <p><strong>Perspective and Composition:</strong> Specify close-up, wide shot, bird's-eye view, or specific angles.</p>
                      <p><strong>Lighting and Time of Day:</strong> Mention day/night, sunny/cloudy, or specific light sources like candlelight or neon.</p>
                      <p><strong>Action or Movement:</strong> Describe dynamic actions like "a cat jumping over a fence" for more engaging images.</p>
                      <p><strong>Balance Details:</strong> Be descriptive but concise—avoid overloading the prompt with too many elements.</p>
                      <p><strong>Use Analogies:</strong> Reference styles like "in the style of Van Gogh" or "resembling a fantasy novel scene."</p>
                      <p><strong>Specify Styles or Themes:</strong> Mention artistic styles like "cyberpunk," "art deco," or "minimalist."</p>
                      <p><strong>Iterative Approach:</strong> Refine your prompt based on results and try again for better outcomes.</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="redo-prompt">Image Prompt</Label>
                  <textarea
                    id="redo-prompt"
                    value={redoPrompt}
                    onChange={(e) => setRedoPrompt(e.target.value)}
                    placeholder="Example: A serene lakeside cabin at golden hour, with warm sunlight filtering through pine trees, smoke rising from chimney, in the style of landscape photography, shot on Canon EOS R5, f/2.8, soft focus background..."
                    className="w-full min-h-[140px] p-3 rounded-md border bg-background text-sm resize-y"
                    data-testid="input-redo-prompt"
                  />
                  <p className="text-xs text-muted-foreground">
                    💡 Pro tip: Include subject, location, mood, lighting, camera specs, and artistic style for professional results
                  </p>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRedoingAsset(null)} disabled={isRegenerating}>
              Cancel
            </Button>
            <Button 
              onClick={handleRegenerateImage} 
              disabled={isRegenerating || !redoPrompt.trim()}
              data-testid="button-regenerate-image"
            >
              {isRegenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Regenerate Image
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fullscreen Image Preview */}
      <Dialog open={!!fullscreenImage} onOpenChange={() => setFullscreenImage(null)}>
        <DialogContent className="max-w-7xl max-h-[95vh] p-2">
          <DialogHeader className="p-4">
            <DialogTitle>
              {fullscreenImage?.altText || fullscreenImage?.storageUrl.split('/').pop()}
            </DialogTitle>
            {fullscreenImage?.articleTitle && (
              <DialogDescription>
                From article: {fullscreenImage.articleTitle}
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="flex items-center justify-center p-4 max-h-[80vh] overflow-auto">
            {fullscreenImage && (
              <img
                src={fullscreenImage.storageUrl}
                alt={fullscreenImage.altText || 'Fullscreen preview'}
                className="max-w-full max-h-full object-contain"
                data-testid="fullscreen-image"
              />
            )}
          </div>
          <DialogFooter className="p-4">
            {fullscreenImage?.articleId && (
              <Link href={`/content/${fullscreenImage.articleId}`}>
                <Button variant="default" data-testid="button-view-article-fullscreen">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  View Article
                </Button>
              </Link>
            )}
            <Button variant="outline" onClick={() => setFullscreenImage(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
