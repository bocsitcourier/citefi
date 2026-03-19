# System Health Monitoring Dashboard

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  🏥 System Health Monitor                                          [← Dashboard]  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│  Last Updated: 2 seconds ago  [🔄 Auto-refresh: ON]  [📊 Full Report]  [⚙️]      │
│                                                                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                                   │
│  Overall System Status: ✅ HEALTHY                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │  UPTIME      │  │  RESPONSE    │  │  ERROR RATE  │  │  QUEUE       │        │
│  │  99.97%      │  │  245ms       │  │  0.03%       │  │  12 jobs     │        │
│  │  ✅ Excellent │  │  ✅ Good      │  │  ✅ Low       │  │  ✅ Normal    │        │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘        │
│                                                                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                                   │
│  🔌 Service Status                                                                │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │  Service              Status    Response  Uptime   Last Check              │ │
│  ├────────────────────────────────────────────────────────────────────────────┤ │
│  │  ✅ Next.js App       RUNNING    89ms     100%     2s ago                   │ │
│  │  ✅ PostgreSQL DB     RUNNING    12ms     100%     2s ago                   │ │
│  │  ✅ Redis Cache       RUNNING    3ms      100%     2s ago                   │ │
│  │  ✅ BullMQ Queue      RUNNING    8ms      99.9%    2s ago                   │ │
│  │  ✅ Gemini API        AVAILABLE  450ms    99.5%    5s ago                   │ │
│  │  ✅ GPT-4 API         AVAILABLE  320ms    99.8%    5s ago                   │ │
│  │  ✅ DO Spaces         AVAILABLE  145ms    99.9%    10s ago                  │ │
│  │  ✅ Geocoding API     AVAILABLE  89ms     99.7%    15s ago                  │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                                   │
│  📊 Performance Metrics (Last 24 Hours)                                           │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                              │ │
│  │  API Response Times                                                          │ │
│  │  ┌──────────────────────────────────────────────────────────────────────┐  │ │
│  │  │  Avg: 245ms | P95: 890ms | P99: 1.2s                                  │  │ │
│  │  │                                                                        │  │ │
│  │  │  12am   4am    8am   12pm   4pm    8pm   12am                         │  │ │
│  │  │   │      │      │      │      │      │      │                         │  │ │
│  │  │   ▁▂▃▄▅▆█▆▅▄▃▂▁▂▃▄▅▆█▆▅▄▃▂▁▂▃▄▅▆█▆▅▄▃▂▁                            │  │ │
│  │  └──────────────────────────────────────────────────────────────────────┘  │ │
│  │                                                                              │ │
│  │  Request Volume                                                              │ │
│  │  ┌──────────────────────────────────────────────────────────────────────┐  │ │
│  │  │  Total: 12,456 requests | Success: 12,452 (99.97%)                    │  │ │
│  │  │                                                                        │  │ │
│  │  │  Peak: 342 req/min at 2:30 PM                                         │  │ │
│  │  │   ▁▂▃▄▅▆█▆▅▄▃▂▁▂▃▄▅▆█▆▅▄▃▂▁▂▃▄▅▆█▆▅▄▃▂▁                            │  │ │
│  │  └──────────────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                                   │
│  ⚙️ Job Queue Health                                                              │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                              │ │
│  │  Queue Name          Waiting  Active  Completed  Failed  Workers           │ │
│  │  ─────────────────────────────────────────────────────────────────────────  │ │
│  │  title-pool              2       3       1,234      0      5/5 healthy     │ │
│  │  batch-generation        5       2       3,456      2      8/10 healthy    │ │
│  │  article-generation      3       4       8,923      5      12/15 healthy   │ │
│  │  image-generation        2       1       4,567      1      3/5 healthy     │ │
│  │                                                                              │ │
│  │  Average Processing Time:                                                    │ │
│  │  • Title Pool: 45 seconds                                                    │ │
│  │  • Article: 8.5 minutes                                                      │ │
│  │  • Image: 12 seconds                                                         │ │
│  │                                                                              │ │
│  │  Failed Jobs: 8 total  [View Failed Jobs →]                                 │ │
│  │  • 3 Gemini quota errors (scheduled retry in 45 min)                        │ │
│  │  • 2 Spaces upload timeouts (manual intervention needed)                    │ │
│  │  • 3 Schema validation errors (fixed in latest version)                     │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                                   │
│  💾 Database Health                                                               │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │  Connections: 23/100 (23% utilized)                                          │ │
│  │  Query Performance: Avg 12ms | Slowest: 456ms (acceptable)                  │ │
│  │  Storage: 2.3 GB / 10 GB (23% used)                                          │ │
│  │  Cache Hit Rate: 94.2% (excellent)                                           │ │
│  │  Last Backup: 2:00 AM today (successful)                                     │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                                   │
│  ⚠️ Alerts & Warnings                                                             │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │  🟡 Redis memory usage at 78% (warning threshold: 80%)                      │ │
│  │     Consider scaling up or enabling eviction policy                          │ │
│  │     [View Details] [Configure Alerts]                                        │ │
│  │                                                                              │ │
│  │  🔵 New system update available (v3.1.2)                                     │ │
│  │     Includes performance improvements and bug fixes                          │ │
│  │     [View Changelog] [Schedule Update]                                       │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
```
