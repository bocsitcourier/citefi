# Admin Dashboard - Full System View

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  🎛️ Admin Dashboard                  admin@example.com [⚙️ Settings] [🚪 Logout]  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────┐│
│  │ 📊 STATS │  │ 🔄 JOBS  │  │ 📄 CONTENT│ │ ⚠️ ERRORS │  │ 💰 COSTS │  │🔍...││
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └─────┘│
│                                                                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                                   │
│  📊 System Overview                                                               │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐    │
│  │ 📝 BATCHES│  │ 📄 ARTICLES│  │ 🌍 LOCATIONS│  │ 👥 USERS  │  │ 💰 API COST│    │
│  │    127    │  │   3,456   │  │     48     │  │     23    │  │  $1,247.80 │    │
│  │   Total   │  │ Generated │  │  Targeted  │  │  Active   │  │ This Month │    │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  └───────────┘    │
│                                                                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                                   │
│  🔄 Live Job Queue                                         [🔄 Refresh] [⏸️ Pause] │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                                                                           │   │
│  │  ⏳ Batch #1289: "Medical equipment suppliers"                           │   │
│  │     📍 San Francisco, CA | Progress: ████████░░ 8/10 articles            │   │
│  │     🤖 Current: GPT-4 Review → Article #8                                │   │
│  │     ⏱️ Est. completion: 3 min | 💰 Cost so far: $2.40                    │   │
│  │     [👁️ View] [⏸️ Pause] [❌ Cancel]                                       │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │  🔄 Batch #1288: "Emergency plumbing services"                           │   │
│  │     📍 Miami, FL | Progress: ████████████ 15/15 titles generated         │   │
│  │     🤖 Current: Title Pool Ready → Awaiting User Selection               │   │
│  │     ⏱️ Started: 12 min ago | 💰 Cost: $1.20                              │   │
│  │     [👁️ View] [▶️ Resume]                                                 │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │  ⚠️ Batch #1287: "Commercial HVAC installation"                          │   │
│  │     📍 Chicago, IL | Status: FAILED at Article #3                        │   │
│  │     ❌ Error: Gemini API quota exceeded (429)                            │   │
│  │     ⏱️ Failed: 45 min ago | 💰 Cost: $0.80                               │   │
│  │     [🔧 Retry] [📋 View Errors] [🗑️ Delete]                               │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                                   │
│  ⚠️ System Alerts & Errors                        [View All Errors →] [Clear All] │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  🔴 3 Critical Errors                                                     │   │
│  │  • Gemini API quota exceeded (2 batches affected)                        │   │
│  │  • DigitalOcean Spaces connection timeout (1 image upload failed)        │   │
│  │                                                                           │   │
│  │  🟡 5 Warnings                                                            │   │
│  │  • 3 articles flagged for low geo-accuracy (<50/100)                     │   │
│  │  • 2 articles recommended for content refresh (rank drop detected)       │   │
│  │                                                                           │   │
│  │  🔵 2 Info                                                                │   │
│  │  • New geocoding service update available                                │   │
│  │  • System backup completed successfully (2:00 AM)                        │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                                   │
│  📈 Performance Metrics (Last 30 Days)                                            │
│  ┌────────────────────────────────────┐  ┌────────────────────────────────┐    │
│  │  📊 Content Quality                │  │  💰 Cost Analytics             │    │
│  │  Avg SEO Score: 91/100 ⬆️ +3        │  │  Avg Cost/Article: $2.15       │    │
│  │  Avg Geo-Accuracy: 87/100 ⬆️ +5     │  │  Cost_Per_Rank: $0.23          │    │
│  │  Local Signals: 8.2/article        │  │  Total API Spend: $1,247.80    │    │
│  │  Keyword Density: 2.1% (optimal)   │  │  Gemini: $847.20 (68%)         │    │
│  │                                     │  │  GPT-4: $400.60 (32%)          │    │
│  └────────────────────────────────────┘  └────────────────────────────────┘    │
│                                                                                   │
│  ┌────────────────────────────────────┐  ┌────────────────────────────────┐    │
│  │  🌍 Geographic Distribution        │  │  ⏱️ Processing Speed            │    │
│  │  23 cities across 15 states        │  │  Avg Generation: 12.3 min      │    │
│  │  Top: Boston MA (342 articles)     │  │  Avg Title Pool: 45 sec        │    │
│  │  Coverage: 48 ZIP codes            │  │  Success Rate: 97.2%           │    │
│  └────────────────────────────────────┘  └────────────────────────────────┘    │
│                                                                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
```
