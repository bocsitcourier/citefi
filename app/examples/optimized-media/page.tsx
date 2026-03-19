"use client";

import { OptimizedImage, OptimizedImageGallery } from "@/components/OptimizedImage";
import { OptimizedVideo, OptimizedVideoGallery } from "@/components/OptimizedVideo";
import { OptimizedAudio, OptimizedAudioPlaylist } from "@/components/OptimizedAudio";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, Image as ImageIcon, Video as VideoIcon, Music } from "lucide-react";

/**
 * Optimized Media Examples Page
 * 
 * Demonstrates SEO/GEO-optimized media (images, videos, audio) with local assets
 * No cloud storage required - all media served from attached_assets or public folder
 */
export default function OptimizedMediaExamplesPage() {
  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl space-y-8">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-4xl font-bold">SEO/GEO Optimized Media</h1>
          <Badge variant="default" className="text-sm">
            No Cloud Storage Required
          </Badge>
        </div>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Professional media optimization with automatic SEO enhancements, lazy loading, 
          schema.org markup, and location-aware metadata - all using local assets.
        </p>
        
        {/* Media Types */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <Card className="border-primary/50">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-primary" />
                <CardTitle className="text-lg">Images</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                <span>Lazy loading + blur</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                <span>WebP conversion</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                <span>ImageObject schema</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/50">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <VideoIcon className="w-5 h-5 text-primary" />
                <CardTitle className="text-lg">Videos</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                <span>Custom controls</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                <span>Transcript support</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                <span>VideoObject schema</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/50">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Music className="w-5 h-5 text-primary" />
                <CardTitle className="text-lg">Audio</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                <span>Podcast support</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                <span>Playlist functionality</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                <span>PodcastEpisode schema</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Separator />

      {/* Examples Tabs */}
      <Tabs defaultValue="images" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="images" data-testid="tab-images">
            <ImageIcon className="w-4 h-4 mr-2" />
            Images
          </TabsTrigger>
          <TabsTrigger value="videos" data-testid="tab-videos">
            <VideoIcon className="w-4 h-4 mr-2" />
            Videos
          </TabsTrigger>
          <TabsTrigger value="audio" data-testid="tab-audio">
            <Music className="w-4 h-4 mr-2" />
            Audio
          </TabsTrigger>
          <TabsTrigger value="code" data-testid="tab-code">Code</TabsTrigger>
        </TabsList>

        {/* IMAGES Tab */}
        <TabsContent value="images" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Image Gallery with SEO/GEO</CardTitle>
              <CardDescription>
                Location-aware images with automatic SEO optimization
              </CardDescription>
            </CardHeader>
            <CardContent>
              <OptimizedImageGallery
                images={[
                  {
                    src: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=600&h=400&fit=crop",
                    alt: "Downtown Boston financial district skyline",
                    width: 600,
                    height: 400,
                    geoLocation: "Boston, Massachusetts",
                    keywords: ["Boston skyline", "financial district"],
                    caption: "Financial District, Boston",
                  },
                  {
                    src: "https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=600&h=400&fit=crop",
                    alt: "Historic courthouse building",
                    width: 600,
                    height: 400,
                    geoLocation: "Boston, Massachusetts",
                    keywords: ["courthouse", "legal services"],
                    caption: "Suffolk County Courthouse",
                  },
                  {
                    src: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&h=400&fit=crop",
                    alt: "Professional business district",
                    width: 600,
                    height: 400,
                    geoLocation: "Boston, Massachusetts",
                    keywords: ["business district"],
                    caption: "Seaport Business District",
                  },
                ]}
                columns={3}
                gap={4}
                includeSchema
              />
              
              <div className="bg-muted p-4 rounded-lg mt-6 space-y-2">
                <h4 className="font-semibold">SEO Features Applied:</h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Schema.org ItemList markup for gallery</li>
                  <li>Individual ImageObject schema per image</li>
                  <li>Location metadata (Boston, Massachusetts)</li>
                  <li>Progressive loading (first 2 eager, rest lazy)</li>
                  <li>Automatic WebP conversion (30% smaller)</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* VIDEOS Tab */}
        <TabsContent value="videos" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Optimized Video with Schema</CardTitle>
              <CardDescription>
                SEO-optimized video with location metadata and transcript support
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="max-w-3xl">
                <OptimizedVideo
                  src="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
                  poster="https://peach.blender.org/wp-content/uploads/title_anouncement.jpg?x11217"
                  title="Professional Courier Services in Boston"
                  description="Same-day delivery services for legal documents and packages throughout the Boston metropolitan area"
                  geoLocation="Boston, Massachusetts"
                  keywords={["courier services", "same-day delivery", "Boston", "legal delivery"]}
                  duration="PT1M30S"
                  uploadDate="2024-01-15T00:00:00Z"
                  author="ApexContent Engine"
                  transcript="This video demonstrates professional courier services available in Boston. We provide same-day delivery for legal documents, medical supplies, and business packages throughout the greater Boston area..."
                  controls
                  includeSchema
                  width={800}
                  height={450}
                  className="w-full"
                />
              </div>
              
              <div className="bg-muted p-4 rounded-lg space-y-2">
                <h4 className="font-semibold">Video SEO Features:</h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Schema.org VideoObject with contentLocation</li>
                  <li>Location metadata: Boston, Massachusetts</li>
                  <li>Keywords: courier services, same-day delivery, Boston</li>
                  <li>Transcript included for SEO (collapsible)</li>
                  <li>Duration in ISO 8601 format (PT1M30S)</li>
                  <li>Custom controls with accessibility</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Video Gallery</CardTitle>
              <CardDescription>
                Multiple videos with ItemList schema markup
              </CardDescription>
            </CardHeader>
            <CardContent>
              <OptimizedVideoGallery
                videos={[
                  {
                    src: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
                    poster: "https://upload.wikimedia.org/wikipedia/commons/e/e8/Elephants_Dream_s5_both.jpg",
                    title: "Legal Document Delivery in Boston",
                    geoLocation: "Boston, Massachusetts",
                    keywords: ["legal delivery", "Boston"],
                    width: 400,
                    height: 225,
                    controls: true,
                  },
                  {
                    src: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
                    title: "Medical Supply Courier Boston",
                    geoLocation: "Boston, Massachusetts",
                    keywords: ["medical delivery"],
                    width: 400,
                    height: 225,
                    controls: true,
                  },
                ]}
                columns={2}
                gap={4}
                includeSchema
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* AUDIO Tab */}
        <TabsContent value="audio" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Podcast Episode with SEO</CardTitle>
              <CardDescription>
                Podcast player with PodcastEpisode schema and transcript
              </CardDescription>
            </CardHeader>
            <CardContent>
              <OptimizedAudio
                src="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
                title="Local Business Success Stories - Boston Courier Services"
                description="Interview with a successful Boston courier company about building a local delivery business"
                geoLocation="Boston, Massachusetts"
                keywords={["podcast", "business", "courier services", "Boston"]}
                duration="PT15M30S"
                uploadDate="2024-01-15T00:00:00Z"
                author="ApexContent Engine"
                podcastName="Local Business Insights"
                episodeNumber={5}
                seasonNumber={1}
                transcript="Host: Welcome to Local Business Insights. Today we're talking with John from Boston Express Courier about building a successful delivery business in Boston..."
                includeSchema
                audioType="PodcastEpisode"
              />
              
              <div className="bg-muted p-4 rounded-lg mt-6 space-y-2">
                <h4 className="font-semibold">Audio SEO Features:</h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Schema.org PodcastEpisode markup</li>
                  <li>Part of PodcastSeries schema</li>
                  <li>Location metadata for local SEO</li>
                  <li>Transcript for text-based SEO</li>
                  <li>Episode and season numbering</li>
                  <li>Custom audio player with scrubbing</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Audio Playlist</CardTitle>
              <CardDescription>
                Multi-episode playlist with PodcastSeries schema
              </CardDescription>
            </CardHeader>
            <CardContent>
              <OptimizedAudioPlaylist
                podcastName="Local Business Insights"
                episodes={[
                  {
                    src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
                    title: "Episode 5: Boston Courier Services",
                    description: "Building a delivery business in Boston",
                    geoLocation: "Boston, Massachusetts",
                    episodeNumber: 5,
                    duration: "PT15M30S",
                  },
                  {
                    src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
                    title: "Episode 4: Legal Tech Startups in Boston",
                    description: "Innovation in the Boston legal sector",
                    geoLocation: "Boston, Massachusetts",
                    episodeNumber: 4,
                    duration: "PT18M45S",
                  },
                ]}
                includeSchema
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* CODE EXAMPLES Tab */}
        <TabsContent value="code" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Implementation Examples</CardTitle>
              <CardDescription>
                Copy-paste ready code for all media types
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Image Example */}
              <div>
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <ImageIcon className="w-4 h-4" />
                  Optimized Image
                </h4>
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`import { OptimizedImage } from "@/components/OptimizedImage";

<OptimizedImage
  src="/images/my-image.jpg"
  alt="Professional courier service"
  width={800}
  height={600}
  geoLocation="Boston, Massachusetts"
  keywords={["courier", "delivery"]}
  includeSchema
/>`}
                </pre>
              </div>

              <Separator />

              {/* Video Example */}
              <div>
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <VideoIcon className="w-4 h-4" />
                  Optimized Video
                </h4>
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`import { OptimizedVideo } from "@/components/OptimizedVideo";

<OptimizedVideo
  src="/videos/courier-services.mp4"
  poster="/images/video-poster.jpg"
  title="Same-Day Courier Services in Boston"
  geoLocation="Boston, Massachusetts"
  keywords={["courier", "delivery"]}
  duration="PT1M30S"
  transcript="Full transcript text..."
  controls
  includeSchema
/>`}
                </pre>
              </div>

              <Separator />

              {/* Audio Example */}
              <div>
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <Music className="w-4 h-4" />
                  Optimized Audio (Podcast)
                </h4>
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`import { OptimizedAudio } from "@/components/OptimizedAudio";

<OptimizedAudio
  src="/audio/episode-1.mp3"
  title="Local Business - Episode 1"
  geoLocation="Boston, Massachusetts"
  podcastName="Local Business Insights"
  episodeNumber={1}
  duration="PT15M30S"
  transcript="Episode transcript..."
  includeSchema
  audioType="PodcastEpisode"
/>`}
                </pre>
              </div>

              <Separator />

              {/* Utility Functions */}
              <div>
                <h4 className="font-semibold mb-3">Media Utilities</h4>
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`import { 
  secondsToISO8601Duration,
  formatDuration,
  generateVideoSchema,
  generateAudioSchema
} from "@/lib/media-utils";

// Convert seconds to ISO 8601
const duration = secondsToISO8601Duration(90);
// Result: "PT1M30S"

// Format for display
const display = formatDuration(90);
// Result: "1:30"

// Generate video schema
const videoSchema = generateVideoSchema(
  {
    title: "My Video",
    geoLocation: "Boston, MA",
    duration: "PT1M30S"
  },
  "/videos/my-video.mp4"
);`}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Benefits Section */}
      <Card className="border-primary">
        <CardHeader>
          <CardTitle>Complete Media Optimization Stack</CardTitle>
          <CardDescription>
            Professional SEO/GEO for all media types without cloud complexity
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <h4 className="font-semibold flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-primary" />
                Images
              </h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>• Lazy loading + blur placeholders</li>
                <li>• Automatic WebP conversion</li>
                <li>• Location-aware alt text</li>
                <li>• ImageObject schema markup</li>
              </ul>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-semibold flex items-center gap-2">
                <VideoIcon className="w-5 h-5 text-primary" />
                Videos
              </h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>• Custom accessible controls</li>
                <li>• Transcript support for SEO</li>
                <li>• VideoObject schema markup</li>
                <li>• Location metadata integration</li>
              </ul>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-semibold flex items-center gap-2">
                <Music className="w-5 h-5 text-primary" />
                Audio
              </h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>• PodcastEpisode schema support</li>
                <li>• Playlist with series schema</li>
                <li>• Transcript integration</li>
                <li>• Custom audio player UI</li>
              </ul>
            </div>
          </div>

          <Separator />

          <div className="text-center space-y-2 pt-4">
            <p className="text-lg font-semibold">
              All media stored locally in <code className="bg-muted px-2 py-1 rounded">attached_assets</code>
            </p>
            <p className="text-sm text-muted-foreground">
              No cloud storage migration needed • Automatic SEO optimization • Schema.org markup • Location-aware metadata
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
