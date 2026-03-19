import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, Link2, Loader2, CheckCircle2, AlertCircle, Image, Music, Video } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export type MediaType = 'image' | 'audio' | 'video';

interface MediaUploaderProps {
  articleId?: number;
  assetType: MediaType;
  onUploadComplete?: (url: string, metadata: any) => void;
  maxSizeMB?: number;
}

export function MediaUploader({ articleId, assetType, onUploadComplete, maxSizeMB = 50 }: MediaUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [urlInput, setUrlInput] = useState("");
  const [altText, setAltText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const acceptedTypes = {
    image: "image/jpeg,image/png,image/webp,image/gif",
    audio: "audio/mpeg,audio/wav,audio/ogg,audio/mp4",
    video: "video/mp4,video/webm,video/ogg,video/quicktime"
  };

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    setProgress("Preparing upload...");

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (articleId) formData.append('articleId', articleId.toString());
      if (altText) formData.append('altText', altText);

      setProgress("Uploading...");
      const response = await fetch('/api/media/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      setProgress("Upload complete!");
      toast({
        title: "Success",
        description: `${assetType.charAt(0).toUpperCase() + assetType.slice(1)} uploaded successfully`,
      });

      onUploadComplete?.(data.url, data.metadata);
      
      // Reset form
      setAltText("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      
      setTimeout(() => setProgress(""), 2000);

    } catch (error) {
      console.error('Upload error:', error);
      setProgress("");
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleUrlImport = async () => {
    if (!urlInput.trim()) {
      toast({
        title: "URL Required",
        description: "Please enter a valid URL",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    setProgress("Fetching from URL...");

    try {
      const response = await fetch('/api/media/from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: urlInput,
          articleId,
          altText: altText || undefined,
          assetType,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Import failed');
      }

      setProgress("Import complete!");
      toast({
        title: "Success",
        description: `${assetType.charAt(0).toUpperCase() + assetType.slice(1)} imported successfully`,
      });

      onUploadComplete?.(data.url, data.metadata);

      // Reset form
      setUrlInput("");
      setAltText("");
      
      setTimeout(() => setProgress(""), 2000);

    } catch (error) {
      console.error('Import error:', error);
      setProgress("");
      toast({
        title: "Import Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  };

  const getIcon = () => {
    switch (assetType) {
      case 'image': return <Image className="w-8 h-8" />;
      case 'audio': return <Music className="w-8 h-8" />;
      case 'video': return <Video className="w-8 h-8" />;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {getIcon()}
          Upload {assetType.charAt(0).toUpperCase() + assetType.slice(1)}
        </CardTitle>
        <CardDescription>
          Upload from your computer or import from a URL (max {maxSizeMB}MB)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="file" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="file" data-testid="tab-file-upload">
              <Upload className="w-4 h-4 mr-2" />
              File Upload
            </TabsTrigger>
            <TabsTrigger value="url" data-testid="tab-url-import">
              <Link2 className="w-4 h-4 mr-2" />
              From URL
            </TabsTrigger>
          </TabsList>

          <TabsContent value="file" className="space-y-4">
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center hover-elevate transition-colors cursor-pointer"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              data-testid="drop-zone"
            >
              <div className="flex flex-col items-center gap-3">
                {progress ? (
                  progress.includes("complete") ? (
                    <CheckCircle2 className="w-12 h-12 text-green-500" />
                  ) : (
                    <Loader2 className="w-12 h-12 animate-spin text-primary" />
                  )
                ) : (
                  <Upload className="w-12 h-12 text-muted-foreground" />
                )}
                <div>
                  <p className="text-sm font-medium">
                    {progress || "Drag & drop your file here, or click to browse"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Accepted formats: {acceptedTypes[assetType].split(',').map(t => t.split('/')[1].toUpperCase()).join(', ')}
                  </p>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={acceptedTypes[assetType]}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
                className="hidden"
                disabled={uploading}
                data-testid="input-file"
              />
            </div>

            {assetType === 'image' && (
              <div className="space-y-2">
                <Label htmlFor="file-alt-text">Alt Text (Optional)</Label>
                <Input
                  id="file-alt-text"
                  value={altText}
                  onChange={(e) => setAltText(e.target.value)}
                  placeholder="Describe the image for accessibility"
                  disabled={uploading}
                  data-testid="input-alt-text-file"
                />
              </div>
            )}
          </TabsContent>

          <TabsContent value="url" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="media-url">Media URL</Label>
              <Input
                id="media-url"
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder={`https://example.com/${assetType}.${assetType === 'image' ? 'jpg' : assetType === 'audio' ? 'mp3' : 'mp4'}`}
                disabled={uploading}
                data-testid="input-url"
              />
            </div>

            {assetType === 'image' && (
              <div className="space-y-2">
                <Label htmlFor="url-alt-text">Alt Text (Optional)</Label>
                <Input
                  id="url-alt-text"
                  value={altText}
                  onChange={(e) => setAltText(e.target.value)}
                  placeholder="Describe the image for accessibility"
                  disabled={uploading}
                  data-testid="input-alt-text-url"
                />
              </div>
            )}

            <Button
              onClick={handleUrlImport}
              disabled={uploading || !urlInput.trim()}
              className="w-full"
              data-testid="button-import-url"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {progress}
                </>
              ) : (
                <>
                  <Link2 className="w-4 h-4 mr-2" />
                  Import from URL
                </>
              )}
            </Button>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
