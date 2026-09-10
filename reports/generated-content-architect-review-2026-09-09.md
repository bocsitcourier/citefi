# Generated Content Architecture Review

**Date:** September 9, 2026  
**Scope:** Articles, images, videos, podcasts, social assets, discovery APIs, tenant isolation, and global-admin visibility.

## Executive finding

Generated content existed but was fragmented across several stores and was not consistently discoverable. The development database contained hundreds of articles and thousands of assets while the global administrator could encounter empty tenant-scoped pages.

The immediate visibility problem was caused by four overlapping gaps:

1. Content discovery requests did not consistently use the development preview authentication fallback.
2. The article list API excluded pending and failed output, while the page displayed a generic empty state for non-authentication errors.
3. Global administrators were sent to tenant-only content and media APIs instead of an explicitly authorized platform-wide explorer.
4. Article asset inserts did not consistently persist the parent article's team ownership.
5. The storage layer had been switched to DigitalOcean Spaces without a read path for historical objects still held in Replit Object Storage.

## Evidence before remediation

| Content store | Records |
| --- | ---: |
| Articles | 881 |
| Article assets | 4,276 |
| Social posts | 65 |
| Social assets | 788 |
| Ready social videos | 32 |
| Ready podcasts | 4 |
| Article assets missing direct team ownership | 3,377 |

Article lifecycle distribution:

- COMPLETE: 778
- FAILED: 56
- GPT4_ENHANCED: 38
- PENDING: 9

The data proved that generation was not empty. Discovery and ownership were the primary failures.

## Implemented upgrade

### Global Generated Content explorer

A global-admin-only explorer now provides:

- Platform-wide summary counts.
- Separate Articles, Images, Videos, and Podcasts tabs.
- Social image and video inclusion.
- Team attribution.
- Lifecycle status visibility, including failed and pending articles.
- Links back to the source article or social post.
- Explicit error states instead of false empty states.

Normal users continue to use team-scoped APIs. Global access is granted only through the existing platform-admin authorization guard.

### Existing library repairs

- Default React Query discovery requests now use the same authenticated request helper as generation calls.
- Media Manager requests use the development preview bearer fallback.
- Article search includes every non-deleted lifecycle state rather than completed output only.
- Refresh updates both batches and article results.
- Media Manager includes generated social image/video assets.
- Source-specific actions no longer send social asset IDs to article-asset mutation endpoints.
- Global admins can retrieve private generated objects after platform-admin authorization.
- Object reads try configured DO Spaces first and then the legacy Replit Object Storage bucket, preserving historical media during migration.
- The misleading standalone upload panel was removed until uploads have a durable ownership record.

### Ownership repair

- New article image/media writes copy the validated parent article team.
- Podcast asset writes persist the article team.
- 3,377 historical article asset rows were backfilled from their parent article.
- Remaining active article assets without ownership after the repair: 0.

## Live post-upgrade evidence

The authenticated admin API returned HTTP 200 for every library type:

| Tab | Visible total |
| --- | ---: |
| Articles | 881 |
| Images | 4,989 |
| Videos | 103 |
| Podcasts | 4 |
| Social posts (summary) | 65 |
| Failed articles (summary) | 56 |
| Missing asset ownership | 0 |

Authenticated byte-range preview checks:

- Image: HTTP 206, `image/png`
- Video: HTTP 206, `video/mp4`
- Podcast: HTTP 206, `audio/mpeg`

The image total includes article and social assets. The video total includes article video assets, social video assets, and ready parent social-video records; the current model can represent the same generated video in more than one legacy store.

## Remaining architecture gaps

### 1. Authentication context containment — high priority

The session bootstrap currently enters an asynchronous system database context before authorization completes. Team guards replace it with tenant context, and list routes also use explicit team predicates, but the system context should be callback-scoped so it cannot leak across an awaited guard boundary.

Recommended change:

- Add callback-scoped session bootstrap helpers.
- Run identity/session lookup inside a bounded system callback.
- Run all tenant route work inside a bounded authenticated-team callback.
- Add cross-team denial tests that assert both SQL predicates and PostgreSQL RLS behavior.

### 2. Canonical asset registry — medium priority

Generated output is still split across:

- Article fields.
- Article asset rows.
- Social post fields.
- Social variant image fields.
- Social asset rows.
- Video-idea and campaign models.

This causes duplicate counting, inconsistent mutation endpoints, and source-specific UI logic.

Recommended change:

- Introduce a stable asset identity and source type.
- Store team, source record, generation run, campaign, object key, format, lifecycle, and publication status in one registry.
- Migrate reads before migrating generation writers.
- Reconcile duplicates by object key/hash without deleting source records until parity is proven.

### 3. Pagination and filters — medium priority

The new admin explorer intentionally caps each tab response. Add cursor pagination, team filtering, date ranges, lifecycle filters, and deduplication before using it as an operational archive.

### 4. Durable standalone uploads — medium priority

Standalone uploads currently lack a parent article and therefore lack a durable ownership row. Add an explicitly team-owned generic asset record before restoring the uploader.

### 5. Content observability — medium priority

Add metrics and alerts for:

- Generation completed but not visible.
- Asset row without an object.
- Object without an ownership row.
- Completion-to-library visibility latency.
- Duplicate object hashes across legacy content stores.
- Failed output grouped by pipeline stage and provider.

### 6. Object-storage migration — completed September 9, 2026

The historical object migration is certified in
`reports/media-storage-migration-evidence.json`:

- 6,401 legacy objects inventoried.
- 5,985 database owner references inventoried across article, social, video-idea, and podcast sources.
- 6,086 objects copied and verified by size and SHA-256.
- 315 existing primary objects independently verified by size and SHA-256.
- 0 database owner references point to a missing object.
- 1,250 legacy objects have no current database owner and are explicitly reported; they were copied without deleting either the objects or database records.
- 0 copy or verification failures.
- Primary-storage image full read: PASS.
- Primary-storage video full read and byte-range read: PASS.
- Primary-storage podcast full read: PASS.

The primary provider is configured on the DigitalOcean host and passes an
authenticated bucket check. Legacy reads can be disabled only when the runtime
loads the valid PASS evidence; missing, invalid, failed, or tampered evidence
keeps the compatibility fallback enabled. Certification schema 1.1 also binds
the evidence to the exact primary endpoint, bucket, and normalized prefix.
Missing primary credentials or an identity mismatch keeps fallback enabled.
Database-referenced primary-only objects are byte-read, and each referenced
media kind requires a passing primary read check.

## Release assessment

**Development content visibility:** PASS  
**Tenant isolation model:** Explicit predicates remain; callback-scoped auth context hardening is still required.  
**Production release:** Remains NO-GO pending the broader external staging, restore, rollback, canary, monitoring, and certification evidence already identified.