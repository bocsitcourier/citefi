/**
 * Media Optimization Utilities (Video & Audio)
 * 
 * Provides utility functions for SEO/GEO-optimized media handling:
 * - Video/audio metadata generation
 * - Schema.org markup helpers
 * - Duration formatting
 * - Transcript processing
 */

export interface VideoMetadata {
  title: string;
  description?: string;
  geoLocation?: string;
  keywords?: string[];
  duration?: string;
  uploadDate?: string;
  thumbnailUrl?: string;
  transcript?: string;
  author?: string;
}

export interface AudioMetadata {
  title: string;
  description?: string;
  geoLocation?: string;
  keywords?: string[];
  duration?: string;
  uploadDate?: string;
  author?: string;
  episodeNumber?: number;
  seasonNumber?: number;
  podcastName?: string;
  transcript?: string;
}

/**
 * Convert seconds to ISO 8601 duration format
 * 
 * @param seconds - Duration in seconds
 * @returns ISO 8601 duration string (e.g., "PT1M30S")
 * 
 * @example
 * ```ts
 * secondsToISO8601Duration(90)  // "PT1M30S" (1 minute 30 seconds)
 * secondsToISO8601Duration(3665)  // "PT1H1M5S" (1 hour 1 minute 5 seconds)
 * ```
 */
export function secondsToISO8601Duration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  let duration = "PT";
  if (hours > 0) duration += `${hours}H`;
  if (minutes > 0) duration += `${minutes}M`;
  if (secs > 0 || duration === "PT") duration += `${secs}S`;
  
  return duration;
}

/**
 * Convert ISO 8601 duration to seconds
 * 
 * @param duration - ISO 8601 duration string
 * @returns Duration in seconds
 * 
 * @example
 * ```ts
 * iso8601DurationToSeconds("PT1M30S")  // 90
 * iso8601DurationToSeconds("PT1H5M")  // 3900
 * ```
 */
export function iso8601DurationToSeconds(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  
  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);
  
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Format seconds to human-readable time (MM:SS or HH:MM:SS)
 * 
 * @param seconds - Duration in seconds
 * @returns Formatted time string
 * 
 * @example
 * ```ts
 * formatDuration(90)  // "1:30"
 * formatDuration(3665)  // "1:01:05"
 * ```
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Generate VideoObject schema.org markup
 * 
 * @param metadata - Video metadata
 * @param src - Video source URL
 * @param width - Video width in pixels
 * @param height - Video height in pixels
 * @returns JSON-LD schema object
 * 
 * @example
 * ```ts
 * generateVideoSchema(
 *   {
 *     title: "Courier Services in Boston",
 *     description: "Professional delivery services",
 *     geoLocation: "Boston, MA",
 *     duration: "PT1M30S",
 *     keywords: ["courier", "delivery"]
 *   },
 *   "/videos/courier.mp4",
 *   1920,
 *   1080
 * )
 * ```
 */
export function generateVideoSchema(
  metadata: VideoMetadata,
  src: string,
  width?: number,
  height?: number
) {
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: metadata.title,
    description: metadata.description || metadata.title,
    contentUrl: src,
    thumbnailUrl: metadata.thumbnailUrl,
    uploadDate: metadata.uploadDate || new Date().toISOString(),
    ...(metadata.duration && { duration: metadata.duration }),
    ...(width && height && {
      width: `${width}px`,
      height: `${height}px`,
    }),
    ...(metadata.author && {
      author: {
        "@type": "Person",
        name: metadata.author,
      },
    }),
    ...(metadata.geoLocation && {
      contentLocation: {
        "@type": "Place",
        name: metadata.geoLocation,
      },
    }),
    ...(metadata.keywords && metadata.keywords.length > 0 && {
      keywords: metadata.keywords.join(", "),
    }),
    ...(metadata.transcript && {
      transcript: {
        "@type": "MediaObject",
        encodingFormat: "text/plain",
        text: metadata.transcript,
      },
    }),
  };
}

/**
 * Generate AudioObject schema.org markup
 * 
 * @param metadata - Audio metadata
 * @param src - Audio source URL
 * @returns JSON-LD schema object
 * 
 * @example
 * ```ts
 * generateAudioSchema(
 *   {
 *     title: "Local Business Podcast - Episode 1",
 *     geoLocation: "Boston, MA",
 *     duration: "PT15M30S",
 *     podcastName: "Local Business Insights"
 *   },
 *   "/audio/episode-1.mp3"
 * )
 * ```
 */
export function generateAudioSchema(metadata: AudioMetadata, src: string) {
  const isPodcast = metadata.episodeNumber !== undefined || metadata.podcastName !== undefined;
  
  const baseSchema = {
    "@context": "https://schema.org",
    "@type": isPodcast ? "PodcastEpisode" : "AudioObject",
    name: metadata.title,
    description: metadata.description || metadata.title,
    contentUrl: src,
    uploadDate: metadata.uploadDate || new Date().toISOString(),
    ...(metadata.duration && { duration: metadata.duration }),
    ...(metadata.author && {
      author: {
        "@type": "Person",
        name: metadata.author,
      },
    }),
    ...(metadata.geoLocation && {
      contentLocation: {
        "@type": "Place",
        name: metadata.geoLocation,
      },
    }),
    ...(metadata.keywords && metadata.keywords.length > 0 && {
      keywords: metadata.keywords.join(", "),
    }),
    ...(metadata.transcript && {
      transcript: {
        "@type": "MediaObject",
        encodingFormat: "text/plain",
        text: metadata.transcript,
      },
    }),
  };
  
  // Add podcast-specific fields
  if (isPodcast) {
    return {
      ...baseSchema,
      ...(metadata.episodeNumber && { episodeNumber: metadata.episodeNumber }),
      ...(metadata.seasonNumber && {
        partOfSeason: {
          "@type": "PodcastSeason",
          seasonNumber: metadata.seasonNumber,
        },
      }),
      ...(metadata.podcastName && {
        partOfSeries: {
          "@type": "PodcastSeries",
          name: metadata.podcastName,
        },
      }),
    };
  }
  
  return baseSchema;
}

/**
 * Generate PodcastSeries schema for playlist
 * 
 * @param podcastName - Name of podcast series
 * @param episodes - Array of episode metadata
 * @returns JSON-LD schema object
 */
export function generatePodcastSeriesSchema(
  podcastName: string,
  episodes: AudioMetadata[]
) {
  return {
    "@context": "https://schema.org",
    "@type": "PodcastSeries",
    name: podcastName,
    episodes: episodes.map((episode, index) => ({
      "@type": "PodcastEpisode",
      name: episode.title,
      episodeNumber: episode.episodeNumber || index + 1,
      contentUrl: episode.description || "",
      ...(episode.geoLocation && {
        contentLocation: {
          "@type": "Place",
          name: episode.geoLocation,
        },
      }),
    })),
  };
}

/**
 * Extract location from video/audio title or description
 * 
 * @param text - Title or description text
 * @returns Extracted location or null
 * 
 * @example
 * ```ts
 * extractLocationFromMedia("Courier Services in Boston, MA")
 * // Returns: "Boston, MA"
 * ```
 */
export function extractLocationFromMedia(text: string): string | null {
  // Common patterns for media titles
  const patterns = [
    /\bin\s+([A-Z][a-zA-Z\s,]+?)(?:\s*[-–—]|$)/,
    /\bat\s+([A-Z][a-zA-Z\s,]+?)(?:\s*[-–—]|$)/,
    /([A-Z][a-zA-Z\s,]+?)\s*[-–—]\s*/,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return null;
}

/**
 * Generate SEO-optimized video title
 * 
 * @param baseTitle - Base title
 * @param location - Geographic location
 * @param keywords - SEO keywords
 * @returns Optimized video title
 * 
 * @example
 * ```ts
 * generateSEOVideoTitle(
 *   "Courier Services",
 *   "Boston, MA",
 *   ["same-day delivery"]
 * )
 * // Returns: "Courier Services in Boston, MA - Same-Day Delivery"
 * ```
 */
export function generateSEOVideoTitle(
  baseTitle: string,
  location?: string,
  keywords: string[] = []
): string {
  let title = baseTitle.trim();
  
  // Add location if not present
  if (location && !title.toLowerCase().includes(location.toLowerCase())) {
    title = `${title} in ${location}`;
  }
  
  // Add primary keyword if provided
  if (keywords.length > 0) {
    const primaryKeyword = keywords[0];
    title = `${title} - ${primaryKeyword.charAt(0).toUpperCase() + primaryKeyword.slice(1)}`;
  }
  
  // Limit to 100 characters for YouTube/video SEO
  if (title.length > 100) {
    title = title.substring(0, 97) + "...";
  }
  
  return title;
}

/**
 * Clean and format transcript for SEO
 * 
 * @param transcript - Raw transcript text
 * @param maxLength - Maximum length (default: 5000 chars)
 * @returns Cleaned transcript
 */
export function cleanTranscript(transcript: string, maxLength: number = 5000): string {
  // Remove extra whitespace and normalize line breaks
  let cleaned = transcript
    .replace(/\s+/g, " ")
    .replace(/\n+/g, "\n")
    .trim();
  
  // Truncate if too long
  if (cleaned.length > maxLength) {
    cleaned = cleaned.substring(0, maxLength - 20) + "\n\n[Transcript truncated...]";
  }
  
  return cleaned;
}

/**
 * Validate video/audio URL format
 * 
 * @param url - URL to validate
 * @returns True if valid media URL
 */
export function isValidMediaUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const videoExtensions = [".mp4", ".webm", ".ogg", ".mov", ".avi"];
    const audioExtensions = [".mp3", ".wav", ".ogg", ".m4a", ".aac"];
    const validExtensions = [...videoExtensions, ...audioExtensions];
    
    return validExtensions.some((ext) =>
      parsedUrl.pathname.toLowerCase().endsWith(ext)
    );
  } catch {
    return false;
  }
}

/**
 * Generate video thumbnail URL from video source
 * 
 * @param videoSrc - Video source URL
 * @param format - Thumbnail format (default: "jpg")
 * @returns Thumbnail URL
 */
export function generateVideoThumbnailUrl(
  videoSrc: string,
  format: "jpg" | "png" | "webp" = "jpg"
): string {
  // Replace video extension with thumbnail extension
  return videoSrc.replace(/\.(mp4|webm|ogg|mov)$/i, `.${format}`);
}

/**
 * Calculate optimal video bitrate based on resolution
 * 
 * @param width - Video width
 * @param height - Video height
 * @param fps - Frames per second (default: 30)
 * @returns Recommended bitrate in kbps
 */
export function calculateOptimalVideoBitrate(
  width: number,
  height: number,
  fps: number = 30
): number {
  const pixels = width * height;
  const baseRate = 0.07; // bits per pixel per frame
  
  // Calculate bitrate in kbps
  const bitrate = Math.round((pixels * fps * baseRate) / 1000);
  
  // Apply reasonable bounds
  return Math.min(Math.max(bitrate, 500), 8000);
}
