import { createHmac } from "node:crypto";

/** The key protects IP fingerprints, not the independently random trial token. */
export function getTrialSessionRateLimitKey(
  env: { readonly SESSION_SECRET?: string; readonly JWT_SECRET?: string } = {
    SESSION_SECRET: process.env.SESSION_SECRET,
    JWT_SECRET: process.env.JWT_SECRET,
  },
): string | Buffer | null {
  // Preserve the active 24-hour per-IP counters where this key was configured.
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (!env.JWT_SECRET) return null;
  // Derive a trial-only key from the stable production key. Do not use the
  // JWT signing key directly for trial hashes or add a new global secret that
  // would take precedence in the existing TOTP decryption path.
  return createHmac("sha256", env.JWT_SECRET).update("citefi:public-trial:ip-hash:v1").digest();
}
