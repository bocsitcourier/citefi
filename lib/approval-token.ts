/**
 * Signed approval token utility for email-based account approve/reject flows.
 *
 * Tokens are HMAC-SHA256 signed and base64url encoded.
 * Format: base64url(JSON payload) + "." + base64url(HMAC signature)
 *
 * Tokens expire after APPROVAL_TOKEN_TTL_MS (default 7 days).
 *
 * Key rotation support
 * --------------------
 * Each token payload includes a `kid` (key ID) field — an 8-hex-char prefix of
 * SHA-256(secret) — that selects the correct signing key at verification time.
 *
 * To rotate the signing secret without breaking in-flight links:
 *   1. Set APPROVAL_TOKEN_SECRET_PREV to the old secret value.
 *   2. Set APPROVAL_TOKEN_SECRET to the new secret value.
 *   3. New tokens are signed with the new key. Existing tokens (signed with the
 *      old key) continue to verify against APPROVAL_TOKEN_SECRET_PREV.
 *   4. After the token TTL (7 days), retire APPROVAL_TOKEN_SECRET_PREV — all
 *      links issued under the old key will have naturally expired by then.
 *
 * Environment variables
 * ---------------------
 * APPROVAL_TOKEN_SECRET      — primary signing secret (REQUIRED in production)
 * APPROVAL_TOKEN_SECRET_PREV — previous signing secret (optional, for rotation)
 * NEXTAUTH_SECRET            — fallback used only in development / test
 * JWT_SECRET                 — second fallback used only in development / test
 *
 * Production enforcement
 * ----------------------
 * In production (NODE_ENV === "production") the fallback chain is disabled.
 * If APPROVAL_TOKEN_SECRET is unset the process throws at the first token
 * operation, and validateApprovalTokenSecret() throws immediately so you can
 * catch the misconfiguration at startup rather than when the first email goes
 * out.
 */

import { createHmac, createHash } from "crypto";

const APPROVAL_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type ApprovalAction = "approve" | "reject";

interface TokenPayload {
  userId: number;
  action: ApprovalAction;
  exp: number; // Unix timestamp ms
  kid?: string; // Key ID — 8-hex-char SHA-256 prefix of the signing secret
}

// ── Key management ─────────────────────────────────────────────────────────────

/**
 * Derive a stable 8-character key ID from a secret.
 * Uses the first 8 hex chars of SHA-256(secret) — deterministic, no extra config.
 */
function deriveKid(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 8);
}

/**
 * Return all available {kid, secret} pairs in priority order:
 *   [0] current signing key
 *   [1] previous signing key (if APPROVAL_TOKEN_SECRET_PREV is set)
 *
 * New tokens are always signed with entry [0].
 * Verification tries the matching kid first; legacy tokens (no kid) try all keys.
 */
function getKeyring(): Array<{ kid: string; secret: string }> {
  const isProd = process.env.NODE_ENV === "production";

  if (isProd) {
    // In production the fallback chain is disabled.  APPROVAL_TOKEN_SECRET
    // must be set explicitly so a missing env var is always a hard error —
    // never a silent switch to a different key.
    const current = process.env.APPROVAL_TOKEN_SECRET;
    if (!current) {
      throw new Error(
        "[approval-token] APPROVAL_TOKEN_SECRET is required in production. " +
        "Set this environment variable before starting the server. " +
        "Falling back to NEXTAUTH_SECRET or JWT_SECRET is not permitted in production."
      );
    }
    const keyring: Array<{ kid: string; secret: string }> = [
      { kid: deriveKid(current), secret: current },
    ];
    const prev = process.env.APPROVAL_TOKEN_SECRET_PREV;
    if (prev && prev !== current) {
      keyring.push({ kid: deriveKid(prev), secret: prev });
    }
    return keyring;
  }

  // Development / test: allow fallbacks so local environments work without
  // the full production secret set.
  const current =
    process.env.APPROVAL_TOKEN_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.JWT_SECRET;
  if (!current) {
    throw new Error(
      "[approval-token] No signing secret found. " +
      "Set APPROVAL_TOKEN_SECRET (required in production), NEXTAUTH_SECRET, or JWT_SECRET."
    );
  }
  const keyring: Array<{ kid: string; secret: string }> = [
    { kid: deriveKid(current), secret: current },
  ];
  const prev = process.env.APPROVAL_TOKEN_SECRET_PREV;
  if (prev && prev !== current) {
    keyring.push({ kid: deriveKid(prev), secret: prev });
  }
  return keyring;
}

// ── Startup validation ──────────────────────────────────────────────────────

/**
 * Call once at server/worker startup (before any tokens are issued or verified)
 * to assert that the signing secret is correctly configured.
 *
 * In production this throws immediately if APPROVAL_TOKEN_SECRET is unset,
 * surfacing the misconfiguration before the first admin email goes out rather
 * than when an approval link is clicked.
 *
 * In development/test the check mirrors getKeyring(): any of the three env
 * vars is acceptable.
 *
 * @throws {Error} when the required secret is missing.
 */
export function validateApprovalTokenSecret(): void {
  // Delegate to getKeyring() so the enforcement logic stays in one place.
  // This also validates APPROVAL_TOKEN_SECRET_PREV if it is set (no throw,
  // but the call ensures the primary key is resolvable).
  getKeyring();
}

// ── Encoding helpers ───────────────────────────────────────────────────────────

function b64urlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function b64urlDecode(str: string): string {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/**
 * Speculatively parse the payload to extract the `kid` before we know which
 * key to use.  Callers must not trust the result until the signature is verified.
 */
function speculativeParsePayload(encodedPayload: string): Partial<TokenPayload> | null {
  try {
    return JSON.parse(b64urlDecode(encodedPayload));
  } catch {
    return null;
  }
}

/**
 * Verify the HMAC signature using the key-ring.
 *
 * - If the payload has a `kid`, only the matching key is tried.  A kid with
 *   no matching key means the token was issued by a retired secret → "unknown
 *   key ID" error (maps to 400 "Invalid" on the route).
 * - If the payload has no `kid` (legacy token, pre-rotation), every key in the
 *   ring is tried in order; the first match wins (constant-time per candidate).
 *
 * Throws on any signature mismatch or unrecognised kid.
 */
function verifyWithKeyring(
  encodedPayload: string,
  receivedSig: string,
  kid?: string,
): void {
  const keyring = getKeyring();

  if (kid !== undefined) {
    const entry = keyring.find((k) => k.kid === kid);
    if (!entry) {
      throw new Error(
        "Unknown key ID — token was issued with a rotated-out or unknown signing key"
      );
    }
    const expectedSig = sign(encodedPayload, entry.secret);
    if (
      receivedSig.length !== expectedSig.length ||
      !Buffer.from(receivedSig).equals(Buffer.from(expectedSig))
    ) {
      throw new Error("Invalid token signature");
    }
    return;
  }

  // Legacy token (no kid) — try all keyring entries; fail if none match.
  for (const { secret } of keyring) {
    const expectedSig = sign(encodedPayload, secret);
    if (
      receivedSig.length === expectedSig.length &&
      Buffer.from(receivedSig).equals(Buffer.from(expectedSig))
    ) {
      return; // signature verified
    }
  }
  throw new Error("Invalid token signature");
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Generate a signed token for approving or rejecting a user account.
 * Always signed with the current (first) key in the keyring.
 */
export function generateApprovalToken(userId: number, action: ApprovalAction): string {
  const currentKey = getKeyring()[0];
  if (!currentKey) throw new Error("No approval token signing key is configured");
  const { kid, secret } = currentKey;
  const payload: TokenPayload = {
    userId,
    action,
    exp: Date.now() + APPROVAL_TOKEN_TTL_MS,
    kid,
  };
  const encodedPayload = b64urlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

/**
 * Decode a signed approval token without enforcing the expiry check.
 * Useful for extracting payload data (e.g. userId) from an expired token
 * so that we can still look up the user and surface their email on the
 * expiry warning page.
 *
 * Throws if the token is structurally invalid or the signature does not match
 * any key in the current keyring.  Does NOT throw on expiry.
 */
export function decodeApprovalTokenIgnoreExpiry(token: string): TokenPayload {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new Error("Malformed token");
  }
  const encodedPayload = parts[0]!;
  const receivedSig = parts[1]!;

  // Speculatively parse to get the kid before verifying
  const speculative = speculativeParsePayload(encodedPayload);
  verifyWithKeyring(encodedPayload, receivedSig, speculative?.kid);

  let payload: TokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(encodedPayload));
  } catch {
    throw new Error("Invalid token payload");
  }

  if (!payload.userId || !payload.action || !payload.exp) {
    throw new Error("Incomplete token payload");
  }

  return payload;
}

/**
 * Verify and decode a signed approval token.
 * Throws if the token is invalid, tampered, signed by an unknown key, or expired.
 */
export function verifyApprovalToken(token: string): TokenPayload {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new Error("Malformed token");
  }
  const encodedPayload = parts[0]!;
  const receivedSig = parts[1]!;

  // Speculatively parse to get the kid before verifying
  const speculative = speculativeParsePayload(encodedPayload);
  verifyWithKeyring(encodedPayload, receivedSig, speculative?.kid);

  let payload: TokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(encodedPayload));
  } catch {
    throw new Error("Invalid token payload");
  }

  if (!payload.userId || !payload.action || !payload.exp) {
    throw new Error("Incomplete token payload");
  }

  if (Date.now() > payload.exp) {
    throw new Error("Token has expired");
  }

  return payload;
}

/**
 * Build the full approve/reject URLs to embed in admin notification emails.
 */
export function buildApprovalUrls(
  userId: number,
  baseUrl: string
): { approveUrl: string; rejectUrl: string } {
  const approveToken = generateApprovalToken(userId, "approve");
  const rejectToken = generateApprovalToken(userId, "reject");
  return {
    approveUrl: `${baseUrl}/api/admin/users/review?token=${encodeURIComponent(approveToken)}`,
    rejectUrl: `${baseUrl}/api/admin/users/review?token=${encodeURIComponent(rejectToken)}`,
  };
}

/**
 * Derive the app base URL from environment variables or a fallback.
 */
export function getBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000"
  );
}
