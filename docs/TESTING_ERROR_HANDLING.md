# Error Handling Testing & Monitoring Guide

## Overview
This guide covers testing and monitoring of error handling in the ApexContent Engine, specifically focusing on OpenAI API integration, rate limiting, timeout handling, and overall system resilience.

## Phase 3: Error Handling Testing

### Test 1: Timeout Handling

**Objective:** Verify that OpenAI API timeouts are handled gracefully with automatic retries.

**Implementation Status:**
- ✅ **ALREADY IMPLEMENTED** in `lib/openai-client.ts`
- Timeout: 60 seconds (configurable)
- Max retries: 3 with exponential backoff
- Detection: Catches `ETIMEDOUT` errors

**Manual Test:**
```typescript
// Simulate a timeout by setting extremely short timeout
process.env.OPENAI_TIMEOUT_MS = "100"; // 100ms timeout
```

**Expected Behavior:**
1. Request times out after 100ms
2. System automatically retries 3 times with exponential backoff (1s → 2s → 4s)
3. If all retries fail, error is logged and reported
4. OpenAI stats show increased `totalRetries` counter

**Verification:**
- Check console logs for retry messages: `⚠️ [OpenAI] Retrying in Xms...`
- Check `/api/admin/openai-stats` for retry rate
- Confirm graceful degradation (no crashes)

---

### Test 2: Rate Limiting (429 Errors)

**Objective:** Verify that OpenAI rate limit errors are handled with automatic backoff.

**Implementation Status:**
- ✅ **ALREADY IMPLEMENTED** in `lib/openai-client.ts`
- Bottleneck rate limiter with max 15 concurrent requests
- Automatic detection of HTTP 429 status
- Exponential backoff with jitter (up to 10s max delay)

**Manual Test:**
```bash
# Reduce concurrency to trigger rate limits faster
export OPENAI_CONCURRENCY=1
export OPENAI_MAX_RETRIES=5
```

**Expected Behavior:**
1. When 429 error occurs, request enters retry queue
2. System waits with exponential backoff: 1s → 2s → 4s → 8s → 10s (capped)
3. Random jitter prevents thundering herd
4. Request succeeds after rate limit window expires

**Verification:**
- Check console logs: `⚠️ OpenAI rate limit hit, retrying in Xms...`
- Monitor `/api/admin/openai-stats` for `retryRate`
- Verify requests eventually succeed

---

### Test 3: Validation Errors

**Objective:** Verify that invalid request data is caught and reported clearly.

**Test Cases:**

**3a. Invalid Article Generation Request**
```bash
curl -X POST http://localhost:5000/api/social_posts/generate \
  -H "Content-Type: application/json" \
  -d '{
    "platforms": [],  # INVALID: Empty array
    "tone": "Professional"
  }'
```

**Expected Response:**
```json
{
  "error": "Invalid request data",
  "details": [
    {
      "code": "too_small",
      "minimum": 1,
      "path": ["platforms"],
      "message": "Array must contain at least 1 element(s)"
    }
  ]
}
```

**3b. Missing Required Fields**
```bash
curl -X POST http://localhost:5000/api/social_posts/generate \
  -H "Content-Type: application/json" \
  -d '{
    "platforms": ["twitter"]
    # MISSING: articleId OR standaloneTitle
  }'
```

**Expected Response:**
```json
{
  "error": "Invalid request data",
  "details": [
    {
      "message": "Either articleId or standaloneTitle must be provided"
    }
  ]
}
```

---

### Test 4: Authentication Errors

**Objective:** Verify that authentication failures are handled securely.

**Test Cases:**

**4a. Missing Auth Token**
```bash
curl -X GET http://localhost:5000/api/articles/list
# No Authorization header
```

**Expected Response:**
```json
{
  "error": "Authentication required"
}
```
**Status Code:** 401

**4b. Invalid Auth Token**
```bash
curl -X GET http://localhost:5000/api/articles/list \
  -H "Authorization: Bearer invalid_token_123"
```

**Expected Response:**
```json
{
  "error": "Invalid or expired token"
}
```
**Status Code:** 401

**4c. Team Isolation Violation**
```bash
# User with teamId=1 tries to access teamId=2's article
curl -X GET http://localhost:5000/api/articles/506 \
  -H "Authorization: Bearer <user_team_1_token>"
# Article 506 belongs to team 2
```

**Expected Response:**
```json
{
  "error": "Article not found or access denied"
}
```
**Status Code:** 404

---

### Test 5: Batch Generation End-to-End

**Objective:** Verify complete batch generation flow with error recovery.

**Test Steps:**

1. **Generate Title Pool** (Gemini API)
```bash
curl -X POST http://localhost:5000/api/jobs/title-pool \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "keywords": ["Massachusetts courier service"],
    "location": "Boston",
    "numTitles": 50,
    "industry": "Healthcare",
    "tone": "Professional"
  }'
```

2. **Submit Batch for Generation**
```bash
curl -X POST http://localhost:5000/api/jobs/batch-submit \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "batchId": 123,
    "selectedTitles": [1, 2, 3, 4, 5],
    "tone": "Professional",
    "wordCountMin": 800,
    "wordCountMax": 2000
  }'
```

3. **Monitor Job Progress**
```bash
curl -X GET "http://localhost:5000/api/monitoring/batch/123" \
  -H "Authorization: Bearer <token>"
```

**Expected Behavior:**
- All 5 articles complete successfully OR fail with detailed error messages
- Reddit research is cached and reused across articles
- OpenAI retries handle transient failures automatically
- Final status shows completion percentage and any errors

---

### Test 6: OpenAI Metrics Monitoring

**Objective:** Verify that OpenAI metrics are tracked and exposed correctly.

**Test Steps:**

1. **Generate Some Load**
```bash
# Generate 10 social posts to create API activity
for i in {1..10}; do
  curl -X POST http://localhost:5000/api/social_posts/generate \
    -H "Authorization: Bearer <token>" \
    -H "Content-Type: application/json" \
    -d '{
      "articleId": "506",
      "platforms": ["twitter", "linkedin"],
      "tone": "Professional"
    }'
  sleep 2
done
```

2. **Check Metrics Endpoint**
```bash
curl -X GET http://localhost:5000/api/admin/openai-stats \
  -H "Authorization: Bearer <admin_token>"
```

**Expected Response:**
```json
{
  "openai": {
    "totalCalls": 40,
    "totalRetries": 2,
    "totalFailures": 0,
    "queueSize": 0,
    "activeRequests": 5,
    "errorRate": 0,
    "retryRate": 5.0,
    "successRate": 100
  },
  "health": {
    "status": "healthy",
    "message": "OpenAI integration performing well"
  },
  "timestamp": "2025-11-19T18:30:00.000Z"
}
```

3. **Check Admin Dashboard**
- Navigate to `/admin/health`
- Verify "OpenAI API Metrics" card is visible
- Confirm real-time updates every 5 seconds
- Check that error rate shows `< 2%` target

---

## Phase 4: Ongoing Monitoring

### Monitoring Dashboard

**Location:** `/admin/health`

**Metrics Tracked:**
- ✅ Success Rate (target: >98%)
- ✅ Error Rate (target: <2%)
- ✅ Retry Rate
- ✅ Total API Calls
- ✅ Queue Size
- ✅ Active Requests

**Auto-Refresh:** Every 5 seconds

---

### Error Logging

**All errors are logged with:**
- Context (operation name)
- Attempt number (for retries)
- Error type (timeout, rate limit, other)
- Timestamp
- Stack trace (for failures)

**Example Log Output:**
```
[OpenAI] ⚠️  Finalize Content failed (attempt 1/3): Request timeout. Retrying in 1250ms...
[OpenAI] ⚠️  Finalize Content failed (attempt 2/3): Request timeout. Retrying in 2890ms...
[OpenAI] ✓ Finalize Content succeeded on attempt 3 (8540ms)
```

---

### Alert Thresholds

**Critical Alerts (Manual Review Required):**
- Error rate > 10% → Status: **CRITICAL**
- More than 3 consecutive failures on same operation
- Queue size > 100 requests

**Warning Alerts (Monitor Closely):**
- Error rate 2-10% → Status: **WARNING**
- Retry rate > 20%
- Average response time > 30 seconds

**Healthy Status:**
- Error rate < 2%
- Retry rate < 10%
- Success rate > 98%

---

### Performance Targets

| Metric | Target | Current Implementation |
|--------|--------|----------------------|
| Error Rate | < 2% | ✅ Tracked in real-time |
| Timeout Rate | < 1% | ✅ 60s timeout with retries |
| Retry Rate | < 10% | ✅ 3 retries with backoff |
| API Response Time | < 30s avg | ⚠️ Not currently tracked |
| Queue Depth | < 50 | ✅ Tracked in real-time |

---

## Console Logs

**Real-Time Stats (Every 60 seconds):**
```
[OpenAI Stats] Calls: 1234, Retries: 45, Failures: 3, Queue: 0, Active: 8
```

**Per-Request Logs:**
```
[OpenAI] 🕐 Using extended timeout: 240000ms for Finalize Content
[OpenAI] ✓ Finalize Content succeeded (12500ms)
[OpenAI] ⏱️  Generate Social Post completed in 35000ms  # Slow request warning
```

---

## Testing Checklist

### Before Deployment
- [ ] Test timeout handling (set short timeout, verify retries)
- [ ] Test rate limiting (reduce concurrency, trigger 429s)
- [ ] Test validation errors (send invalid requests)
- [ ] Test auth errors (invalid tokens, missing tokens, team isolation)
- [ ] Run end-to-end batch generation (5-10 articles)
- [ ] Verify OpenAI metrics dashboard updates in real-time

### After Deployment
- [ ] Monitor error rate daily (target: <2%)
- [ ] Review retry logs weekly
- [ ] Check for stuck jobs (jobs running >1 hour)
- [ ] Verify Reddit research caching reduces API calls
- [ ] Track API costs vs. throughput

---

## Troubleshooting

### High Error Rate (>2%)

**Diagnosis:**
1. Check `/api/admin/openai-stats` for error types
2. Review console logs for error patterns
3. Check OpenAI status page: https://status.openai.com

**Solutions:**
- If timeouts: Increase `OPENAI_TIMEOUT_MS` (default: 60000)
- If rate limits: Reduce `OPENAI_CONCURRENCY` (default: 15)
- If validation errors: Check prompt templates for invalid inputs

### High Retry Rate (>20%)

**Diagnosis:**
1. Check if retries are due to timeouts or rate limits
2. Review retry logs for patterns (specific operations failing?)

**Solutions:**
- For timeout retries: Optimize prompts (reduce token count)
- For rate limit retries: Increase `minTime` in Bottleneck (default: 50ms)
- Consider upgrading OpenAI tier for higher rate limits

### Stuck Jobs

**Diagnosis:**
1. Check `/api/monitoring/batch/<batchId>` for status
2. Look for jobs in "ACTIVE" state for >60 minutes

**Solutions:**
- Review article worker logs for errors
- Check if pg-boss partition exists: `SELECT * FROM pgboss.job WHERE name='article-generation'`
- Restart workers if needed: `npm run workers`

---

## Summary

✅ **Fully Implemented:**
- Automatic timeout detection and retry (3 attempts, exponential backoff)
- Rate limit handling with Bottleneck (429 errors)
- Comprehensive error logging
- Real-time metrics tracking
- Admin dashboard for monitoring

✅ **Performance Targets:**
- Error rate < 2% (enforced)
- Retry rate monitored and tracked
- Queue depth visible in real-time

⚠️ **Future Enhancements:**
- Automated alerting (email/Slack on critical errors)
- API response time tracking (percentiles: p50, p95, p99)
- Cost per API call tracking
- Predictive scaling based on queue depth
