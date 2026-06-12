// Lightweight in-memory fixed-window rate limiter.
// Suitable for a single long-running Node process (Replit). Not distributed —
// for multi-instance deployments back this with Redis instead.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastPrune = Date.now();

function prune(now: number) {
  // Periodically drop expired buckets so the map can't grow unbounded.
  if (now - lastPrune < 60_000) return;
  lastPrune = now;
  for (const [key, b] of buckets) {
    if (now > b.resetAt) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfter: number; // seconds until the window resets
}

/**
 * Fixed-window rate limit. Returns allowed=false once `limit` is exceeded
 * within `windowMs`. Key should uniquely identify the caller+action.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  prune(now);

  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  if (bucket.count >= limit) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }

  bucket.count++;
  return { allowed: true, retryAfter: 0 };
}

/** Extract the best-effort client IP from a request. */
export function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") || "unknown";
}
