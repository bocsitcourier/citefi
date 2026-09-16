import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { afterEach, describe, test } from "node:test";
import {
  isPrivateAddress,
  isTrustedPublicAddress,
  resolvePinnedPublicAddress,
  safeFetchWithRedirects,
  validateExternalUrl,
} from "../../lib/url-validation";
import type { LookupAddress, LookupAllOptions } from "node:dns";

type Address = { address: string; family: 4 | 6 };
type RequestRecord = {
  url: string;
  timeoutMs?: number;
  timeoutCallback?: () => void;
  destroyed: boolean;
  lookupCalls: Array<{ all?: boolean; address?: string | Array<{ address: string; family: number }>; family?: number }>;
};

const originalLookup = dns.promises.lookup;
const originalHttpRequest = http.request;
const originalHttpsRequest = https.request;
let dnsAnswers = new Map<string, Address[]>();
let dnsCalls: Array<{ hostname: string; options: { all?: boolean; verbatim?: boolean } }> = [];
let requests: RequestRecord[] = [];
let responseFactory: ((request: RequestRecord, callback: (response: EventEmitter) => void) => void) | null = null;

function response(
  statusCode: number,
  headers: Record<string, string> = {},
  chunks: Array<Buffer | string> = [],
): EventEmitter & { headers: Record<string, string>; statusCode: number; destroy: () => void; resume: () => void } {
  const result = new EventEmitter() as EventEmitter & {
    headers: Record<string, string>;
    statusCode: number;
    destroy: () => void;
    resume: () => void;
  };
  result.statusCode = statusCode;
  result.headers = headers;
  result.destroy = () => {};
  result.resume = () => {};
  queueMicrotask(() => {
    for (const chunk of chunks) result.emit("data", Buffer.from(chunk));
    result.emit("end");
  });
  return result;
}

function installTransport(
  factory: (request: RequestRecord, callback: (incoming: EventEmitter) => void) => void,
): void {
  dnsAnswers = new Map();
  dnsCalls = [];
  requests = [];
  responseFactory = factory;

  dns.promises.lookup = (async (hostname: string, options: { all?: boolean; verbatim?: boolean }) => {
    dnsCalls.push({ hostname, options });
    const answer = dnsAnswers.get(hostname);
    if (!answer) throw new Error("DNS fixture missing");
    return answer;
  }) as typeof dns.promises.lookup;

  const request = ((url: URL | string, options: { lookup?: Function }, callback: (incoming: EventEmitter) => void) => {
    const record: RequestRecord = {
      url: String(url),
      destroyed: false,
      lookupCalls: [],
    };
    requests.push(record);
    const requestEmitter = new EventEmitter() as EventEmitter & {
      setTimeout: (milliseconds: number, callback: () => void) => void;
      destroy: (error?: Error) => void;
      end: () => void;
    };
    requestEmitter.setTimeout = (milliseconds, timeoutCallback) => {
      record.timeoutMs = milliseconds;
      record.timeoutCallback = timeoutCallback;
    };
    requestEmitter.destroy = (error) => {
      record.destroyed = true;
      if (error) queueMicrotask(() => requestEmitter.emit("error", error));
    };
    requestEmitter.end = () => {
      if (options.lookup) {
        options.lookup(
          new URL(String(url)).hostname,
          { all: true },
          (error: Error | null, address: string | Array<{ address: string; family: number }>, family?: number) => {
            if (error) throw error;
            record.lookupCalls.push({ all: true, address, family });
          },
        );
      }
      responseFactory?.(record, callback);
    };
    return requestEmitter;
  }) as typeof http.request;

  http.request = request;
  https.request = request as typeof https.request;
}

afterEach(() => {
  dns.promises.lookup = originalLookup;
  http.request = originalHttpRequest;
  https.request = originalHttpsRequest;
  dnsAnswers = new Map();
  dnsCalls = [];
  requests = [];
  responseFactory = null;
});

describe("independent URL validation and pinned transport", { concurrency: false }, () => {
  test("normalizes and rejects mapped, compatible, private, and reserved address classes", () => {
    const blocked = [
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "::ffff:169.254.169.254",
      "::ffff:192.168.1.1",
      "::ffff:100.64.0.1",
      "::ffff:224.0.0.1",
      "::127.0.0.1",
      "::1",
      "fd00::1",
      "192.0.2.1",
      "198.51.100.1",
      "203.0.113.1",
    ];

    for (const address of blocked) {
      assert.equal(isPrivateAddress(address), true, `expected ${address} to be private`);
      assert.equal(isTrustedPublicAddress(address), false, `expected ${address} not to be trusted`);
    }

    assert.equal(isTrustedPublicAddress("93.184.216.34"), true);
    assert.equal(isTrustedPublicAddress("2001:4860:4860::8888"), true);
    assert.doesNotThrow(() => validateExternalUrl("http://93.184.216.34/"));
    assert.doesNotThrow(() => validateExternalUrl("https://[2001:4860:4860::8888]/"));
    assert.throws(() => validateExternalUrl("http://[::ffff:127.0.0.1]/"), /internal|private/i);
  });

  test("requires every DNS answer to be public and requests all addresses", async () => {
    installTransport(() => {});
    dnsAnswers.set("mixed.example", [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.7", family: 4 },
    ]);
    dnsAnswers.set("public.example", [
      { address: "93.184.216.34", family: 4 },
      { address: "2001:4860:4860::8888", family: 6 },
    ]);

    assert.equal(await resolvePinnedPublicAddress(new URL("https://mixed.example/")), null);
    const pinned = await resolvePinnedPublicAddress(new URL("https://public.example/"));
    assert.deepEqual(pinned, { address: "93.184.216.34", family: 4 });
    assert.deepEqual(dnsCalls, [
      { hostname: "mixed.example", options: { all: true, verbatim: true } },
      { hostname: "public.example", options: { all: true, verbatim: true } },
    ]);
    assert.equal(requests.length, 0, "DNS-only resolution must not open transport");
  });

  test("permits a public host and pins the all-address lookup before transport", async () => {
    installTransport((_request, callback) => {
      callback(response(200, { "content-type": "text/plain" }, ["public fixture"]));
    });
    dnsAnswers.set("public.example", [{ address: "93.184.216.34", family: 4 }]);

    const result = await safeFetchWithRedirects("https://public.example/resource", {
      maxRedirects: 0,
      timeoutMs: 1234,
      maxBytes: 128,
    });

    assert.equal(result?.status, 200);
    assert.equal(await result?.text(), "public fixture");
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.timeoutMs, 1234);
    assert.deepEqual(requests[0]?.lookupCalls, [
      { all: true, address: [{ address: "93.184.216.34", family: 4 }], family: undefined },
    ]);
  });

  test("blocks a private DNS answer before opening transport", async () => {
    installTransport(() => {});
    dnsAnswers.set("private.example", [{ address: "192.168.1.9", family: 4 }]);

    const result = await safeFetchWithRedirects("https://private.example/resource", {
      timeoutMs: 100,
      maxBytes: 128,
    });

    assert.equal(result, null);
    assert.equal(requests.length, 0);
  });

  test("blocks a private redirect before a second transport connection", async () => {
    installTransport((_request, callback) => {
      callback(response(302, { location: "http://127.0.0.1/private" }));
    });
    dnsAnswers.set("public.example", [{ address: "93.184.216.34", family: 4 }]);

    const result = await safeFetchWithRedirects("https://public.example/start", {
      maxRedirects: 2,
      timeoutMs: 100,
      maxBytes: 128,
    });

    assert.equal(result, null);
    assert.equal(requests.length, 1, "private redirect must be rejected before transport");
  });

  test("repins and rejects a DNS-rebound redirect before a second connection", async () => {
    installTransport((_request, callback) => {
      callback(response(302, { location: "https://rebound.example/private" }));
    });
    dnsAnswers.set("public.example", [{ address: "93.184.216.34", family: 4 }]);
    dnsAnswers.set("rebound.example", [{ address: "10.0.0.8", family: 4 }]);

    const result = await safeFetchWithRedirects("https://public.example/start", {
      maxRedirects: 2,
      timeoutMs: 100,
      maxBytes: 128,
    });

    assert.equal(result, null);
    assert.equal(requests.length, 1);
    assert.deepEqual(dnsCalls.map(({ hostname }) => hostname), ["public.example", "rebound.example"]);
  });

  test("rejects HTTPS-to-HTTP downgrade before resolving or connecting the next hop", async () => {
    installTransport((_request, callback) => {
      callback(response(302, { location: "http://public.example/insecure" }));
    });
    dnsAnswers.set("public.example", [{ address: "93.184.216.34", family: 4 }]);

    const result = await safeFetchWithRedirects("https://public.example/start", {
      maxRedirects: 2,
      timeoutMs: 100,
      maxBytes: 128,
    });

    assert.equal(result, null);
    assert.equal(requests.length, 1);
    assert.deepEqual(dnsCalls.map(({ hostname }) => hostname), ["public.example"]);
  });

  test("follows a public redirect only after repinning its destination", async () => {
    let connection = 0;
    installTransport((_request, callback) => {
      connection++;
      callback(connection === 1
        ? response(302, { location: "https://public-two.example/next" })
        : response(200, { "content-type": "text/plain" }, ["redirected fixture"]));
    });
    dnsAnswers.set("public.example", [{ address: "93.184.216.34", family: 4 }]);
    dnsAnswers.set("public-two.example", [{ address: "93.184.216.35", family: 4 }]);

    const result = await safeFetchWithRedirects("https://public.example/start", {
      maxRedirects: 2,
      timeoutMs: 100,
      maxBytes: 128,
    });

    assert.equal(result?.status, 200);
    assert.equal(await result?.text(), "redirected fixture");
    assert.equal(requests.length, 2);
    assert.deepEqual(dnsCalls.map(({ hostname }) => hostname), ["public.example", "public-two.example"]);
  });

  test("enforces response byte limits before returning a response", async () => {
    installTransport((_request, callback) => {
      callback(response(200, {}, ["123456789"]));
    });
    dnsAnswers.set("public.example", [{ address: "93.184.216.34", family: 4 }]);

    const result = await safeFetchWithRedirects("https://public.example/large", {
      timeoutMs: 100,
      maxBytes: 8,
    });

    assert.equal(result, null);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.destroyed, true);
  });

  test("rejects a declared content length above the bound before reading the body", async () => {
    installTransport((_request, callback) => {
      callback(response(200, { "content-length": "9" }));
    });
    dnsAnswers.set("public.example", [{ address: "93.184.216.34", family: 4 }]);

    const result = await safeFetchWithRedirects("https://public.example/declared-large", {
      timeoutMs: 100,
      maxBytes: 8,
    });

    assert.equal(result, null);
    assert.equal(requests.length, 1);
  });

  test("enforces per-hop timeout before returning a response", async () => {
    installTransport((request) => {
      queueMicrotask(() => {
        request.timeoutCallback?.();
      });
    });
    dnsAnswers.set("public.example", [{ address: "93.184.216.34", family: 4 }]);

    const result = await safeFetchWithRedirects("https://public.example/slow", {
      timeoutMs: 77,
      maxBytes: 128,
    });

    assert.equal(result, null);
    assert.equal(requests[0]?.timeoutMs, 77);
    assert.equal(requests[0]?.destroyed, true);
  });

  test("bounds a hanging DNS lookup with the whole-operation deadline", async () => {
    installTransport(() => {});
    let releaseLookup!: (addresses: Address[]) => void;
    const hangingLookup = async (
      _hostname: string,
      _options: LookupAllOptions,
    ): Promise<LookupAddress[]> => new Promise<LookupAddress[]>((resolve) => {
      releaseLookup = resolve;
    });
    // This test replaces only the lookup-all overload used by
    // resolvePinnedPublicAddress (`{ all: true, verbatim: true }`). The
    // overload set on dns.promises.lookup cannot express that narrow property
    // assignment directly, so this explicit cast preserves the exact seam.
    dns.promises.lookup = hangingLookup as unknown as typeof dns.promises.lookup;

    const fetchPromise = safeFetchWithRedirects("https://slow-dns.example/resource", {
      timeoutMs: 5,
      maxBytes: 128,
    });
    const outcome = await Promise.race([
      fetchPromise.then((result) => result),
      new Promise<"test-timeout">((resolve) => setTimeout(() => resolve("test-timeout"), 100)),
    ]);

    assert.equal(outcome, null, "the whole-operation deadline must include DNS resolution");
    assert.equal(requests.length, 0, "expired DNS must not start a transport request");
    releaseLookup([]);
    assert.equal(await fetchPromise, null, "the timed-out operation resolves cleanly");
  });

  test("all three URL-fetching sinks use the bounded pinned helper", () => {
    const sources = {
      media: readFileSync("app/api/media/from-url/route.ts", "utf8"),
      crawler: readFileSync("lib/site-crawler.ts", "utf8"),
      video: readFileSync("lib/video-style-analyzer.ts", "utf8"),
    };

    assert.match(sources.media, /safeFetchWithRedirects\(url,[\s\S]*?timeoutMs:\s*30_000,[\s\S]*?maxBytes:\s*MAX_FILE_SIZE/);
    assert.match(sources.crawler, /safeFetchWithRedirects\(url,[\s\S]*?timeoutMs:\s*MAX_FETCH_TIMEOUT,[\s\S]*?maxBytes:\s*MAX_CONTENT_LENGTH/);
    assert.match(sources.video, /safeFetchWithRedirects\(url,[\s\S]*?timeoutMs:\s*120_000,[\s\S]*?maxBytes:\s*100\s*\*\s*1024\s*\*\s*1024/);
    assert.match(sources.video, /safeFetchWithRedirects\(imageUrl,[\s\S]*?timeoutMs:\s*15_000,[\s\S]*?maxBytes:\s*10\s*\*\s*1024\s*\*\s*1024/);
    assert.match(sources.video, /safeFetchWithRedirects\(oembedUrl,[\s\S]*?timeoutMs:\s*15_000,[\s\S]*?maxBytes:\s*1\s*\*\s*1024\s*\*\s*1024/);
    for (const source of Object.values(sources)) {
      assert.doesNotMatch(source, /(?<!safe)fetch\s*\(/, "sink should not retain a direct fetch call");
    }
  });
});