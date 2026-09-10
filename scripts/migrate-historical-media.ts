import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Storage } from "@google-cloud/storage";
import { Pool } from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import {
  migrateHistoricalMedia,
  type MediaKind,
  type MigrationStore,
  type StorageOwner,
} from "../lib/storage-migration";

const mode = process.argv.includes("--certify")
  ? "certify"
  : process.argv.includes("--copy") ? "copy" : "inventory";
const outputArg = process.argv.find((value) => value.startsWith("--output="));
const outputPath = resolve(outputArg?.slice("--output=".length) ?? "reports/media-storage-migration-evidence.json");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function bodyToBuffer(body: any): Promise<Buffer> {
  if (typeof body?.transformToByteArray === "function") return Buffer.from(await body.transformToByteArray());
  const chunks: Buffer[] = [];
  for await (const chunk of body as Readable) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function s3Store(client: S3Client, bucket: string, prefix: string): MigrationStore {
  const withPrefix = (key: string) => prefix && !key.startsWith(`${prefix}/`) ? `${prefix}/${key}` : key;
  const withoutPrefix = (key: string) => prefix && key.startsWith(`${prefix}/`) ? key.slice(prefix.length + 1) : key;
  return {
    identity: {
      provider: "s3",
      endpoint: required("DO_SPACES_ENDPOINT"),
      bucket,
      prefix,
    },
    async list() {
      const objects = [];
      let continuationToken: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix ? `${prefix}/` : undefined,
          ContinuationToken: continuationToken,
          // fast-xml-parser's default entity expansion ceiling can be crossed
          // by a 1,000-key S3 XML page when object names contain escaped chars.
          MaxKeys: 500,
        }));
        for (const item of page.Contents ?? []) {
          if (item.Key) objects.push({ key: withoutPrefix(item.Key), size: Number(item.Size ?? 0) });
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (continuationToken);
      return objects;
    },
    async read(key, range) {
      const response = await client.send(new GetObjectCommand({
        Bucket: bucket, Key: withPrefix(key),
        Range: range ? `bytes=${range.start}-${range.end}` : undefined,
      }));
      return bodyToBuffer(response.Body);
    },
    async write(key, body, contentType) {
      await client.send(new PutObjectCommand({
        Bucket: bucket, Key: withPrefix(key), Body: body, ContentType: contentType,
        CacheControl: key.startsWith("private/") ? "private, no-store" : "public, max-age=31536000",
      }));
    },
  };
}

function legacyStore(bucketName: string): MigrationStore {
  const storage = new Storage({
    credentials: {
      audience: "replit", subject_token_type: "access_token",
      token_url: "http://127.0.0.1:1106/token", type: "external_account",
      credential_source: {
        url: "http://127.0.0.1:1106/credential",
        format: { type: "json", subject_token_field_name: "access_token" },
      },
      universe_domain: "googleapis.com",
    },
    projectId: "",
  });
  const bucket = storage.bucket(bucketName);
  return {
    identity: {
      provider: "replit-object-storage",
      endpoint: "replit-sidecar",
      bucket: bucketName,
      prefix: "",
    },
    async list() {
      const [files] = await bucket.getFiles({ autoPaginate: true });
      return files.map((file) => ({ key: file.name, size: Number(file.metadata.size ?? 0) }));
    },
    async read(key, range) {
      const [body] = await bucket.file(key).download(
        range ? { start: range.start, end: range.end } : undefined,
      );
      return body;
    },
  };
}

async function loadOwners(pool: Pool): Promise<StorageOwner[]> {
  const result = await pool.query<{
    source: string; record_id: string; team_id: number | null; url: string; kind: MediaKind;
  }>(`
    SELECT 'article_assets.storage_url' source, aa.id::text record_id,
           COALESCE(aa.team_id, a.team_id) team_id, aa.storage_url url,
           CASE aa.asset_type WHEN 'audio' THEN 'audio' WHEN 'video' THEN 'video' ELSE 'image' END kind
      FROM article_assets aa JOIN articles a ON a.id = aa.article_id
     WHERE aa.storage_url LIKE '%/api/public-objects/%'
    UNION ALL
    SELECT 'articles.podcast_url', a.id::text, a.team_id, a.podcast_url, 'audio'
      FROM articles a WHERE a.podcast_url LIKE '%/api/public-objects/%'
    UNION ALL
    SELECT 'articles.hero_image_url', a.id::text, a.team_id, a.hero_image_url, 'image'
      FROM articles a WHERE a.hero_image_url LIKE '%/api/public-objects/%'
    UNION ALL
    SELECT 'social_post_assets.storage_url', spa.id::text, sp.team_id, spa.storage_url,
           CASE spa.asset_type WHEN 'video' THEN 'video' ELSE 'image' END
      FROM social_post_assets spa JOIN social_posts sp ON sp.id = spa.social_post_id
     WHERE spa.storage_url LIKE '%/api/public-objects/%'
    UNION ALL
    SELECT 'social_post_variants.image_url', spv.id::text, sp.team_id, spv.image_url, 'image'
      FROM social_post_variants spv JOIN social_posts sp ON sp.id = spv.social_post_id
     WHERE spv.image_url LIKE '%/api/public-objects/%'
    UNION ALL
    SELECT 'social_posts.video_url', sp.id::text, sp.team_id, sp.video_url, 'video'
      FROM social_posts sp WHERE sp.video_url LIKE '%/api/public-objects/%'
    UNION ALL
    SELECT 'social_posts.company_logo_url', sp.id::text, sp.team_id, sp.company_logo_url, 'image'
      FROM social_posts sp WHERE sp.company_logo_url LIKE '%/api/public-objects/%'
    UNION ALL
    SELECT 'video_ideas.video_url', vi.id::text, vi.team_id, vi.video_url, 'video'
      FROM video_ideas vi WHERE vi.video_url LIKE '%/api/public-objects/%'
    UNION ALL
    SELECT 'video_ideas.thumbnail_url', vi.id::text, vi.team_id, vi.thumbnail_url, 'image'
      FROM video_ideas vi WHERE vi.thumbnail_url LIKE '%/api/public-objects/%'
    UNION ALL
    SELECT 'video_ideas.company_logo_url', vi.id::text, vi.team_id, vi.company_logo_url, 'image'
      FROM video_ideas vi WHERE vi.company_logo_url LIKE '%/api/public-objects/%'
  `);
  return result.rows.map((row) => ({
    source: row.source, recordId: row.record_id, teamId: row.team_id,
    url: row.url, kind: row.kind,
  }));
}

async function main() {
  const pool = new Pool({ connectionString: required("DATABASE_URL"), max: 2 });
  try {
    const owners = await loadOwners(pool);
    const client = new S3Client({
      region: "us-east-1", endpoint: required("DO_SPACES_ENDPOINT"),
      credentials: {
        accessKeyId: required("DO_SPACES_KEY"),
        secretAccessKey: required("DO_SPACES_SECRET"),
      },
      forcePathStyle: false,
    });
    const report = await migrateHistoricalMedia({
      owners,
      legacy: legacyStore(required("DEFAULT_OBJECT_STORAGE_BUCKET_ID")),
      primary: s3Store(
        client,
        required("DO_SPACES_BUCKET"),
        (process.env.STORAGE_PREFIX ?? "").replace(/^\/+|\/+$/g, ""),
      ),
      mode,
      concurrency: Number(process.env.STORAGE_MIGRATION_CONCURRENCY ?? 4),
    });
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({
      outputPath,
      mode,
      certificationStatus: report.certificationStatus,
      legacyObjects: report.inventory.legacyObjectCount,
      databaseOwners: report.inventory.databaseOwnerCount,
      missingOwners: report.inventory.missingObjects.length,
      orphanedLegacyObjects: report.inventory.orphanedLegacyObjects.length,
      failedObjects: report.objects.filter((object) => object.status === "FAILED").length,
      readChecks: report.readChecks,
    }, null, 2));
    if (mode === "certify" && report.certificationStatus !== "PASS") process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});