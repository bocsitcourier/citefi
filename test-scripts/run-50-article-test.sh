#!/bin/bash

API_BASE="http://localhost:5000"

echo "🏭 APEXCONTENT ENGINE - PRODUCTION TEST"
echo "   Testing 50-article generation with full pipeline"
echo "   Including: Gemini 2.0 Flash + GPT-4o-mini + Images"
echo ""

# Step 1: Generate title pool
echo "🎯 Step 1: Generating title pool (50 SEO-optimized titles)..."
echo ""

TITLE_RESPONSE=$(curl -s -X POST "${API_BASE}/api/batches/titles" \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "AI-powered marketing automation for small businesses",
    "location": "Austin, Texas, USA",
    "industry": "Marketing Technology",
    "niche": "Small Business Software",
    "numTitles": 50
  }')

TITLE_POOL_ID=$(echo "$TITLE_RESPONSE" | jq -r '.titlePoolId')
echo "✅ Title pool created: ID $TITLE_POOL_ID"
echo ""

# Wait for title generation
sleep 3

# Step 2: Submit batch
echo "🚀 Step 2: Submitting batch generation (50 articles)..."
echo ""

BATCH_RESPONSE=$(curl -s -X POST "${API_BASE}/api/batches/generate" \
  -H "Content-Type: application/json" \
  -d "{
    \"titlePoolId\": $TITLE_POOL_ID,
    \"numArticles\": 50,
    \"location\": \"Austin, Texas, USA\",
    \"tone\": \"Professional and informative\",
    \"industry\": \"Marketing Technology\"
  }")

BATCH_ID=$(echo "$BATCH_RESPONSE" | jq -r '.batchId')
echo "✅ Batch submitted: ID $BATCH_ID"
echo "   - 50 articles queued for generation"
echo "   - 100 concurrent workers will process jobs"
echo "   - 10 image workers for parallel image generation"
echo ""

echo "📊 Step 3: Monitoring batch $BATCH_ID progress..."
echo ""
echo "You can monitor progress at: ${API_BASE}/api/monitoring/batch/${BATCH_ID}"
echo ""
echo "Access the batch at: ${API_BASE}/library?batchId=${BATCH_ID}"
echo ""
echo "✅ Test initiated successfully!"
echo ""
echo "The batch is now processing. You can monitor it using:"
echo "  curl ${API_BASE}/api/monitoring/batch/${BATCH_ID} | jq"
echo ""
