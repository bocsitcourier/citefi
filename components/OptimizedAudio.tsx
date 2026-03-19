"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Play, Pause, Volume2, VolumeX, SkipBack, SkipForward, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

export interface OptimizedAudioProps {
  src: string;
  className?: string;
  autoPlay?: boolean;
  loop?: boolean;
  
  // SEO/GEO Enhancement Props
  title: string;
  description?: string;
  geoLocation?: string;
  keywords?: string[];
  duration?: string; // ISO 8601 duration (e.g., "PT15M30S" for 15:30)
  uploadDate?: string; // ISO 8601 date
  author?: string;
  contentUrl?: string;
  
  // Podcast-specific
  episodeNumber?: number;
  seasonNumber?: number;
  podcastName?: string;
  transcript?: string;
  
  // Performance
  preload?: "none" | "metadata" | "auto";
  
  // Accessibility
  ariaLabel?: string;
  
  // Schema.org
  includeSchema?: boolean;
  audioType?: "AudioObject" | "PodcastEpisode" | "MusicRecording";
}

/**
 * OptimizedAudio - SEO/GEO-optimized audio component
 * 
 * Features:
 * - Schema.org AudioObject/PodcastEpisode markup
 * - Custom audio player with accessibility
 * - Transcript support for SEO
 * - Location-aware metadata
 * - Podcast episode support
 * 
 * @example
 * ```tsx
 * <OptimizedAudio
 *   src="/audio/podcast-episode-1.mp3"
 *   title="Courier Services in Boston - Episode 1"
 *   description="Discussion about same-day delivery in Boston"
 *   geoLocation="Boston, Massachusetts"
 *   keywords={["courier", "podcast", "Boston"]}
 *   podcastName="Local Business Insights"
 *   episodeNumber={1}
 *   includeSchema
 * />
 * ```
 */
export function OptimizedAudio({
  src,
  className,
  autoPlay = false,
  loop = false,
  title,
  description,
  geoLocation,
  keywords = [],
  duration,
  uploadDate,
  author,
  contentUrl,
  episodeNumber,
  seasonNumber,
  podcastName,
  transcript,
  preload = "metadata",
  ariaLabel,
  includeSchema = false,
  audioType = "AudioObject",
}: OptimizedAudioProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Update current time
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => setAudioDuration(audio.duration);

    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("loadedmetadata", updateDuration);

    return () => {
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("loadedmetadata", updateDuration);
    };
  }, []);

  // Generate schema.org AudioObject/PodcastEpisode JSON-LD
  const generateAudioSchema = () => {
    if (!includeSchema) return null;

    const baseSchema = {
      "@context": "https://schema.org",
      "@type": audioType,
      name: title,
      description: description || title,
      contentUrl: contentUrl || src,
      uploadDate: uploadDate || new Date().toISOString(),
      ...(duration && { duration }),
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

    // Add podcast-specific fields
    if (audioType === "PodcastEpisode") {
      return {
        ...baseSchema,
        ...(episodeNumber && { episodeNumber }),
        ...(seasonNumber && { partOfSeason: { "@type": "PodcastSeason", seasonNumber } }),
        ...(podcastName && {
          partOfSeries: {
            "@type": "PodcastSeries",
            name: podcastName,
          },
        }),
      };
    }

    return (
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(baseSchema) }}
      />
    );
  };

  const togglePlay = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    audioRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleSeek = (value: number[]) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = value[0];
    setCurrentTime(value[0]);
  };

  const skipForward = () => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.min(audioRef.current.currentTime + 10, audioDuration);
  };

  const skipBackward = () => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(audioRef.current.currentTime - 10, 0);
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
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
          "bg-muted flex items-center justify-center text-muted-foreground rounded-lg p-6",
          className
        )}
        role="img"
        aria-label={`Failed to load audio: ${title}`}
      >
        <div className="text-center space-y-2">
          <p className="text-sm font-medium">Audio unavailable</p>
          <p className="text-xs">{title}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {generateAudioSchema()}
      <div className={cn("bg-card border rounded-lg p-6 space-y-4", className)}>
        {/* Hidden audio element */}
        <audio
          ref={audioRef}
          src={src}
          autoPlay={autoPlay}
          loop={loop}
          preload={preload}
          onLoadedData={handleLoadedData}
          onError={handleError}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          aria-label={ariaLabel || title}
          data-geo-location={geoLocation}
          data-keywords={keywords.join(",")}
        />

        {/* Title and Metadata */}
        <div className="space-y-1">
          <h3 className="font-semibold text-lg" data-testid="text-audio-title">
            {title}
          </h3>
          {podcastName && episodeNumber && (
            <p className="text-sm text-muted-foreground">
              {podcastName} • Episode {episodeNumber}
              {seasonNumber && ` • Season ${seasonNumber}`}
            </p>
          )}
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
          {geoLocation && (
            <p className="text-xs text-muted-foreground">📍 {geoLocation}</p>
          )}
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <Slider
            value={[currentTime]}
            max={audioDuration || 100}
            step={1}
            onValueChange={handleSeek}
            className="cursor-pointer"
            disabled={isLoading}
            data-testid="slider-audio-progress"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(audioDuration)}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            onClick={skipBackward}
            disabled={isLoading}
            data-testid="button-audio-skip-back"
          >
            <SkipBack className="w-5 h-5" />
          </Button>
          
          <Button
            size="icon"
            variant="default"
            onClick={togglePlay}
            disabled={isLoading}
            className="w-12 h-12"
            data-testid="button-audio-play"
          >
            {isLoading ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-6 h-6" />
            ) : (
              <Play className="w-6 h-6" />
            )}
          </Button>
          
          <Button
            size="icon"
            variant="ghost"
            onClick={skipForward}
            disabled={isLoading}
            data-testid="button-audio-skip-forward"
          >
            <SkipForward className="w-5 h-5" />
          </Button>
          
          <div className="flex-1" />
          
          <Button
            size="icon"
            variant="ghost"
            onClick={toggleMute}
            disabled={isLoading}
            data-testid="button-audio-mute"
          >
            {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </Button>
        </div>

        {/* Transcript for SEO */}
        {transcript && (
          <details className="pt-4 border-t">
            <summary className="text-sm font-medium cursor-pointer">
              View Transcript
            </summary>
            <div className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap max-h-60 overflow-y-auto">
              {transcript}
            </div>
          </details>
        )}
      </div>
    </>
  );
}

/**
 * OptimizedAudioPlaylist - SEO-optimized audio playlist
 * 
 * @example
 * ```tsx
 * <OptimizedAudioPlaylist
 *   episodes={[
 *     {
 *       src: "/audio/ep1.mp3",
 *       title: "Episode 1",
 *       podcastName: "My Podcast"
 *     }
 *   ]}
 *   includeSchema
 * />
 * ```
 */
export interface OptimizedAudioPlaylistProps {
  episodes: OptimizedAudioProps[];
  podcastName?: string;
  includeSchema?: boolean;
  className?: string;
}

export function OptimizedAudioPlaylist({
  episodes,
  podcastName,
  includeSchema = false,
  className,
}: OptimizedAudioPlaylistProps) {
  const [currentEpisode, setCurrentEpisode] = useState(0);

  // Generate PodcastSeries schema
  const playlistSchema = includeSchema
    ? {
        "@context": "https://schema.org",
        "@type": "PodcastSeries",
        name: podcastName || "Podcast",
        episodes: episodes.map((episode, index) => ({
          "@type": "PodcastEpisode",
          name: episode.title,
          episodeNumber: episode.episodeNumber || index + 1,
          contentUrl: episode.contentUrl || episode.src,
          ...(episode.geoLocation && {
            contentLocation: {
              "@type": "Place",
              name: episode.geoLocation,
            },
          }),
        })),
      }
    : null;

  return (
    <>
      {playlistSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(playlistSchema) }}
        />
      )}
      <div className={cn("space-y-4", className)}>
        {/* Current Episode */}
        <OptimizedAudio
          {...episodes[currentEpisode]}
          podcastName={podcastName || episodes[currentEpisode].podcastName}
          includeSchema={includeSchema}
        />

        {/* Episode List */}
        {episodes.length > 1 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Playlist</h4>
            <div className="space-y-1">
              {episodes.map((episode, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentEpisode(index)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-md text-sm transition-colors hover-elevate",
                    currentEpisode === index
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  )}
                  data-testid={`button-episode-${index}`}
                >
                  <div className="font-medium">{episode.title}</div>
                  {episode.description && (
                    <div className="text-xs opacity-80 truncate">{episode.description}</div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
