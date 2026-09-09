---
name: Media storage migration
description: Compatibility rule for generated media while historical Replit objects are migrated to DO Spaces
---

Generated media URLs are provider-neutral `/api/public-objects/...` paths, so the URL alone cannot identify whether bytes live in DO Spaces or the older Replit Object Storage bucket.

**Why:** The application was switched to DO Spaces before historical objects were copied and certified. When DO credentials were absent or the object existed only in Replit storage, valid image, video, and podcast records produced broken previews.

**How to apply:** New writes use the configured primary provider. Reads try DO Spaces first and the legacy Replit bucket second. Keep the legacy path read-only, verify object hashes/range reads during migration, and remove it only after historical parity is proven.