// Shared contracts for offline QA and the owned HTTP test fixture.
//
// The provider values are deliberately unusable sentinels.  An isolated
// database harness is different: it owns a real, disposable PostgreSQL
// listener, so its connection variables must survive this preload.  Keeping
// that distinction here prevents an offline preload from silently redirecting
// an HTTP suite to a dead database.
const fixtures = {
  DATABASE_URL: "postgresql://127.0.0.1:1/citefi_qa",
  DATABASE_POOLED_URL: "postgresql://127.0.0.1:1/citefi_qa",
  NEON_DATABASE_URL: "postgresql://127.0.0.1:1/citefi_qa",
  GEMINI_API_KEY: "qa-offline-gemini-fixture",
  OPENAI_API_KEY: "qa-offline-openai-fixture",
  REDIS_URL: "redis://127.0.0.1:1/0",
};

const ownedDatabase = process.env.QA_ISOLATED_DATABASE === "true";
const ownedConnectionVariables = new Set([
  "DATABASE_URL",
  "DATABASE_POOLED_URL",
  "NEON_DATABASE_URL",
  "REDIS_URL",
]);

for (const [key, value] of Object.entries(fixtures)) {
  if (ownedDatabase && ownedConnectionVariables.has(key)) {
    // Preserve every harness-owned connection variable.  A missing Redis
    // variable still receives a dead sentinel so queue initialization cannot
    // fall back to a developer's Redis on 127.0.0.1:6379.
    if (key !== "REDIS_URL" || key in process.env) continue;
  }
  process.env[key] = value;
}

const LOCAL_FIXTURE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const HTTP_FIXTURE_ENV = "QA_HTTP_FIXTURE_URL";
export const OWNED_HTTP_FIXTURE_PORT = 15481;

/**
 * Return the base URL for an HTTP suite's explicitly owned fixture.
 *
 * TEST_BASE_URL is accepted as a compatibility alias, but there is
 * intentionally no localhost:5000 default.  The regular application port is
 * workflow-owned, not test-owned, and using it makes a failed fixture look
 * like a real assertion failure against somebody else's database.
 */
export function requireHttpFixture(suiteName = "HTTP QA suite") {
  const configured =
    process.env[HTTP_FIXTURE_ENV]?.trim() ||
    process.env.TEST_BASE_URL?.trim();
  const missingMessage =
    `${suiteName}: QA HTTP fixture is required. ` +
    `Start an owned fixture and set ${HTTP_FIXTURE_ENV}=http://127.0.0.1:<port> ` +
    "(TEST_BASE_URL is a compatibility alias); refusing implicit http://localhost:5000.";

  if (!configured) {
    throw new Error(missingMessage);
  }

  let parsed;
  try {
    parsed = new URL(configured);
  } catch (error) {
    throw new Error(
      `${suiteName}: invalid QA HTTP fixture URL ${JSON.stringify(configured)}; ` +
        "expected an explicit local http://127.0.0.1:<port> URL.",
      { cause: error },
    );
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const isDefaultApplicationPort =
    (parsed.protocol === "http:" && (parsed.port || "80") === "5000") ||
    (parsed.protocol === "https:" && (parsed.port || "443") === "5000");

  if (isDefaultApplicationPort) {
    throw new Error(
      `${suiteName}: ${configured} is the workflow application endpoint, not an ` +
        "owned QA HTTP fixture; refusing localhost:5000.",
    );
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(
      `${suiteName}: QA HTTP fixture must use http or https, got ${parsed.protocol}`,
    );
  }
  if (!LOCAL_FIXTURE_HOSTS.has(host)) {
    throw new Error(
      `${suiteName}: QA HTTP fixture must be local and owned; got host ${parsed.hostname}`,
    );
  }
  if (!parsed.port) {
    throw new Error(
      `${suiteName}: QA HTTP fixture must include its explicit owned port`,
    );
  }
  if (Number(parsed.port) !== OWNED_HTTP_FIXTURE_PORT) {
    throw new Error(
      `${suiteName}: owned QA HTTP fixture must use port ${OWNED_HTTP_FIXTURE_PORT}; ` +
        `got ${parsed.port}`,
    );
  }
  if (process.env.QA_ISOLATED_DATABASE !== "true") {
    throw new Error(
      `${suiteName}: owned HTTP fixtures require QA_ISOLATED_DATABASE=true; ` +
        "refusing to run against a shared database.",
    );
  }
  if (parsed.username || parsed.password) {
    throw new Error(
      `${suiteName}: QA HTTP fixture URL must not contain credentials`,
    );
  }
  if (parsed.search || parsed.hash) {
    throw new Error(
      `${suiteName}: QA HTTP fixture URL must not contain a query or fragment`,
    );
  }

  const baseUrl = parsed.toString().replace(/\/$/, "");
  return Object.freeze({
    baseUrl,
    origin: parsed.origin,
    hostname: host,
    port: Number(parsed.port),
  });
}

export const SYNTHETIC_ACCOUNT_PASSWORD = "Test!Pass#123";

/**
 * Build a deterministic, non-deliverable account address for a QA run.
 * Synthetic accounts must stay on test.invalid so a test cannot email a real
 * person even if an email transport is accidentally enabled.
 */
export function syntheticAccountEmail(runId, role) {
  const safeRunId = String(runId).replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeRole = String(role).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `qa_${safeRunId}_${safeRole}@test.invalid`;
}

export function isSyntheticAccountEmail(email) {
  return typeof email === "string" && /^[^@\s]+@test\.invalid$/i.test(email);
}