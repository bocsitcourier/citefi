import { db } from "./db";
import { articleAssets } from "@/shared/schema";
import { Storage } from "@google-cloud/storage";

// Replit Object Storage Configuration via Google Cloud Storage API
const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";
const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

// IMPORTANT: Images are served through our Next.js API route, not direct public URLs.
// We store RELATIVE paths so URLs never break when the Replit dev domain changes.
// The frontend prepends window.location.origin when it needs a full URL.
const getPublicUrl = (objectPath: string): string => {
  return `/api/public-objects/${objectPath}`;
};

// Initialize GCS client with Replit sidecar credentials
export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

if (!BUCKET_ID) {
  console.warn("⚠️  Replit Object Storage not configured - image uploads will fail");
} else {
  console.log(`✅ Using Replit Object Storage: ${BUCKET_ID}`);
}

export interface UploadImageParams {
  imageData: Buffer;
  articleId: number;
  batchId: number;
  slug: string;
  index: number;
  prompt: string;
}

export async function uploadImage(params: UploadImageParams): Promise<string> {
  const { imageData, articleId, batchId, slug, index, prompt } = params;

  const filename = `${slug}-${index + 1}.webp`;
  const key = `batch-${batchId}/${filename}`;
  const objectName = `public/${key}`;

  // Upload to Replit Object Storage via GCS API
  const bucket = objectStorageClient.bucket(BUCKET_ID);
  const file = bucket.file(objectName);
  
  await file.save(imageData, {
    contentType: "image/webp",
    metadata: {
      cacheControl: "public, max-age=31536000",
    },
  });

  // Public URL served through Next.js API route
  const publicUrl = getPublicUrl(key);

  const altText = generateAltText(prompt);

  await db.insert(articleAssets).values({
    articleId,
    imagePromptUsed: prompt,
    storageUrl: publicUrl,
    altText,
    fileFormat: "webp",
    assetType: "image",
  });

  console.log(`✅ Uploaded image: ${publicUrl}`);
  return publicUrl;
}

export async function uploadImages(
  images: Array<{ imageData: Buffer; prompt: string }>,
  articleId: number,
  batchId: number,
  slug: string
): Promise<string[]> {
  const urls: string[] = [];

  for (let i = 0; i < images.length; i++) {
    const url = await uploadImage({
      imageData: images[i].imageData,
      articleId,
      batchId,
      slug,
      index: i,
      prompt: images[i].prompt,
    });
    urls.push(url);
  }

  return urls;
}

function generateAltText(prompt: string): string {
  const cleanPrompt = prompt.replace(/^(photorealistic|professional|detailed|high-quality)\s+/gi, "").trim();
  
  const altText = cleanPrompt.length > 150 
    ? cleanPrompt.substring(0, 147) + "..."
    : cleanPrompt;
  
  return altText.charAt(0).toUpperCase() + altText.slice(1);
}

export async function deleteFromStorage(key: string): Promise<void> {
  const objectName = `public/${key}`;
  
  try {
    const bucket = objectStorageClient.bucket(BUCKET_ID);
    const file = bucket.file(objectName);
    await file.delete();
    console.log(`🗑️  Deleted from storage: ${key}`);
  } catch (error) {
    console.warn(`⚠️  Failed to delete ${key}:`, error);
  }
}

export interface UploadMediaParams {
  fileData: Buffer;
  fileName: string;
  contentType: string;
  assetType: 'image' | 'audio' | 'video';
  articleId?: number;
  altText?: string;
  metadata?: Record<string, any>;
}

export async function uploadMedia(params: UploadMediaParams): Promise<string> {
  const { fileData, fileName, contentType, assetType, articleId, altText, metadata } = params;

  const timestamp = Date.now();
  const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const key = articleId 
    ? `article-${articleId}/${assetType}/${timestamp}-${safeName}`
    : `uploads/${assetType}/${timestamp}-${safeName}`;

  const objectName = `public/${key}`;

  // Upload to Replit Object Storage via GCS API
  const bucket = objectStorageClient.bucket(BUCKET_ID);
  const file = bucket.file(objectName);
  
  await file.save(fileData, {
    contentType,
    metadata: {
      cacheControl: "public, max-age=31536000",
    },
  });

  // Public URL served through Next.js API route  
  const publicUrl = getPublicUrl(key);

  if (articleId) {
    const format = fileName.split('.').pop() || 'unknown';
    
    // Extract prompt from metadata if available (for image regeneration)
    const imagePrompt = metadata?.originalPrompt || null;
    
    await db.insert(articleAssets).values({
      articleId,
      assetType,
      storageUrl: publicUrl,
      altText: altText || null,
      fileFormat: format,
      metadataJson: metadata || null,
      imagePromptUsed: imagePrompt,
    });
  }

  console.log(`✅ Uploaded ${assetType}: ${publicUrl}`);
  return publicUrl;
}
