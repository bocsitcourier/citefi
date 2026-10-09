import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { Storage } from "@google-cloud/storage";
import type { Pool } from "pg";
import type {
  MediaKind,
  StorageIdentity,
  StorageOwner,
  StoredObject,
} from "./storage-migration";

export type StorageInventory = {
  identity: StorageIdentity;
  list(): Promise<StoredObject[]>;
};

const PAGE_SIZE = 500;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_TIMEOUT_MS = 15_000;
const LIST_DEADLINE_MS = 110_000;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for storage inventory`);
  return value;
}

function requestTimeoutMs(): number {
  const raw = process.env.STORAGE_INVENTORY_REQUEST_TIMEOUT_MS;
  if (raw === undefined || raw === "") return DEFAULT_REQUEST_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("STORAGE_INVENTORY_REQUEST_TIMEOUT_MS must be a positive number");
  }
  return Math.min(value, MAX_REQUEST_TIMEOUT_MS);
}

function storagePrefix(): string {
  return (process.env.STORAGE_PREFIX ?? "").trim().replace(/^\/+|\/+$/g, "");
}

function rawKeyUrl(key: string): string {
  const encoded = key
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/api/public-objects/${encoded}`;
}

function canonicalOwnerUrl(source: string, value: string): string {
  if (source === "error_logs.screenshot_url" && value.startsWith("[private]")) {
    return rawKeyUrl(`.private/${value.slice("[private]".length).replace(/^\/+/, "")}`);
  }
  if (
    (source === "article_assets.storage_url" ||
      source === "social_post_assets.storage_url") &&
    !/^https?:\/\//i.test(value) &&
    !value.startsWith("/api/public-objects/")
  ) {
    return rawKeyUrl(value);
  }
  return value;
}

type OwnerRow = {
  source: string;
  record_id: string;
  team_id: number | null;
  url: string;
  kind: MediaKind;
};

/**
 * Read-only inventory of durable database records which own object-storage
 * media. Canonical asset rows also accept literal object keys; those are
 * encoded as proxy URLs so `?` and `#` remain part of the key.
 */
export async function loadStorageOwners(
  pool: Pick<Pool, "query">,
): Promise<StorageOwner[]> {
  const result = await pool.query<OwnerRow>(`
    SELECT 'article_assets.storage_url' source, aa.id::text record_id,
           COALESCE(aa.team_id, a.team_id) team_id, aa.storage_url url,
           CASE aa.asset_type WHEN 'audio' THEN 'audio' WHEN 'video' THEN 'video' ELSE 'image' END kind
      FROM article_assets aa LEFT JOIN articles a ON a.id = aa.article_id
     WHERE aa.storage_url LIKE '%/api/public-objects/%'
        OR (btrim(aa.storage_url) <> '' AND aa.storage_url !~* '^[a-z][a-z0-9+.-]*://')
    UNION ALL
    SELECT 'articles.podcast_url', a.id::text, a.team_id, a.podcast_url, 'audio'
      FROM articles a WHERE a.podcast_url LIKE '%/api/public-objects/%'
    UNION ALL
    SELECT 'articles.hero_image_url', a.id::text, a.team_id, a.hero_image_url, 'image'
      FROM articles a WHERE a.hero_image_url LIKE '%/api/public-objects/%'
    UNION ALL
    SELECT 'social_post_assets.storage_url', spa.id::text, sp.team_id, spa.storage_url,
           CASE spa.asset_type WHEN 'video' THEN 'video' ELSE 'image' END
      FROM social_post_assets spa LEFT JOIN social_posts sp ON sp.id = spa.social_post_id
     WHERE spa.storage_url LIKE '%/api/public-objects/%'
        OR (btrim(spa.storage_url) <> '' AND spa.storage_url !~* '^[a-z][a-z0-9+.-]*://')
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
    UNION ALL
    SELECT 'video_ideas.reference_video_url', vi.id::text, vi.team_id, vi.reference_video_url, 'video'
      FROM video_ideas vi WHERE vi.reference_video_url LIKE '%/api/public-objects/%'
    UNION ALL
    SELECT 'job_batches.company_logo_url', jb.id::text, jb.team_id, jb.company_logo_url, 'image'
      FROM job_batches jb WHERE jb.company_logo_url LIKE '%/api/public-objects/%'
    UNION ALL
    SELECT 'content_schedules.company_logo_url', cs.id::text, cs.team_id, cs.company_logo_url, 'image'
      FROM content_schedules cs WHERE cs.company_logo_url LIKE '%/api/public-objects/%'
    UNION ALL
    SELECT 'audience_personas.avatar_url', ap.id::text, ap.team_id, ap.avatar_url, 'image'
      FROM audience_personas ap WHERE ap.avatar_url LIKE '%/api/public-objects/%'
    UNION ALL
    SELECT 'users.profile_picture_url', u.id::text, u.default_team_id, u.profile_picture_url, 'image'
      FROM users u WHERE u.profile_picture_url LIKE '%/api/public-objects/%'
    UNION ALL
    SELECT 'agency_report_configs.logo_url', arc.id::text, arc.agency_team_id, arc.logo_url, 'image'
      FROM agency_report_configs arc WHERE arc.logo_url LIKE '%/api/public-objects/%'
    UNION ALL
    SELECT 'campaign_exports.object_url', ce.id::text, ce.team_id, ce.object_url, 'unknown'
      FROM campaign_exports ce WHERE ce.object_url LIKE '%/api/public-objects/%'
    UNION ALL
    SELECT 'error_logs.screenshot_url', el.id::text, COALESCE(a.team_id, jb.team_id),
           el.screenshot_url, 'image'
      FROM error_logs el
      LEFT JOIN articles a ON a.id = el.article_id
      LEFT JOIN job_batches jb ON jb.id = el.batch_id
     WHERE el.screenshot_url LIKE '%/api/public-objects/%'
        OR el.screenshot_url LIKE '[private]%'
  `);
  return result.rows.map((row) => ({
    source: row.source,
    recordId: row.record_id,
    teamId: row.team_id,
    url: canonicalOwnerUrl(row.source, row.url),
    kind: row.kind,
  }));
}

export function createPrimaryInventory(): StorageInventory {
  const endpoint = required("DO_SPACES_ENDPOINT");
  const bucket = required("DO_SPACES_BUCKET");
  const accessKeyId = required("DO_SPACES_KEY");
  const secretAccessKey = required("DO_SPACES_SECRET");
  const prefix = storagePrefix();
  const timeoutMs = requestTimeoutMs();
  const client = new S3Client({
    region: "us-east-1",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: false,
  });

  return {
    identity: { provider: "s3", endpoint, bucket, prefix },
    async list() {
      const objects: StoredObject[] = [];
      const seenTokens = new Set<string>();
      let continuationToken: string | undefined;
      const deadline = Date.now() + LIST_DEADLINE_MS;
      try {
        do {
          const remainingMs = deadline - Date.now();
          if (remainingMs <= 0) {
            throw new Error(`S3 inventory listing exceeded ${LIST_DEADLINE_MS}ms`);
          }
          const controller = new AbortController();
          const pageTimeoutMs = Math.min(timeoutMs, remainingMs);
          const timer = setTimeout(() => controller.abort(), pageTimeoutMs);
          let page;
          try {
            page = await client.send(new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: prefix ? `${prefix}/` : undefined,
              ContinuationToken: continuationToken,
              MaxKeys: PAGE_SIZE,
            }), { abortSignal: controller.signal });
          } catch (error) {
            if (controller.signal.aborted) {
              const message = Date.now() >= deadline
                ? `S3 inventory listing exceeded ${LIST_DEADLINE_MS}ms`
                : `S3 inventory request timed out after ${pageTimeoutMs}ms`;
              throw new Error(message);
            }
            throw error;
          } finally {
            clearTimeout(timer);
          }
          for (const item of page.Contents ?? []) {
            if (!item.Key) continue;
            if (prefix && !item.Key.startsWith(`${prefix}/`)) {
              throw new Error(`S3 inventory returned an object outside prefix ${prefix}`);
            }
            const key = prefix ? item.Key.slice(prefix.length + 1) : item.Key;
            objects.push({ key, size: Number(item.Size ?? 0) });
          }
          if (!page.IsTruncated) {
            continuationToken = undefined;
            continue;
          }
          const next = page.NextContinuationToken;
          if (!next) throw new Error("S3 inventory pagination was truncated without a continuation token");
          if (seenTokens.has(next)) throw new Error("S3 inventory pagination repeated a continuation token");
          seenTokens.add(next);
          continuationToken = next;
        } while (continuationToken);
        return objects;
      } finally {
        client.destroy();
      }
    },
  };
}

export function createLegacyInventory(): StorageInventory {
  const bucketName = required("DEFAULT_OBJECT_STORAGE_BUCKET_ID");
  const timeoutMs = requestTimeoutMs();
  const storage = new Storage({
    credentials: {
      audience: "replit",
      subject_token_type: "access_token",
      token_url: "http://127.0.0.1:1106/token",
      type: "external_account",
      credential_source: {
        url: "http://127.0.0.1:1106/credential",
        format: { type: "json", subject_token_field_name: "access_token" },
      },
      universe_domain: "googleapis.com",
    },
    projectId: "",
    timeout: timeoutMs,
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
      const objects: StoredObject[] = [];
      const seenTokens = new Set<string>();
      let pageToken: string | undefined;
      const deadline = Date.now() + LIST_DEADLINE_MS;
      do {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          throw new Error(`Legacy inventory listing exceeded ${LIST_DEADLINE_MS}ms`);
        }
        let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
        const deadlineExceeded = new Promise<never>((_, reject) => {
          deadlineTimer = setTimeout(
            () => reject(new Error(`Legacy inventory listing exceeded ${LIST_DEADLINE_MS}ms`)),
            remainingMs,
          );
        });
        const request = bucket.getFiles({
          autoPaginate: false,
          maxResults: PAGE_SIZE,
          pageToken,
          fields: "items(name,size),nextPageToken",
        });
        let files;
        let nextQuery;
        try {
          [files, nextQuery] = await Promise.race([request, deadlineExceeded]);
        } finally {
          if (deadlineTimer) clearTimeout(deadlineTimer);
        }
        for (const file of files) {
          objects.push({ key: file.name, size: Number(file.metadata.size ?? 0) });
        }
        const next = nextQuery?.pageToken;
        if (!next) {
          pageToken = undefined;
          continue;
        }
        if (seenTokens.has(next)) {
          throw new Error("Legacy inventory pagination repeated a page token");
        }
        seenTokens.add(next);
        pageToken = next;
      } while (pageToken);
      return objects;
    },
  };
}