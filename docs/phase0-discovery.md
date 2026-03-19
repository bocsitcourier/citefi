# Phase 0: Geo-First Discovery & Business Rules

## Geocoding Provider Selection

### Selected Provider: **Google Places API**

**Rationale:**
1. **Comprehensive Coverage**: Global database with NAP data, coordinates, business info
2. **Accuracy**: Industry-leading geocoding precision (rooftop-level for addresses)
3. **Rich Data**: Returns formatted_address, place_id, geometry, address_components
4. **Existing Integration**: OpenAI already in use, Google ecosystem familiar
5. **Enterprise Support**: SLA guarantees, 24/7 support, predictable pricing

**Alternative Providers Considered:**
- ❌ OpenCage: Cheaper but less accurate NAP data
- ❌ Mapbox: Better for mapping, weaker on business data
- ❌ Nominatim: Free but rate-limited (1 req/sec), no commercial support

**Cost Structure:**
- Geocoding API: $5 per 1,000 requests
- Places API (Autocomplete): $2.83 per 1,000 requests
- Places Details: $17 per 1,000 requests
- **Monthly Budget**: $200 for ~10,000 geocodes

**API Key Management:**
- Environment variable: `GOOGLE_PLACES_API_KEY`
- Stored in Replit Secrets
- Rate limiting: 100 requests/second (enterprise tier)

---

## NAP Data Business Rules

### NAP Format Standards

**Business Name:**
- Max length: 255 characters
- Required: Yes (for local SEO articles)
- Example: "Apex Digital Marketing Solutions"

**Address:**
- Format: Street, City, State ZIP, Country
- Max length: 500 characters
- Required: Yes
- Validated against Google Places formatted_address
- Example: "123 Main St, San Francisco, CA 94105, USA"

**Phone:**
- Format: E.164 international format
- Max length: 20 characters
- Required: Yes
- Example: "+1-415-555-0123"

### Coordinate Precision

**Latitude/Longitude:**
- Precision: 6 decimal places (~0.11 meters)
- Format: Decimal degrees (DD)
- Range: lat [-90, 90], lng [-180, 180]
- Example: `{ lat: 37.774929, lng: -122.419418 }`

**Accuracy Tiers:**
- **ROOFTOP**: Building-level (0-10m) - Score: 100
- **RANGE_INTERPOLATED**: Street-level (10-50m) - Score: 80
- **GEOMETRIC_CENTER**: Neighborhood/city center (50-500m) - Score: 60
- **APPROXIMATE**: City/region level (500m+) - Score: 40

---

## Locale Governance Rules

### Locale Table Schema

**Fields:**
- `id`: serial PRIMARY KEY
- `countryCode`: varchar(2) NOT NULL (ISO 3166-1 alpha-2)
- `region`: varchar(100) - State/Province
- `city`: varchar(100)
- `postalCode`: varchar(20)
- `latitude`: decimal(10, 7) - 6 decimal precision
- `longitude`: decimal(11, 7) - 6 decimal precision
- `placeId`: varchar(255) UNIQUE - Google Places ID
- `formattedAddress`: text - Full address from Google
- `language`: varchar(10) DEFAULT 'en-US'
- `timezone`: varchar(50) - IANA timezone
- `population`: integer - Optional demographic data
- `createdAt`: timestamp DEFAULT NOW()

**Indexes:**
- Primary: `id`
- Unique: `placeId`
- Composite: `(city, region)` for fast lookups
- Spatial: `(latitude, longitude)` for radius queries

### Multi-Locale Strategy

**Locale Selection:**
1. User provides address/city in job batch form
2. System geocodes via Google Places API
3. Creates/reuses locale record with coordinates
4. Links locale to job_batches.localeId and articles.localeId

**Locale Reuse:**
- Identical `placeId` → reuse existing locale
- Similar address (fuzzy match) → prompt user to select
- New location → create new locale record

**Geocoding Workflow:**
```
User Input: "San Francisco, CA"
    ↓
Google Places API: Place Autocomplete
    ↓
User Selects: "San Francisco, CA, USA"
    ↓
Google Places API: Place Details (lat/lng, placeId, formatted_address)
    ↓
Database: INSERT/SELECT locale WHERE placeId = 'ChIJIQBpAG2ahYAR...'
    ↓
Job Batch: SET localeId = 42
```

---

## Geo-Accuracy Scoring

### Scoring Algorithm (0-100)

**Components:**
1. **Geocoding Accuracy** (40 points)
   - ROOFTOP: 40
   - RANGE_INTERPOLATED: 30
   - GEOMETRIC_CENTER: 20
   - APPROXIMATE: 10

2. **NAP Completeness** (30 points)
   - All fields present (name, address, phone): 30
   - 2 fields: 20
   - 1 field: 10
   - 0 fields: 0

3. **Local Keyword Density** (20 points)
   - City/region mentioned 5+ times: 20
   - 3-4 times: 15
   - 1-2 times: 10
   - 0 times: 0

4. **Schema.org LocalBusiness** (10 points)
   - Valid LocalBusiness markup: 10
   - Invalid/missing: 0

**Final Score Calculation:**
```javascript
geoAccuracyScore = 
  geocodingAccuracy + 
  napCompleteness + 
  localKeywordDensity + 
  schemaMarkupScore
```

**Example:**
- Geocoding: ROOFTOP (40)
- NAP: All fields (30)
- Keywords: 5+ mentions (20)
- Schema: Valid (10)
- **Total: 100/100** ✅

---

## Feature Flags & Rollout

### Phase 0 Flags

**Environment Variables:**
```bash
GEO_FEATURES_ENABLED=true
GOOGLE_PLACES_API_KEY=<secret>
GEOCODING_RATE_LIMIT=100  # req/sec
LOCALE_CACHE_TTL=86400    # 24 hours
```

**Dry-Run Mode:**
- `GEO_DRY_RUN=true` → Logs geocoding without DB writes
- Test with synthetic addresses before production

**Gradual Rollout:**
1. Week 1: Internal testing with 5 test locales
2. Week 2: Beta users (100 locales max)
3. Week 3: Full production release

---

## Risk Mitigation

### API Quota Limits
- **Risk**: Exceed Google Places API quota (100 req/sec)
- **Mitigation**: Implement rate limiter with exponential backoff
- **Fallback**: Cache locale lookups for 24 hours

### Schema Drift
- **Risk**: Locale table changes break existing code
- **Mitigation**: Use database migrations with rollback scripts
- **Testing**: Synthetic locale data for unit tests

### Cross-Service Latency
- **Risk**: Google API calls slow down article generation
- **Mitigation**: Async geocoding job queue (separate worker)
- **Timeout**: 5-second timeout per geocode request

### Cost Overruns
- **Risk**: Unexpected API charges
- **Mitigation**: Daily cost alerts ($50 threshold)
- **Budget Cap**: $200/month hard limit via Google Cloud

---

## Next Steps

✅ **Phase 0 Complete** - Ready for Phase 1 schema implementation

**Phase 1 Tasks:**
1. Update shared/schema.ts with locales table
2. Add geo fields to articles and job_batches
3. Add ChatGPT enrichment fields (meta JSONB, seo_score)
4. Run `npm run db:push` to migrate
5. Update TypeScript types

**Acceptance Criteria:**
- [ ] Locales table exists with lat/lng coordinates
- [ ] job_batches has businessName, address, phone, localeId
- [ ] articles has localeId foreign key
- [ ] Google Places API key configured in secrets
- [ ] Database migration successful with 0 errors
