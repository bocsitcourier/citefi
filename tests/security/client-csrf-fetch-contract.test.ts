import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

const unsafeMethod = /\bmethod\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function fetchCall(source: string, start: number): string {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < source.length; index++) {
    const character = source[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === "(") {
      depth++;
    } else if (character === ")" && --depth === 0) {
      return source.slice(start, index + 1);
    }
  }
  return source.slice(start);
}

describe("client CSRF fetch contract", () => {
  test("does not allow raw local unsafe fetch calls in browser sources", () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("hooks")]) {
      // The ads lab is intentionally owned and migrated by a separate change.
      if (file === "app/campaigns/ads-lab.tsx") continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\bfetch\s*\(/g)) {
        const call = fetchCall(source, match.index!);
        if (/(?:["'`]\/api\/)/.test(call) && unsafeMethod.test(call)) {
          offenders.push(file);
        }
      }
    }
    assert.deepEqual(offenders, []);
  });

  test("shared browser wrapper supplies signed double-submit proof", () => {
    const source = readFileSync("lib/queryClient.ts", "utf8");
    assert.match(source, /export async function csrfFetch/);
    assert.match(source, /csrf_token=/);
    assert.match(source, /X-CSRF-Token/);
    assert.match(source, /credentials:\s*"include"/);
  });

  test("multipart bodies retain the browser-selected boundary", async () => {
    const { csrfFetch } = await import("../../lib/queryClient");
    const originalFetch = globalThis.fetch;
    let captured: Request | undefined;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = new Request(new URL(String(url), "http://localhost"), init);
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    try {
      const form = new FormData();
      form.append("file", new Blob(["media"], { type: "text/plain" }), "media.txt");
      await csrfFetch("/api/media/upload", { method: "POST", body: form });
      assert.match(captured?.headers.get("content-type") ?? "", /^multipart\/form-data; boundary=/);
      const parsed = await captured?.formData();
      assert.equal((parsed?.get("file") as File | null)?.name, "media.txt");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});