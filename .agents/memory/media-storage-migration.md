---
name: Media storage migration
description: Compatibility rule for generated media while historical Replit objects are migrated to DO Spaces
---

Generated media URLs are provider-neutral `/api/public-objects/...` paths, so the URL alone cannot identify whether bytes live in DO Spaces or the older Replit Object Storage bucket.

**Why:** The application was switched to DO Spaces before historical objects were copied and certified. When DO credentials were absent or the object existed only in Replit storage, valid image, video, and podcast records produced broken previews.

The Replit Object Storage sidecar is workspace-local. A DigitalOcean host can
access Spaces but cannot read the legacy bucket, so cross-provider migration
must run from the Replit workspace (or another environment with an equivalent
legacy credential broker).

DigitalOcean bucket-scoped keys can return `AccessDenied` for `ListBuckets`
while still allowing full object access to their assigned bucket. Test known
bucket candidates with a scoped `ListObjectsV2` request instead of treating
`ListBuckets` denial as an invalid key. Keep S3 listing pages at 500 keys or
less in this project: object names with XML-escaped characters can otherwise
cross the AWS SDK parser's default entity-expansion ceiling on 1,000-key pages.

**Why:** The source sidecar was unavailable on the production droplet, the
restricted Spaces key could not enumerate buckets, and 1,000-key S3 pages
failed after the destination grew during migration.

**How to apply:** Run historical copies from Replit, use the production host
only to obtain/configure non-secret Spaces identifiers, use bounded concurrent
copies, and require tamper-evident PASS evidence before disabling legacy reads.
The evidence must match the runtime's endpoint, bucket, and normalized prefix,
and primary storage must be fully configured. Certification must byte-read
database-referenced primary-only objects and record passing checks for every
referenced media kind; listing presence alone is not parity evidence.

**Why:** Unbound evidence could disable fallback for the wrong bucket, while
legacy-only sampling could let an unreadable primary-only podcast certify.

**How to apply:** Keep cutover fail-closed on missing credentials, identity
mismatch, absent media-kind coverage, or any unreadable referenced object.