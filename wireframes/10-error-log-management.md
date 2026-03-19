# Error Log Management Panel

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  ⚠️ Error Log Management                                           [← Dashboard]  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│  Filter & Search                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │  🔍 Search errors...                                                      │   │
│  │  ┌────────────────────────────────────────────────────────────────────┐ │   │
│  │  │ article, batch, or error message                                   │ │   │
│  │  └────────────────────────────────────────────────────────────────────┘ │   │
│  │                                                                           │   │
│  │  Error Type: [All ▼]  Status: [Unresolved ▼]  Date: [Last 7 days ▼]   │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │ [Select All] [Bulk Resolve] [Bulk Retry] [Export CSV]    Showing: 127   │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                                   │
│  🔴 Critical Errors (3)                                                           │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │  ☐ #ERR-1289 | Gemini API Quota Exceeded (429)                           │   │
│  │     📄 Batch #1287: Commercial HVAC installation                          │   │
│  │     📍 Chicago, IL | Article #3/25                                         │   │
│  │     🕒 45 min ago | Status: ⚠️ Unresolved                                  │   │
│  │                                                                            │   │
│  │     Error Details:                                                         │   │
│  │     API Error: Resource exhausted (429). Quota exceeded for gemini-2.5-pro│   │
│  │     Request ID: req_abc123xyz                                              │   │
│  │     Retry attempts: 3/3 (all failed)                                       │   │
│  │                                                                            │   │
│  │     Affected Articles: Article #3, #4, #5 (batch paused)                  │   │
│  │                                                                            │   │
│  │     💡 Suggested Actions:                                                  │   │
│  │     • Wait 60 minutes for quota reset                                      │   │
│  │     • Switch to backup Gemini project key                                  │   │
│  │     • Reduce concurrent requests                                           │   │
│  │                                                                            │   │
│  │     [🔧 Retry Now] [⏰ Schedule Retry (1hr)] [✅ Mark Resolved] [📋 Details]│   │
│  ├──────────────────────────────────────────────────────────────────────────┤   │
│  │  ☐ #ERR-1288 | DigitalOcean Spaces Upload Timeout                        │   │
│  │     📄 Batch #1286: Emergency plumbing services                           │   │
│  │     📍 Miami, FL | Article #12 - Hero Image                               │   │
│  │     🕒 2 hours ago | Status: ⚠️ Unresolved                                 │   │
│  │                                                                            │   │
│  │     Error Details:                                                         │   │
│  │     Connection timeout after 30s uploading image to Spaces                │   │
│  │     File: hero_plumbing_miami_1234.webp (2.3 MB)                          │   │
│  │     Network error: ETIMEDOUT                                               │   │
│  │                                                                            │   │
│  │     💡 Suggested Actions:                                                  │   │
│  │     • Check DigitalOcean Spaces service status                             │   │
│  │     • Verify network connectivity                                          │   │
│  │     • Regenerate image with different compression                          │   │
│  │                                                                            │   │
│  │     [🔧 Retry Upload] [🖼️ Regenerate Image] [✅ Resolve] [📋 Details]      │   │
│  ├──────────────────────────────────────────────────────────────────────────┤   │
│  │  ☐ #ERR-1285 | GPT-4 Schema Validation Failed                            │   │
│  │     📄 Batch #1285: Legal consulting startups                             │   │
│  │     📍 San Francisco, CA | Article #7                                      │   │
│  │     🕒 6 hours ago | Status: ⚠️ Unresolved                                 │   │
│  │                                                                            │   │
│  │     Error Details:                                                         │   │
│  │     Generated FAQPage schema missing required "acceptedAnswer" field      │   │
│  │     Schema type: FAQPage                                                   │   │
│  │     Validation error: mainEntity[2].acceptedAnswer is undefined           │   │
│  │                                                                            │   │
│  │     💡 Suggested Actions:                                                  │   │
│  │     • Regenerate article with corrected schema prompt                      │   │
│  │     • Manually edit schema in article editor                               │   │
│  │     • Report prompt issue to engineering                                   │   │
│  │                                                                            │   │
│  │     [🔧 Regenerate] [✏️ Edit Schema] [✅ Resolve] [📋 Details]              │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                                   │
│  🟡 Warnings (5)                                              [Expand All ▼]      │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │  ☐ #WARN-1290 | Low Geo-Accuracy Score                                   │   │
│  │     📄 Article #456: "Same day courier Boston"                            │   │
│  │     🎯 Geo-Accuracy: 42/100 (Threshold: 50)                               │   │
│  │     🕒 1 hour ago | [View Article] [✅ Resolve]                            │   │
│  ├──────────────────────────────────────────────────────────────────────────┤   │
│  │  ☐ #WARN-1289 | Rank Drop Detected - Content Refresh Recommended         │   │
│  │     📄 Article #123: "Emergency HVAC repair Chicago"                      │   │
│  │     📉 Rank: 3 → 8 (down 5 positions)                                     │   │
│  │     🕒 3 hours ago | [Schedule Refresh] [✅ Resolve]                       │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                   │
│  [Load More...]                                                                   │
│                                                                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
```
