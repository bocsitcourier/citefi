import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { PassThrough, Readable } from "stream";
import { db } from "./db";
import { articleAssets } from "@/shared/schema";

// ── DO Spaces / S3-compatible storage ────────────────────────────────────────
const DO_SPACES_KEY      = process.env.DO_SPACES_KEY      || "";
const DO_SPACES_SECRET   = process.env.DO_SPACES_SECRET   || "";
const DO_SPACES_ENDPOINT = process.env.DO_SPACES_ENDPOINT || "";
const DO_SPACES_BUCKET   = process.env.DO_SPACES_BUCKET   || "";

const s3Client = new S3Client({
  region: "us-east-1",            // placeholder — DO Spaces ignores this
  endpoint: DO_SPACES_ENDPOINT,
  credentials: {
    accessKeyId: DO_SPACES_KEY,
    secretAccessKey: DO_SPACES_SECRET,
  },
  forcePathStyle: false,          // DO Spaces uses subdomain-style URLs
});

if (!DO_SPACES_BUCKET) {
  console.warn("⚠️  DO_SPACES_BUCKET not configured — media uploads will fail");
} else {
  console.log(`✅ Using DO Spaces storage: ${DO_SPACES_BUCKET}`);
}

// ── GCS-compatible shim so all callers need zero changes ──────────────────────
// The rest of the codebase calls objectStorageClient.bucket(id).file(key).save/delete/getMetadata/createReadStream
// Those all work exactly as before — the shim translates to S3 under the hood.

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
        CacheControl: opts?.metadata?.cacheControl || "public, max-age=31536000",
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
    return new S3FileShim(this.client, DO_SPACES_BUCKET, key);
  }
}

/** Drop-in GCS-compatible shim backed by DO Spaces (S3). */
export const objectStorageClient = {
  bucket(_name: string): S3BucketShim {
    return new S3BucketShim(s3Client);
  },
};

// ── Public URL helper ─────────────────────────────────────────────────────────
// Files are served through the Next.js proxy route so URLs never embed a
// provider-specific hostname and remain stable across storage migrations.
const getPublicUrl = (key: string): string => `/api/public-objects/${key}`;

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

  const filename   = `${slug}-${index + 1}.webp`;
  const key        = `batch-${batchId}/${filename}`;
  const objectName = `public/${key}`;

  await objectStorageClient
    .bucket(DO_SPACES_BUCKET)
    .file(objectName)
    .save(imageData, { contentType: "image/webp" });

  const publicUrl = getPublicUrl(key);
  const altText   = generateAltText(prompt);

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
  const objectName = `public/${key}`;
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

  const timestamp  = Date.now();
  const safeName   = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
  const key        = articleId
    ? `article-${articleId}/${assetType}/${timestamp}-${safeName}`
    : `uploads/${assetType}/${timestamp}-${safeName}`;
  const objectName = `public/${key}`;

  await objectStorageClient
    .bucket(DO_SPACES_BUCKET)
    .file(objectName)
    .save(fileData, { contentType });

  const publicUrl = getPublicUrl(key);

  if (articleId) {
    const format      = fileName.split(".").pop() || "unknown";
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
