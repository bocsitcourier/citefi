# ApexContent Engine 3.0/5.0 - Complete Wireframe Collection

## Overview
This directory contains comprehensive wireframes for the ApexContent Engine 3.0/5.0, a geo-first, enterprise-grade dual-AI SEO content factory with advanced admin capabilities, authentication, competitor analysis, and content versioning.

## Complete Wireframe Index

### Authentication & User Management
**08. Login & Authentication** (`08-login-authentication.md`)
- Login page with email/password
- Multi-factor authentication (MFA) flow
- Role selection (Admin/Content Creator)
- JWT-based secure authentication

### Core Content Creation Flow
**01. Batch Creation Wizard** (`01-batch-creation-wizard.md`)
- 5-step wizard: Topic → Locations → Business (NAP) → Settings → Review
- Multi-location targeting with cascading dropdowns
- LocalBusiness schema configuration
- Content structure preferences

**12. Advanced Batch Wizard** (`12-advanced-batch-wizard.md`)
- Competitor URL analysis (up to 5 competitors)
- Topic cluster selection for semantic linking
- SERP feature targeting (Featured Snippet, PAA, List, Q&A)
- Content refresh mode toggle

**02. Title Pool Selection** (`02-title-pool-selection.md`)
- 50 AI-generated titles with geo context
- Location tags, intent classification, trust indicators
- Search and filter functionality
- Strategic content recommendations

### Content Management
**03. Batch Detail View** (`03-batch-detail-view.md`)
- Progress metrics with geo context
- Location details with coordinates
- Business NAP display
- Article list with SEO scores and hashtags

**04. Article Editor** (`04-article-editor.md`)
- Left panel: SEO & Geo metadata
- Center: Rich text editor (Tiptap)
- Bottom: Preview tabs (Edit, Preview, SERP, Social)
- Real-time SEO scoring with local signal tracking

**13. Rich Content Editor** (`13-rich-content-editor.md`)
- Monaco/CodeMirror editor for HTML/Markdown
- Image/audio/video upload with DigitalOcean Spaces
- AI assistant with suggestions
- Media management panel
- Internal link suggestions

**14. Content Versioning** (`14-content-versioning.md`)
- Version history with rollback capability
- Content refresh recommendations
- Rank drop detection
- Version comparison tool
- AI-powered update suggestions

### Social & Export
**05. Social Preview** (`05-social-preview.md`)
- Twitter/X card preview with emoji-rich snippets
- Facebook/LinkedIn card preview
- Instagram caption generator
- Platform-specific hashtag optimization

**06. Export Options** (`06-export-options.md`)
- WordPress export with geo meta tags
- Google Sheets with full geo columns
- ZIP download with complete package
- XML Sitemap with hreflang tags
- CSV and Markdown export options

### Admin Dashboard & Monitoring
**07. Admin Dashboard** (`07-admin-dashboard.md`)
- Top locations by content volume
- Recent batches with geo analytics
- SEO performance metrics
- System alerts and requeue options

**09. Admin Dashboard - Full** (`09-admin-dashboard-full.md`)
- Real-time system overview with stats
- Live job queue monitoring
- System alerts and errors
- Performance metrics (Last 30 days)
- Cost analytics and geographic distribution

**10. Error Log Management** (`10-error-log-management.md`)
- Filterable error log panel
- Critical errors with suggested actions
- Bulk resolution and retry
- Error categorization (Gemini, GPT-4, Schema, Upload)
- Resolution tracking

**11. SEO & Cost Reporting** (`11-seo-cost-reporting.md`)
- Cost overview (Total, Gemini, GPT-4, Storage)
- Cost_Per_Rank analysis
- Top/bottom performing articles
- SEO score distribution
- Geo-accuracy metrics
- Geographic cost analysis

**15. Health Monitoring** (`15-health-monitoring.md`)
- Overall system status
- Service status for all components
- Performance metrics (24-hour view)
- Job queue health monitoring
- Database health metrics
- Real-time alerts and warnings

## Architecture & Features

### 1. **Authentication & Security**
- JWT-based authentication with token expiration
- Role-based access control (Admin/Standard User)
- Multi-factor authentication (optional)
- Secure session management

### 2. **Geo-First Architecture**
- Country → State → City → ZIP cascading selection
- Geocoding API integration (Google Places/Mapbox)
- LocalBusiness schema generation
- Hreflang tags for multi-region content
- NAP (Name/Address/Phone) data management

### 3. **Advanced AI Features**
- **BLUF Principle**: Bottom Line Up Front summaries
- **Competitor Grounding**: Extract insights from top 3-5 competitors
- **SERP Targeting**: Featured Snippet, PAA, List, Q&A optimization
- **Topic Clusters**: Semantic internal linking strategy
- **Content Refresh**: Automatic rank drop detection and suggestions

### 4. **Dual-AI Pipeline**
- **Gemini 2.5 Pro**: Draft generation with hero images
- **GPT-4**: SEO optimization, hyperlinking, schema validation
- **Structured Output**: JSON with sections, BLUF, FAQ, schemas

### 5. **Content Structure**
- Natural language H2/H3 headings as questions
- Contextual bridges between sections
- Definition boxes, TL;DR summaries, checklists
- FAQ schema, HowTo schema, Article schema

### 6. **Rich Media Management**
- Image/audio/video upload to DigitalOcean Spaces
- Automatic WebP conversion and optimization
- CDN delivery for all media
- Alt text templates with geo and keyword injection

### 7. **Content Versioning**
- Full version history with metadata
- One-click rollback to any version
- Version comparison tool
- Rank tracking per version
- AI-powered refresh recommendations

### 8. **Admin & Monitoring**
- Real-time job queue monitoring
- Error log management with resolution tracking
- SEO & cost analytics with Cost_Per_Rank metrics
- System health monitoring
- Token usage tracking
- Geographic performance analysis

### 9. **Export & Publishing**
- WordPress REST API integration
- Google Sheets with full geo metadata
- CSV export with all fields
- Markdown with frontmatter
- XML Sitemap with hreflang
- ZIP packages with manifest

## Data Flow

### Content Creation Flow
```
User Login → Batch Wizard → Competitor Analysis → Title Pool → 
Article Generation (Gemini) → ChatGPT Review → Editor → 
Version Save → Publish/Export
```

### Admin Monitoring Flow
```
Dashboard → Live Queue → Error Logs → Resolution → 
SEO Reports → Health Check → Alerts
```

### Content Refresh Flow
```
Rank Drop Detection → AI Analysis → Recommendations → 
Schedule Refresh → New Version → Comparison → Publish
```

## UI/UX Principles

### 1. **Progressive Disclosure**
- Complex features behind toggles and expandable sections
- Wizard guides new users through creation
- Expert mode for advanced users

### 2. **Real-Time Feedback**
- Live job queue updates
- SEO score calculations
- Error notifications
- Health monitoring

### 3. **Data Density with Clarity**
- Rich metadata visible but organized
- Collapsible panels for optional data
- Visual hierarchy guides attention

### 4. **Role-Based Views**
- Admins see system-wide data
- Standard users see their content only
- Contextual actions based on permissions

### 5. **Actionable Insights**
- SEO scores with specific recommendations
- Cost analysis with optimization tips
- Content refresh suggestions
- Error resolution workflows

## Technical Requirements

### Database Tables
- `users` - Authentication and roles
- `job_batches` - Batch tracking with geo data
- `articles` - Full content with versioning
- `article_versions` - Version history
- `article_assets` - Media files
- `locales` - Geographic data
- `seo_logs` - Performance tracking
- `error_logs` - Error management
- `admin_action_logs` - Audit trail

### API Endpoints
- `/api/auth/login` - Authentication
- `/api/jobs/batch-submit` - Create batch
- `/api/review/gpt` - ChatGPT enrichment
- `/api/geo/places` - Location autocomplete
- `/api/admin/dashboard` - Admin stats
- `/api/admin/seo-report` - Cost analysis
- `/api/health` - System health

### External Services
- **Google AI (Gemini)**: Content generation
- **OpenAI (GPT-4)**: Content optimization
- **DigitalOcean Spaces**: Media storage
- **Google Places/Mapbox**: Geocoding
- **Google Trends**: Seasonal analysis
- **Redis/BullMQ**: Job queue

## Implementation Notes

### Frontend
- Next.js 14 with App Router
- shadcn/ui components
- Monaco/CodeMirror editor
- TanStack Query for state
- Tailwind CSS with purple theme

### Backend
- Next.js API routes
- BullMQ job queue
- PostgreSQL with Drizzle ORM
- JWT authentication
- Structured logging (Pino/Winston)

### Deployment
- DigitalOcean App Platform
- SSR with auto-scaling
- PM2 process management
- Environment variable management

## Next Steps

1. ✅ Design validation complete
2. 🔄 Component library development
3. 📋 API endpoint implementation
4. 🗄️ Database schema migration
5. 🤖 AI pipeline integration
6. 🧪 End-to-end testing
7. 🚀 Production deployment

## Notes

- All wireframes use ASCII art for version control clarity
- Actual implementation uses shadcn/ui components
- data-testid attributes marked for automated testing
- Responsive design considerations needed for mobile
- Dark mode support throughout all screens
