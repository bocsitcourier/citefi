// Safe module-initialization values for offline QA. These are deliberately
// non-routable/local-only fixtures; tests must mock provider, queue, and DB
// boundaries before invoking any code that could use them.
const fixtures = {
  DATABASE_URL: "postgresql://127.0.0.1:1/citefi_qa",
  DATABASE_POOLED_URL: "postgresql://127.0.0.1:1/citefi_qa",
  GEMINI_API_KEY: "qa-offline-gemini-fixture",
  OPENAI_API_KEY: "qa-offline-openai-fixture",
  REDIS_URL: "redis://127.0.0.1:1/0",
};

for (const [key, value] of Object.entries(fixtures)) {
  process.env[key] = value;
}