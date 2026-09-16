import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 2_000_000;

export interface SafeFetchOptions {
  /**
   * Maximum number of redirect responses to follow. Every destination is
   * resolved and checked before its connection is opened.
   */
  maxRedirects?: number;
  /** Request timeout for each hop. */
  timeoutMs?: number;
  /**
   * Whole-operation deadline covering DNS, every redirect hop, and response
   * body consumption. When omitted, timeoutMs is also used as the operation
   * deadline for backwards-compatible bounded behavior.
   */
  deadlineMs?: number;
  /** Maximum response body size in bytes. */
  maxBytes?: number;
  /** Request headers sent to the destination host. */
  headers?: Record<string, string>;
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

/** Returns true if an IPv4 address is private, special-use, or otherwise non-public. */
function isPrivateIpv4(ip: string): boolean {
  const octets = ip.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }

  const [a, b, c, d] = octets as [number, number, number, number];
  return (
    a === 0 || // "this" network
    a === 10 || // RFC 1918
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // RFC 6598 CGNAT
    (a === 169 && b === 254) || // IPv4 link-local
    (a === 172 && b >= 16 && b <= 31) || // RFC 1918
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || // TEST-NET-1
    (a === 192 && b === 31 && c === 196) || // AS112-v4
    (a === 192 && b === 52 && c === 193) || // AMT
    (a === 192 && b === 88 && c === 99) || // deprecated 6to4 anycast
    (a === 192 && b === 168) || // RFC 1918
    (a === 192 && b === 175 && c === 48) || // AS112-v4
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 || // multicast and reserved
    (a === 255 && b === 255 && c === 255 && d === 255)
  );
}

function parseIpv6(address: string): number[] | null {
  const normalized = normalizeAddress(address);
  if (normalized.includes("%")) return null; // zone identifiers are not valid URL hosts

  const halves = normalized.split("::");
  if (halves.length > 2) return null;

  const parsePart = (part: string): number[] | null => {
    if (!part) return [];
    const pieces = part.split(":");
    const groups: number[] = [];
    for (const piece of pieces) {
      if (piece.includes(".")) {
        const octets = piece.split(".").map(Number);
        if (
          octets.length !== 4 ||
          octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
        ) {
          return null;
        }
        groups.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(piece)) return null;
        groups.push(parseInt(piece, 16));
      }
    }
    return groups;
  };

  const left = parsePart(halves[0]!);
  const right = halves.length === 2 ? parsePart(halves[1]!) : [];
  if (!left || !right || (halves.length === 1 && left.length !== 8)) return null;

  if (halves.length === 2) {
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    return [...left, ...Array.from({ length: missing }, () => 0), ...right];
  }
  return left;
}

function hasPrefix(groups: number[], prefix: number[], bits: number): boolean {
  const completeGroups = Math.floor(bits / 16);
  const remainder = bits % 16;
  for (let i = 0; i < completeGroups; i++) {
    if (groups[i] !== prefix[i]) return false;
  }
  if (remainder === 0) return true;
  const mask = (0xffff << (16 - remainder)) & 0xffff;
  return (groups[completeGroups]! & mask) === (prefix[completeGroups]! & mask);
}

function isMappedIpv6(groups: number[]): boolean {
  return groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
}

function isPrivateIpv6(ip: string): boolean {
  const groups = parseIpv6(ip);
  if (!groups) return true;

  // IPv4-mapped and IPv4-compatible forms are deliberately not accepted as
  // public IPv6. Treating them as IPv6 is how mapped loopback/private literals
  // bypass a validator that only understands IPv4 text.
  if (isMappedIpv6(groups) || groups.slice(0, 6).every((group) => group === 0)) return true;

  // Only global-unicast 2000::/3 is eligible. This rejects unspecified,
  // loopback, ULA, link-local, multicast, and the other reserved ranges.
  if (groups[0]! < 0x2000 || groups[0]! > 0x3fff) return true;

  return (
    hasPrefix(groups, [0x2001, 0x0000], 32) || // Teredo
    hasPrefix(groups, [0x2001, 0x0002, 0x0000], 48) || // benchmarking
    hasPrefix(groups, [0x2001, 0x0003], 32) || // documentation/assignment
    hasPrefix(groups, [0x2001, 0x0004, 0x0112], 48) || // AS112
    hasPrefix(groups, [0x2001, 0x0db8], 32) || // documentation
    hasPrefix(groups, [0x2001, 0x0010], 28) || // ORCHID
    hasPrefix(groups, [0x2001, 0x0020], 28) || // ORCHIDv2
    hasPrefix(groups, [0x2002], 16) || // 6to4
    hasPrefix(groups, [0x3ffe], 16) // 6bone
  );
}

/**
 * Shared trusted-address predicate for every server-side URL fetch.
 *
 * A failed/unknown parse is unsafe by default. In particular, IPv4-mapped
 * IPv6 literals are never treated as ordinary public IPv6 addresses.
 */
export function isPrivateAddress(address: string): boolean {
  const normalized = normalizeAddress(address);
  const family = isIP(normalized);
  if (family === 4) return isPrivateIpv4(normalized);
  if (family === 6) return isPrivateIpv6(normalized);
  return true;
}

export function isTrustedPublicAddress(address: string): boolean {
  return !isPrivateAddress(address);
}

function isForbiddenHostname(hostname: string): boolean {
  const host = normalizeAddress(hostname);
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.com" ||
    host === "metadata.google.internal"
  );
}

/**
 * Synchronous syntax/literal validation for callers that need to reject a URL
 * before doing any network work. DNS names are checked again, and pinned, by
 * safeFetchWithRedirects immediately before each connection.
 */
export function validateExternalUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL format");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are allowed");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs with embedded credentials are not allowed");
  }

  const hostname = normalizeAddress(parsed.hostname);
  if (!hostname || isForbiddenHostname(hostname) || (isIP(hostname) !== 0 && isPrivateAddress(hostname))) {
    throw new Error("Access to internal/private addresses is not allowed");
  }
}

export interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

function abortError(): Error {
  return new Error("Safe fetch operation deadline exceeded");
}

async function awaitWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw abortError();

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<T>((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    // Promise.race attaches rejection handlers to both inputs. This is
    // important for a DNS promise that cannot be cancelled by Node after the
    // caller's operation deadline has already won the race.
    return await Promise.race([promise, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Resolve every address and only return a pin when every answer is public.
 * Rejecting mixed public/private answers prevents an attacker-controlled DNS
 * response from selecting a private alternate address.
 */
export async function resolvePinnedPublicAddress(
  url: URL,
  signal?: AbortSignal,
): Promise<PinnedAddress | null> {
  const hostname = normalizeAddress(url.hostname);
  if (isForbiddenHostname(hostname)) return null;

  const literalFamily = isIP(hostname);
  if (literalFamily) {
    return isTrustedPublicAddress(hostname)
      ? { address: hostname, family: literalFamily as 4 | 6 }
      : null;
  }

  try {
    const lookup = dns.promises.lookup(hostname, { all: true, verbatim: true });
    const addresses = await awaitWithAbort(lookup, signal);
    if (
      !addresses.length ||
      addresses.some(({ address }) => !isTrustedPublicAddress(address))
    ) {
      return null;
    }
    const selected = addresses[0]!;
    return {
      address: selected.address,
      family: selected.family as 4 | 6,
    };
  } catch {
    return null;
  }
}

function responseHeaders(headers: import("node:http").IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    result.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return result;
}

async function pinnedRequest(
  url: URL,
  options: Required<Pick<SafeFetchOptions, "timeoutMs" | "maxBytes">> &
    Pick<SafeFetchOptions, "headers"> & {
      signal: AbortSignal;
      deadlineAt: number;
    },
): Promise<Response | null> {
  const pinned = await resolvePinnedPublicAddress(url, options.signal);
  if (!pinned) return null;
  if (options.signal.aborted || options.deadlineAt <= Date.now()) return null;

  const request = url.protocol === "https:" ? https.request : http.request;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  return new Promise((resolve) => {
    let settled = false;
    let req: import("node:http").ClientRequest;
    let abortHandler: (() => void) | undefined;
    const finish = (response: Response | null) => {
      if (settled) return;
      settled = true;
      if (abortHandler) options.signal.removeEventListener("abort", abortHandler);
      resolve(response);
    };

    try {
      req = request(
        url,
        {
          headers: options.headers,
          // Honor both forms of Node's lookup callback contract. When `all`
          // is requested, returning a scalar causes public HTTPS requests to
          // fail before TLS on current Node versions.
          lookup: ((_hostname: string, lookupOptions: { all?: boolean }, callback: (
            error: Error | null,
            address: string | Array<{ address: string; family: number }>,
            family?: number,
          ) => void) => {
            if (lookupOptions?.all) {
              callback(null, [{ address: pinned.address, family: pinned.family }]);
            } else {
              callback(null, pinned.address, pinned.family);
            }
          }) as import("node:net").LookupFunction,
        },
        (res) => {
          if (settled || options.signal.aborted || options.deadlineAt <= Date.now()) {
            res.resume?.();
            finish(null);
            return;
          }

          const declaredLength = Number(res.headers["content-length"]);
          if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
            res.resume?.();
            destroyRequest(new Error("Response exceeds safe fetch limit"));
            finish(null);
            return;
          }

          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer | Uint8Array | string) => {
            if (settled) return;
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.length;
            if (size > options.maxBytes) {
              res.destroy(new Error("Response exceeds safe fetch limit"));
              destroyRequest();
              finish(null);
              return;
            }
            chunks.push(buffer);
          });
          res.on("end", () => {
            finish(new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 500,
              headers: responseHeaders(res.headers),
            }));
          });
          res.on("error", () => finish(null));
          res.on("aborted", () => finish(null));
        },
      );
    } catch {
      finish(null);
      return;
    }

    const destroyRequest = (error?: Error) => {
      try {
        req.destroy(error);
      } catch {
        // A transport that is already closed is still a settled failure.
      }
    };
    req.on("error", () => finish(null));
    abortHandler = () => {
      if (settled) return;
      destroyRequest(abortError());
      finish(null);
    };
    options.signal.addEventListener("abort", abortHandler, { once: true });
    if (options.signal.aborted || options.deadlineAt <= Date.now()) {
      abortHandler();
      return;
    }

    // Keep the caller's per-hop request timeout intact. The separate
    // operation deadline signal below is what bounds DNS + redirects +
    // response-body time, even when it expires before this timer.
    const requestTimeoutMs = options.timeoutMs;
    try {
      req.setTimeout(requestTimeoutMs, () => {
        destroyRequest(new Error("Safe fetch timed out"));
      });
      req.end();
    } catch {
      destroyRequest();
      finish(null);
    }
  });
}

/**
 * Fetch an external URL through a DNS-pinned connection, following redirects
 * manually so every hop gets the same validation and pinning treatment.
 */
export async function safeFetchWithRedirects(
  url: string,
  options: SafeFetchOptions = {},
): Promise<Response | null> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadlineMs = options.deadlineMs ?? timeoutMs;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const headers = options.headers ?? {
    "User-Agent": "CitefiBot/1.0",
    Accept: "*/*",
  };

  if (
    !Number.isInteger(maxRedirects) ||
    maxRedirects < 0 ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isFinite(deadlineMs) ||
    deadlineMs <= 0 ||
    !Number.isFinite(maxBytes) ||
    maxBytes <= 0
  ) {
    return null;
  }

  const deadlineAt = Date.now() + deadlineMs;
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(() => deadlineController.abort(), deadlineMs);
  let current = url;
  let previousProtocol: string | null = null;
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      if (deadlineController.signal.aborted || deadlineAt <= Date.now()) return null;
      let parsed: URL;
      try {
        parsed = new URL(current);
        validateExternalUrl(current);
      } catch {
        return null;
      }

      // Never allow a redirect to silently downgrade an HTTPS fetch.
      if (previousProtocol === "https:" && parsed.protocol === "http:") return null;

      const response = await pinnedRequest(parsed, {
        timeoutMs,
        maxBytes,
        headers,
        signal: deadlineController.signal,
        deadlineAt,
      });
      if (!response) return null;

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return null;
        try {
          const next = new URL(location, current);
          previousProtocol = parsed.protocol;
          current = next.href;
        } catch {
          return null;
        }
        continue;
      }
      return response;
    }
    return null;
  } finally {
    clearTimeout(deadlineTimer);
  }
}

/**
 * Compatibility wrapper used by the brand-intelligence, campaign, and social
 * workers. Keep this export in the central helper and re-export it from the
 * brand service for existing imports.
 */
export async function safeFetchPageWithRedirects(
  url: string,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
): Promise<Response | null> {
  return safeFetchWithRedirects(url, {
    maxRedirects,
    maxBytes: DEFAULT_MAX_BYTES,
    headers: {
      "User-Agent": "CitefiBot/1.0 (Brand Intelligence Analyzer)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
}