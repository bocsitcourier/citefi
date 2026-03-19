"use client";

import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

export interface OptimizedImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
  quality?: number;
  fill?: boolean;
  objectFit?: "contain" | "cover" | "fill" | "none" | "scale-down";
  
  // SEO/GEO Enhancement Props
  geoLocation?: string;
  keywords?: string[];
  caption?: string;
  author?: string;
  contentUrl?: string;
  
  // Lazy Loading & Performance
  loading?: "lazy" | "eager";
  placeholder?: "blur" | "empty";
  blurDataURL?: string;
  
  // Accessibility
  ariaLabel?: string;
  role?: string;
  
  // Schema.org JSON-LD
  includeSchema?: boolean;
}

/**
 * OptimizedImage - SEO/GEO-optimized image component
 * 
 * Features:
 * - Automatic lazy loading with blur placeholder
 * - Responsive image sizing with Next.js Image optimization
 * - SEO-optimized alt text with location keywords
 * - Optional JSON-LD schema markup (ImageObject)
 * - Accessibility compliant (ARIA labels, roles)
 * - Progressive enhancement with loading states
 * - Automatic WebP conversion via Next.js
 * 
 * @example
 * ```tsx
 * <OptimizedImage
 *   src="/images/boston-courthouse.jpg"
 *   alt="Suffolk County Courthouse in downtown Boston"
 *   width={800}
 *   height={600}
 *   geoLocation="Boston, Massachusetts"
 *   keywords={["courthouse", "legal services", "Boston"]}
 *   includeSchema
 * />
 * ```
 */
export function OptimizedImage({
  src,
  alt,
  width,
  height,
  className,
  priority = false,
  quality = 85,
  fill = false,
  objectFit = "cover",
  geoLocation,
  keywords = [],
  caption,
  author,
  contentUrl,
  loading = "lazy",
  placeholder = "blur",
  blurDataURL,
  ariaLabel,
  role,
  includeSchema = false,
}: OptimizedImageProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Enhanced alt text with location keywords
  const enhancedAlt = geoLocation && !alt.toLowerCase().includes(geoLocation.toLowerCase())
    ? `${alt} - ${geoLocation}`
    : alt;

  // Generate schema.org ImageObject JSON-LD
  const generateImageSchema = () => {
    if (!includeSchema) return null;

    const schema = {
      "@context": "https://schema.org",
      "@type": "ImageObject",
      contentUrl: contentUrl || src,
      url: contentUrl || src,
      name: alt,
      description: caption || alt,
      ...(width && height && {
        width: `${width}px`,
        height: `${height}px`,
      }),
      ...(author && { author: { "@type": "Person", name: author } }),
      ...(geoLocation && {
        contentLocation: {
          "@type": "Place",
          name: geoLocation,
        },
      }),
      ...(keywords.length > 0 && { keywords: keywords.join(", ") }),
    };

    return (
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
    );
  };

  // Fallback image on error
  const handleError = () => {
    setHasError(true);
    setIsLoading(false);
  };

  // Handle successful load
  const handleLoad = () => {
    setIsLoading(false);
  };

  // Generate LQIP (Low Quality Image Placeholder) if not provided
  const defaultBlurDataURL = 
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 300'%3E%3Cfilter id='b' color-interpolation-filters='sRGB'%3E%3CfeGaussianBlur stdDeviation='20'/%3E%3C/filter%3E%3Cimage filter='url(%23b)' width='100%25' height='100%25' preserveAspectRatio='none' href='data:image/svg+xml,%3Csvg xmlns=\"http://www.w3.org/2000/svg\"%3E%3Crect width=\"400\" height=\"300\" fill=\"%23e5e7eb\"/%3E%3C/svg%3E'/%3E%3C/svg%3E";

  if (hasError) {
    return (
      <div
        className={cn(
          "bg-muted flex items-center justify-center text-muted-foreground",
          className
        )}
        style={fill ? undefined : { width, height }}
        role="img"
        aria-label={`Failed to load: ${alt}`}
      >
        <span className="text-sm">Image unavailable</span>
      </div>
    );
  }

  return (
    <>
      {generateImageSchema()}
      <div className={cn("relative overflow-hidden", className)}>
        <Image
          src={src}
          alt={enhancedAlt}
          width={fill ? undefined : width}
          height={fill ? undefined : height}
          fill={fill}
          quality={quality}
          priority={priority}
          loading={priority ? undefined : loading}
          placeholder={placeholder === "blur" ? "blur" : "empty"}
          blurDataURL={blurDataURL || defaultBlurDataURL}
          className={cn(
            "transition-opacity duration-300",
            isLoading ? "opacity-0" : "opacity-100",
            fill && objectFit === "cover" && "object-cover",
            fill && objectFit === "contain" && "object-contain"
          )}
          onLoad={handleLoad}
          onError={handleError}
          aria-label={ariaLabel || enhancedAlt}
          role={role}
          data-geo-location={geoLocation}
          data-keywords={keywords.join(",")}
        />
        {isLoading && (
          <div className="absolute inset-0 bg-muted animate-pulse" />
        )}
        {caption && (
          <figcaption className="mt-2 text-sm text-muted-foreground text-center">
            {caption}
          </figcaption>
        )}
      </div>
    </>
  );
}

/**
 * OptimizedImageGallery - SEO-optimized image gallery component
 * 
 * Features:
 * - Grid layout with responsive columns
 * - ItemList schema markup for gallery
 * - Individual ImageObject schema for each image
 * - Lazy loading with progressive enhancement
 * 
 * @example
 * ```tsx
 * <OptimizedImageGallery
 *   images={[
 *     { src: "/img1.jpg", alt: "Boston Harbor", geoLocation: "Boston, MA" },
 *     { src: "/img2.jpg", alt: "TD Garden", geoLocation: "Boston, MA" }
 *   ]}
 *   columns={3}
 *   includeSchema
 * />
 * ```
 */
export interface OptimizedImageGalleryProps {
  images: OptimizedImageProps[];
  columns?: 2 | 3 | 4;
  gap?: 2 | 4 | 6 | 8;
  includeSchema?: boolean;
  className?: string;
}

export function OptimizedImageGallery({
  images,
  columns = 3,
  gap = 4,
  includeSchema = false,
  className,
}: OptimizedImageGalleryProps) {
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
  const gallerySchema = includeSchema ? {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: images.map((img, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "ImageObject",
        contentUrl: img.contentUrl || img.src,
        name: img.alt,
        ...(img.geoLocation && {
          contentLocation: {
            "@type": "Place",
            name: img.geoLocation,
          },
        }),
      },
    })),
  } : null;

  return (
    <>
      {gallerySchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(gallerySchema) }}
        />
      )}
      <div className={cn("grid", gridCols[columns], gridGap[gap], className)}>
        {images.map((image, index) => (
          <OptimizedImage
            key={`${image.src}-${index}`}
            {...image}
            includeSchema={includeSchema}
            loading={index < 4 ? "eager" : "lazy"}
            priority={index < 2}
          />
        ))}
      </div>
    </>
  );
}
