import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { PassThrough, Readable } from "stream";
import { Storage } from "@google-cloud/storage";
import { db } from "./db";
import { articleAssets, articles } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { shouldDisableLegacyStorageReads } from "./storage-migration";

// ── DO Spaces / S3-compatible storage ────────────────────────────────────────
const DO_SPACES_KEY      = process.env.DO_SPACES_KEY      || "";
const DO_SPACES_SECRET   = process.env.DO_SPACES_SECRET   || "";
const DO_SPACES_ENDPOINT = process.env.DO_SPACES_ENDPOINT || "";
const DO_SPACES_BUCKET   = process.env.DO_SPACES_BUCKET   || "";
const LEGACY_REPLIT_BUCKET = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";
const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const STORAGE_PREFIX = (process.env.STORAGE_PREFIX || "")
  .trim()
  .replace(/^\/+|\/+$/g, "");

function storageKey(key: string): string {
  const clean = key.replace(/^\/+/, "");
  if (!STORAGE_PREFIX || clean.startsWith(`${STORAGE_PREFIX}/`)) return clean;
  return `${STORAGE_PREFIX}/${clean}`;
}

const s3Client = new S3Client({
  region: "us-east-1",            // placeholder — DO Spaces ignores this
  endpoint: DO_SPACES_ENDPOINT,
  credentials: {
    accessKeyId: DO_SPACES_KEY,
    secretAccessKey: DO_SPACES_SECRET,
  },
  forcePathStyle: false,          // DO Spaces uses subdomain-style URLs
});

/** True when all required DO Spaces credentials are present. */
export const isStorageConfigured: boolean =
  !!(DO_SPACES_KEY && DO_SPACES_SECRET && DO_SPACES_ENDPOINT && DO_SPACES_BUCKET);
export const isLegacyStorageConfigured: boolean = !!LEGACY_REPLIT_BUCKET;
/** Policy switch used by routes to make disabled media impossible to enqueue. */
export const isMediaEnabled: boolean = process.env.MEDIA_FEATURES_ENABLED !== "false";

/**
 * Read the media policy at the point work is about to be accepted or executed.
 * Workers are long-lived, so unlike the exported compatibility constant this
 * must not capture the environment before a worker process is configured.
 */
export function isMediaFeatureEnabled(): boolean {
  return process.env.MEDIA_FEATURES_ENABLED !== "false";
}

function legacyReadsEnabled(): boolean {
  if (process.env.LEGACY_STORAGE_READS_ENABLED !== "false") return true;
  if (!isStorageConfigured) {
    console.error("Legacy storage reads remain enabled: primary storage is not fully configured");
    return true;
  }
  const evidencePaths = [...new Set([
    process.env.STORAGE_MIGRATION_EVIDENCE_PATH,
    "reports/media-storage-migration-evidence.json",
  ].filter((value): value is string => !!value))];
  for (const evidencePath of evidencePaths) {
    try {
      const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
      if (shouldDisableLegacyStorageReads({
        requested: true,
        isPrimaryConfigured: isStorageConfigured,
        evidence,
        expectedPrimary: {
          provider: "s3",
          endpoint: DO_SPACES_ENDPOINT,
          bucket: DO_SPACES_BUCKET,
          prefix: STORAGE_PREFIX,
        },
      })) return false;
    } catch {
      // Try the signed evidence bundled with the release before failing closed.
    }
  }
  console.error("Legacy storage reads remain enabled: no destination-matched PASS evidence was found");
  return true;
}

export const isLegacyStorageReadEnabled = legacyReadsEnabled();

class S3FileShim {
  constructor(
    private client: S3Client,
    private bucketName: string,
    private key: string
  ) {}

  async save(
    data: Buffer,
    opts?: { contentType?: string; metadata?: Record<string, string> }
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: this.key,
        Body: data,
        ContentType: opts?.contentType || "application/octet-stream",
        CacheControl:
          opts?.metadata?.cacheControl ||
          (this.key.startsWith("private/")
            ? "private, no-store"
            : "public, max-age=31536000"),
      })
    );
  }

  async delete(): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucketName, Key: this.key })
    );
  }

  async getMetadata(): Promise<
    [{ contentType: string; size: number; md5Hash?: string; generation?: string }]
  > {
    const res = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucketName, Key: this.key })
    );
    return [
      {
        contentType: res.ContentType || "application/octet-stream",
        size: res.ContentLength || 0,
        md5Hash: res.ETag?.replace(/"/g, ""),
      },
    ];
  }

  createReadStream(opts?: { start?: number; end?: number }): NodeJS.ReadableStream {
    const pass = new PassThrough();
    const rangeHeader =
      opts?.start !== undefined
        ? `bytes=${opts.start}-${opts.end !== undefined ? opts.end : ""}`
        : undefined;

    this.client
      .send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: this.key,
          Range: rangeHeader,
        })
      )
      .then((res) => {
        const body = res.Body as any;
        if (body instanceof Readable) {
          body.pipe(pass);
        } else if (body?.pipe) {
          (body as NodeJS.ReadableStream).pipe(pass);
        } else if (body && Readable.fromWeb) {
          Readable.fromWeb(body).pipe(pass);
        } else {
          pass.destroy(new Error("Empty or unreadable S3 response body"));
        }
      })
      .catch((err) => pass.destroy(err));

    return pass;
  }

  async exists(): Promise<[boolean]> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucketName, Key: this.key })
      );
      return [true];
    } catch {
      return [false];
    }
  }
}

class S3BucketShim {
  // The bucket-name argument is accepted for API compatibility but ignored —
  // all objects live in DO_SPACES_BUCKET (callers previously passed the
  // Replit-specific DEFAULT_OBJECT_STORAGE_BUCKET_ID env var).
  constructor(private client: S3Client) {}

  file(key: string): S3FileShim {
    return new S3FileShim(this.client, DO_SPACES_BUCKET, storageKey(key));
  }
}

/** Drop-in GCS-compatible shim backed by DO Spaces (S3). */
export const objectStorageClient = {
  bucket(_name: string): S3BucketShim {
    return new S3BucketShim(s3Client);
  },
};

const legacyObjectStorageClient = new Storage({
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

/**
 * Preserve read access to objects created before the DO Spaces migration.
 * New storage is tried first; the Replit bucket is a read-only compatibility
 * source until historical object migration has been certified.
 */
export function getStorageReadCandidates(key: string): any[] {
  const candidates: any[] = [];
  if (isStorageConfigured) {
    candidates.push(objectStorageClient.bucket(DO_SPACES_BUCKET).file(key));
  }
  if (isLegacyStorageConfigured && isLegacyStorageReadEnabled) {
    candidates.push(legacyObjectStorageClient.bucket(LEGACY_REPLIT_BUCKET).file(key));
  }
  return candidates;
}

// ── Public URL helper ─────────────────────────────────────────────────────────
// Files are served through the Next.js proxy route so URLs never embed a
// provider-specific hostname and remain stable across storage migrations.
const getObjectUrl = (key: string): string => `/api/public-objects/${key}`;

// ── High-level upload helpers (API unchanged) ─────────────────────────────────

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
  const [owner] = await db.select({ teamId: articles.teamId }).from(articles).where(eq(articles.id, articleId)).limit(1);
  if (!owner?.teamId) throw new Error("Cannot store article image without a validated owning team");

  const filename   = `${slug}-${index + 1}.webp`;
  const key        = `private/articles/${articleId}/batch-${batchId}/${filename}`;
  const objectName = key;

  await objectStorageClient
    .bucket(DO_SPACES_BUCKET)
    .file(objectName)
    .save(imageData, { contentType: "image/webp" });

  const publicUrl = getObjectUrl(key);
  const altText   = generateAltText(prompt);

  await db.insert(articleAssets).values({
    articleId,
    teamId: owner.teamId,
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
    const img = images[i]!;
    const url = await uploadImage({
      imageData: img.imageData,
      articleId,
      batchId,
      slug,
      index: i,
      prompt: img.prompt,
    });
    urls.push(url);
  }
  return urls;
}

function generateAltText(prompt: string): string {
  const cleanPrompt = prompt
    .replace(/^(photorealistic|professional|detailed|high-quality)\s+/gi, "")
    .trim();
  const altText =
    cleanPrompt.length > 150
      ? cleanPrompt.substring(0, 147) + "..."
      : cleanPrompt;
  return altText.charAt(0).toUpperCase() + altText.slice(1);
}

export async function deleteFromStorage(key: string): Promise<void> {
  const normalized = key
    .replace(/^https?:\/\/[^/]+\/api\/public-objects\//, "")
    .replace(/^\/api\/public-objects\//, "")
    .replace(/^\/+/, "");
  const objectName = normalized.startsWith("private/")
    ? normalized
    : normalized.startsWith("public/")
      ? normalized
      : `public/${normalized}`;
  try {
    await objectStorageClient.bucket(DO_SPACES_BUCKET).file(objectName).delete();
    console.log(`🗑️  Deleted from storage: ${key}`);
  } catch (error) {
    console.warn(`⚠️  Failed to delete ${key}:`, error);
  }
}

export interface UploadMediaParams {
  fileData: Buffer;
  fileName: string;
  contentType: string;
  assetType: "image" | "audio" | "video";
  articleId?: number;
  altText?: string;
  metadata?: Record<string, any>;
}

export async function uploadMedia(params: UploadMediaParams): Promise<string> {
  const { fileData, fileName, contentType, assetType, articleId, altText, metadata } =
    params;

  const owner = articleId
    ? (await db.select({ teamId: articles.teamId }).from(articles).where(eq(articles.id, articleId)).limit(1))[0]
    : null;
  if (articleId && !owner?.teamId) throw new Error("Cannot store article media without a validated owning team");

  const timestamp  = Date.now();
  const safeName   = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
  const key        = articleId
    ? `private/articles/${articleId}/${assetType}/${timestamp}-${safeName}`
    : `private/uploads/${assetType}/${timestamp}-${safeName}`;
  const objectName = key;

  await objectStorageClient
    .bucket(DO_SPACES_BUCKET)
    .file(objectName)
    .save(fileData, { contentType });

  const publicUrl = getObjectUrl(key);

  if (articleId) {
    const format      = fileName.split(".").pop() || "unknown";
    const imagePrompt = metadata?.originalPrompt || null;

    await db.insert(articleAssets).values({
      articleId,
      teamId: owner!.teamId,
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
