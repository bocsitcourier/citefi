"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Play, Pause, Volume2, VolumeX, Maximize, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface OptimizedVideoProps {
  src: string;
  poster?: string;
  alt?: string;
  width?: number;
  height?: number;
  className?: string;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  controls?: boolean;
  
  // SEO/GEO Enhancement Props
  title: string;
  description?: string;
  geoLocation?: string;
  keywords?: string[];
  duration?: string; // ISO 8601 duration (e.g., "PT1M30S" for 1:30)
  uploadDate?: string; // ISO 8601 date
  thumbnailUrl?: string;
  transcript?: string;
  author?: string;
  contentUrl?: string;
  
  // Performance
  preload?: "none" | "metadata" | "auto";
  lazy?: boolean;
  
  // Accessibility
  captions?: string; // VTT file URL
  ariaLabel?: string;
  
  // Schema.org
  includeSchema?: boolean;
  videoType?: "VideoObject" | "Clip" | "BroadcastEvent";
}

/**
 * OptimizedVideo - SEO/GEO-optimized video component
 * 
 * Features:
 * - Schema.org VideoObject markup with location data
 * - Lazy loading with intersection observer
 * - Custom controls with accessibility
 * - Transcript support for SEO
 * - Location-aware metadata
 * - Responsive sizing
 * 
 * @example
 * ```tsx
 * <OptimizedVideo
 *   src="/videos/courier-services.mp4"
 *   poster="/images/video-poster.jpg"
 *   title="Same-Day Courier Services in Boston"
 *   description="Professional courier delivering legal documents"
 *   geoLocation="Boston, Massachusetts"
 *   keywords={["courier", "delivery", "legal services"]}
 *   duration="PT1M30S"
 *   includeSchema
 * />
 * ```
 */
export function OptimizedVideo({
  src,
  poster,
  alt,
  width,
  height,
  className,
  autoPlay = false,
  muted = false,
  loop = false,
  controls = true,
  title,
  description,
  geoLocation,
  keywords = [],
  duration,
  uploadDate,
  thumbnailUrl,
  transcript,
  author,
  contentUrl,
  preload = "metadata",
  lazy = true,
  captions,
  ariaLabel,
  includeSchema = false,
  videoType = "VideoObject",
}: OptimizedVideoProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(muted);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(!lazy);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Lazy loading with Intersection Observer
  useEffect(() => {
    if (!lazy || shouldLoad) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShouldLoad(true);
          }
        });
      },
      { rootMargin: "100px" }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [lazy, shouldLoad]);

  // Generate schema.org VideoObject JSON-LD
  const generateVideoSchema = () => {
    if (!includeSchema) return null;

    const schema = {
      "@context": "https://schema.org",
      "@type": videoType,
      name: title,
      description: description || alt || title,
      contentUrl: contentUrl || src,
      thumbnailUrl: thumbnailUrl || poster,
      uploadDate: uploadDate || new Date().toISOString(),
      ...(duration && { duration }),
      ...(width && height && {
        width: `${width}px`,
        height: `${height}px`,
      }),
      ...(author && {
        author: {
          "@type": "Person",
          name: author,
        },
      }),
      ...(geoLocation && {
        contentLocation: {
          "@type": "Place",
          name: geoLocation,
        },
      }),
      ...(keywords.length > 0 && { keywords: keywords.join(", ") }),
      ...(transcript && {
        transcript: {
          "@type": "MediaObject",
          encodingFormat: "text/plain",
          text: transcript,
        },
      }),
    };

    return (
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
    );
  };

  const togglePlay = () => {
    if (!videoRef.current) return;

    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const toggleFullscreen = () => {
    if (!videoRef.current) return;
    if (videoRef.current.requestFullscreen) {
      videoRef.current.requestFullscreen();
    }
  };

  const handleLoadedData = () => {
    setIsLoading(false);
  };

  const handleError = () => {
    setHasError(true);
    setIsLoading(false);
  };

  if (hasError) {
    return (
      <div
        className={cn(
          "bg-muted flex items-center justify-center text-muted-foreground rounded-lg",
          className
        )}
        style={{ width, height }}
        role="img"
        aria-label={`Failed to load video: ${title}`}
      >
        <div className="text-center space-y-2">
          <p className="text-sm font-medium">Video unavailable</p>
          <p className="text-xs">{title}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {generateVideoSchema()}
      <div
        ref={containerRef}
        className={cn("relative overflow-hidden rounded-lg bg-black", className)}
        style={width && height ? { width, height } : undefined}
      >
        {shouldLoad ? (
          <>
            <video
              ref={videoRef}
              src={src}
              poster={poster}
              width={width}
              height={height}
              autoPlay={autoPlay}
              muted={isMuted}
              loop={loop}
              controls={controls}
              preload={preload}
              onLoadedData={handleLoadedData}
              onError={handleError}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              className="w-full h-full"
              aria-label={ariaLabel || title}
              data-geo-location={geoLocation}
              data-keywords={keywords.join(",")}
            >
              {captions && <track kind="captions" src={captions} srcLang="en" label="English" />}
              Your browser does not support the video tag.
            </video>

            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <Loader2 className="w-12 h-12 text-white animate-spin" />
              </div>
            )}

            {/* Custom Controls (only if controls=false) */}
            {!controls && !isLoading && (
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 flex items-center gap-2">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={togglePlay}
                  className="text-white hover:bg-white/20"
                  data-testid="button-video-play"
                >
                  {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={toggleMute}
                  className="text-white hover:bg-white/20"
                  data-testid="button-video-mute"
                >
                  {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </Button>
                <div className="flex-1" />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={toggleFullscreen}
                  className="text-white hover:bg-white/20"
                  data-testid="button-video-fullscreen"
                >
                  <Maximize className="w-5 h-5" />
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted">
            <p className="text-sm text-muted-foreground">Loading video...</p>
          </div>
        )}
      </div>

      {/* Transcript for SEO */}
      {transcript && (
        <details className="mt-2">
          <summary className="text-sm font-medium cursor-pointer">View Transcript</summary>
          <div className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">
            {transcript}
          </div>
        </details>
      )}

      {/* Caption/Description */}
      {description && (
        <p className="mt-2 text-sm text-muted-foreground text-center">{description}</p>
      )}
    </>
  );
}

/**
 * OptimizedVideoGallery - SEO-optimized video gallery
 * 
 * @example
 * ```tsx
 * <OptimizedVideoGallery
 *   videos={[
 *     {
 *       src: "/videos/video1.mp4",
 *       poster: "/images/poster1.jpg",
 *       title: "Video 1",
 *       geoLocation: "Boston, MA"
 *     }
 *   ]}
 *   columns={2}
 * />
 * ```
 */
export interface OptimizedVideoGalleryProps {
  videos: OptimizedVideoProps[];
  columns?: 2 | 3 | 4;
  gap?: 2 | 4 | 6 | 8;
  includeSchema?: boolean;
  className?: string;
}

export function OptimizedVideoGallery({
  videos,
  columns = 2,
  gap = 4,
  includeSchema = false,
  className,
}: OptimizedVideoGalleryProps) {
  const gridCols = {
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
  };

  const gridGap = {
    2: "gap-2",
    4: "gap-4",
    6: "gap-6",
    8: "gap-8",
  };

  // Generate ItemList schema for gallery
  const gallerySchema = includeSchema
    ? {
        "@context": "https://schema.org",
        "@type": "ItemList",
        itemListElement: videos.map((video, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: {
            "@type": "VideoObject",
            name: video.title,
            contentUrl: video.contentUrl || video.src,
            thumbnailUrl: video.thumbnailUrl || video.poster,
            ...(video.geoLocation && {
              contentLocation: {
                "@type": "Place",
                name: video.geoLocation,
              },
            }),
          },
        })),
      }
    : null;

  return (
    <>
      {gallerySchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(gallerySchema) }}
        />
      )}
      <div className={cn("grid", gridCols[columns], gridGap[gap], className)}>
        {videos.map((video, index) => (
          <OptimizedVideo
            key={`${video.src}-${index}`}
            {...video}
            includeSchema={includeSchema}
            lazy={index >= 2}
          />
        ))}
      </div>
    </>
  );
}
