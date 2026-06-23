/**
 * Signed approval token utility for email-based account approve/reject flows.
 *
 * Tokens are HMAC-SHA256 signed and base64url encoded.
 * Format: base64url(JSON payload) + "." + base64url(HMAC signature)
 *
 * Tokens expire after APPROVAL_TOKEN_TTL_MS (default 7 days).
 */

import { createHmac } from "crypto";

const APPROVAL_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type ApprovalAction = "approve" | "reject";

interface TokenPayload {
  userId: number;
  action: ApprovalAction;
  exp: number; // Unix timestamp ms
}

function getSecret(): string {
  const secret =
    process.env.APPROVAL_TOKEN_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "No signing secret found. Set APPROVAL_TOKEN_SECRET, NEXTAUTH_SECRET, or JWT_SECRET."
    );
  }
  return secret;
}

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
 * Generate a signed token for approving or rejecting a user account.
 */
export function generateApprovalToken(userId: number, action: ApprovalAction): string {
  const payload: TokenPayload = {
    userId,
    action,
    exp: Date.now() + APPROVAL_TOKEN_TTL_MS,
  };
  const encodedPayload = b64urlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload, getSecret());
  return `${encodedPayload}.${signature}`;
}

/**
 * Decode a signed approval token without enforcing the expiry check.
 * Useful for extracting payload data (e.g. userId) from an expired token
 * so that we can still look up the user and surface their email on the
 * expiry warning page.
 *
 * Throws if the token is structurally invalid or the signature does not match.
 * Does NOT throw on expiry.
 */
export function decodeApprovalTokenIgnoreExpiry(token: string): TokenPayload {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new Error("Malformed token");
  }
  const [encodedPayload, receivedSig] = parts;
  const expectedSig = sign(encodedPayload, getSecret());

  if (
    receivedSig.length !== expectedSig.length ||
    !Buffer.from(receivedSig).equals(Buffer.from(expectedSig))
  ) {
    throw new Error("Invalid token signature");
  }

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
 * Throws if the token is invalid, tampered, or expired.
 */
export function verifyApprovalToken(token: string): TokenPayload {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new Error("Malformed token");
  }
  const [encodedPayload, receivedSig] = parts;
  const expectedSig = sign(encodedPayload, getSecret());

  // Constant-time comparison to prevent timing attacks
  if (
    receivedSig.length !== expectedSig.length ||
    !Buffer.from(receivedSig).equals(Buffer.from(expectedSig))
  ) {
    throw new Error("Invalid token signature");
  }

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
