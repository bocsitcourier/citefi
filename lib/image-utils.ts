/**
 * Image Optimization Utilities
 * 
 * Provides utility functions for SEO/GEO-optimized image handling:
 * - Alt text generation with location keywords
 * - Responsive srcset generation
 * - Image metadata extraction
 * - Schema.org markup helpers
 */

export interface ImageMetadata {
  alt: string;
  title?: string;
  caption?: string;
  geoLocation?: string;
  keywords?: string[];
  author?: string;
}

/**
 * Generate SEO-optimized alt text with location keywords
 * 
 * @param baseAlt - Base alt text
 * @param location - Geographic location (city, state)
 * @param keywords - Additional SEO keywords
 * @returns Enhanced alt text with location and keywords
 * 
 * @example
 * ```ts
 * generateSEOAltText(
 *   "Professional courier delivering documents",
 *   "Boston, Massachusetts",
 *   ["same-day delivery", "legal documents"]
 * )
 * // Returns: "Professional courier delivering documents in Boston, Massachusetts - same-day delivery, legal documents"
 * ```
 */
export function generateSEOAltText(
  baseAlt: string,
  location?: string,
  keywords: string[] = []
): string {
  let altText = baseAlt.trim();
  
  // Add location if not already present
  if (location && !altText.toLowerCase().includes(location.toLowerCase())) {
    altText = `${altText} in ${location}`;
  }
  
  // Add keywords if provided
  if (keywords.length > 0) {
    const keywordString = keywords.join(", ");
    altText = `${altText} - ${keywordString}`;
  }
  
  // Ensure first character is capitalized
  altText = altText.charAt(0).toUpperCase() + altText.slice(1);
  
  // Limit to 125 characters for optimal SEO (Google's recommended max)
  if (altText.length > 125) {
    altText = altText.substring(0, 122) + "...";
  }
  
  return altText;
}

/**
 * Generate responsive image srcset for different screen sizes
 * 
 * @param baseSrc - Base image source path
 * @param widths - Array of image widths to generate
 * @returns srcset string for responsive images
 * 
 * @example
 * ```ts
 * generateResponsiveSrcSet("/images/hero.jpg", [400, 800, 1200])
 * // Returns: "/images/hero.jpg?w=400 400w, /images/hero.jpg?w=800 800w, /images/hero.jpg?w=1200 1200w"
 * ```
 */
export function generateResponsiveSrcSet(
  baseSrc: string,
  widths: number[] = [400, 800, 1200, 1600]
): string {
  return widths
    .map((width) => {
      const separator = baseSrc.includes("?") ? "&" : "?";
      return `${baseSrc}${separator}w=${width} ${width}w`;
    })
    .join(", ");
}

/**
 * Generate sizes attribute for responsive images
 * 
 * @param breakpoints - Object mapping breakpoints to image sizes
 * @returns sizes string for responsive images
 * 
 * @example
 * ```ts
 * generateImageSizes({
 *   "(max-width: 640px)": "100vw",
 *   "(max-width: 1024px)": "50vw",
 *   default: "33vw"
 * })
 * // Returns: "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
 * ```
 */
export function generateImageSizes(breakpoints: {
  [key: string]: string;
  default: string;
}): string {
  const { default: defaultSize, ...mediaQueries } = breakpoints;
  
  const sizesArray = Object.entries(mediaQueries).map(
    ([query, size]) => `${query} ${size}`
  );
  
  sizesArray.push(defaultSize);
  
  return sizesArray.join(", ");
}

/**
 * Extract location from alt text or caption
 * 
 * @param text - Alt text or caption
 * @returns Extracted location or null
 * 
 * @example
 * ```ts
 * extractLocationFromText("Courthouse in Boston, Massachusetts")
 * // Returns: "Boston, Massachusetts"
 * ```
 */
export function extractLocationFromText(text: string): string | null {
  // Common patterns: "in [Location]", "at [Location]", "[Location] -"
  const patterns = [
    /\bin\s+([A-Z][a-zA-Z\s,]+?)(?:\s*[-–—]|$)/,
    /\bat\s+([A-Z][a-zA-Z\s,]+?)(?:\s*[-–—]|$)/,
    /^([A-Z][a-zA-Z\s,]+?)\s*[-–—]/,
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
 * Generate ImageObject schema.org markup
 * 
 * @param metadata - Image metadata
 * @param src - Image source URL
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @returns JSON-LD schema object
 * 
 * @example
 * ```ts
 * generateImageSchema(
 *   {
 *     alt: "Boston Harbor skyline",
 *     geoLocation: "Boston, MA",
 *     keywords: ["harbor", "skyline", "cityscape"]
 *   },
 *   "/images/boston-harbor.jpg",
 *   1200,
 *   800
 * )
 * ```
 */
export function generateImageSchema(
  metadata: ImageMetadata,
  src: string,
  width?: number,
  height?: number
) {
  return {
    "@context": "https://schema.org",
    "@type": "ImageObject",
    contentUrl: src,
    url: src,
    name: metadata.title || metadata.alt,
    description: metadata.caption || metadata.alt,
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
  };
}

/**
 * Validate image URL format
 * 
 * @param url - URL to validate
 * @returns True if valid image URL
 */
export function isValidImageUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const validExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"];
    return validExtensions.some((ext) =>
      parsedUrl.pathname.toLowerCase().endsWith(ext)
    );
  } catch {
    return false;
  }
}

/**
 * Generate blur placeholder data URL (LQIP)
 * 
 * @param width - Placeholder width
 * @param height - Placeholder height
 * @param color - Placeholder color (hex)
 * @returns Data URL for blur placeholder
 */
export function generateBlurPlaceholder(
  width: number = 400,
  height: number = 300,
  color: string = "#e5e7eb"
): string {
  const svg = `
    <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} ${height}'>
      <filter id='b' color-interpolation-filters='sRGB'>
        <feGaussianBlur stdDeviation='20'/>
      </filter>
      <rect width='100%' height='100%' fill='${color}' filter='url(#b)'/>
    </svg>
  `;
  
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Calculate optimal image dimensions for responsive display
 * 
 * @param originalWidth - Original image width
 * @param originalHeight - Original image height
 * @param maxWidth - Maximum display width
 * @param maxHeight - Maximum display height
 * @returns Optimized dimensions
 */
export function calculateOptimalDimensions(
  originalWidth: number,
  originalHeight: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  const aspectRatio = originalWidth / originalHeight;
  
  let width = originalWidth;
  let height = originalHeight;
  
  // Scale down if wider than max width
  if (width > maxWidth) {
    width = maxWidth;
    height = width / aspectRatio;
  }
  
  // Scale down if taller than max height
  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspectRatio;
  }
  
  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}
