import { describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { requireCookieCsrf } from "../../lib/csrf.js";
import { proxy } from "../../proxy.js";

process.env.JWT_SECRET ||= "csrf-test-secret-that-is-not-used-in-production";

function csrfValue(raw = "random-client-token"): string {
  const signature = crypto.createHmac("sha256", process.env.JWT_SECRET!)
    .update(raw).digest("base64url");
  return `${raw}.${signature}`;
}

const configuredOriginVariables = [
  "APP_URL",
  "NEXT_PUBLIC_APP_URL",
  "REPLIT_DEV_DOMAIN",
  "REPLIT_DOMAINS",
] as const;

async function withConfiguredOrigins<T>(
  values: Partial<Record<(typeof configuredOriginVariables)[number], string | undefined>>,
  callback: () => T | Promise<T>,
): Promise<T> {
  const previous = Object.fromEntries(
    configuredOriginVariables.map((name) => [name, process.env[name]]),
  ) as Record<string, string | undefined>;
  try {
    for (const name of configuredOriginVariables) {
      const value = values[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    return await callback();
  } finally {
    for (const name of configuredOriginVariables) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function cookieHeaders(token: string): Record<string, string> {
  return {
    cookie: `auth_token=session; csrf_token=${token}`,
    "x-csrf-token": token,
  };
}

describe("cookie authentication CSRF", { concurrency: false }, () => {
  test("rejects a cross-origin cookie mutation", () => {
    const token = csrfValue();
    const request = new Request("https://app.example/api/auth/disable-totp", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        cookie: `auth_token=session; csrf_token=${token}`,
        "x-csrf-token": token,
      },
    });
    assert.throws(() => requireCookieCsrf(request), (error: any) => error.statusCode === 403);
  });

  test("does not trust an attacker-controlled forwarded host for origin allowlisting", () => {
    const token = csrfValue();
    const request = new Request("https://app.example/api/account/delete", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        host: "app.example",
        "x-forwarded-host": "evil.example",
        cookie: `auth_token=session; csrf_token=${token}`,
        "x-csrf-token": token,
      },
    });
    assert.throws(() => requireCookieCsrf(request), (error: any) => error.statusCode === 403);
  });

  test("accepts same-origin signed double-submit proof", () => {
    const token = csrfValue();
    const request = new Request("https://app.example/api/auth/disable-totp", {
      method: "POST",
      headers: {
        origin: "https://app.example",
        cookie: `auth_token=session; csrf_token=${token}`,
        "x-csrf-token": token,
      },
    });
    assert.doesNotThrow(() => requireCookieCsrf(request));
  });

  test("a bearer-shaped header cannot bypass cookie CSRF proof", () => {
    const request = new Request("https://app.example/api/admin/mutation", {
      method: "DELETE",
      headers: {
        authorization: "Bearer stale-or-invalid-token",
        cookie: "auth_token=valid-cookie-session",
      },
    });
    assert.throws(() => requireCookieCsrf(request), (error: any) => error.statusCode === 403);
  });

  test("rejects unsigned or mismatched tokens", () => {
    const request = new Request("https://app.example/api/account/delete", {
      method: "DELETE",
      headers: {
        origin: "https://app.example",
        cookie: "auth_token=session; csrf_token=forged.value",
        "x-csrf-token": "forged.value",
      },
    });
    assert.throws(() => requireCookieCsrf(request));
  });

  test("accepts a configured Replit preview origin without trusting forwarded authority", async () => {
    const token = csrfValue();
    await withConfiguredOrigins(
      { REPLIT_DOMAINS: "preview-one.example,preview-two.example" },
      () => {
        const request = new Request("https://app.example/api/account/delete", {
          method: "POST",
          headers: {
            origin: "https://preview-two.example",
            host: "app.example",
            "x-forwarded-host": "evil.example",
            ...cookieHeaders(token),
          },
        });
        assert.doesNotThrow(() => requireCookieCsrf(request));
      },
    );
  });

  test("proxy rejects a spoofed origin paired with a forwarded host", async () => {
    const token = csrfValue();
    await withConfiguredOrigins({}, async () => {
      const request = new NextRequest("https://app.example/api/account/delete", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          host: "app.example",
          "x-forwarded-host": "evil.example",
          ...cookieHeaders(token),
        },
      });
      const response = await proxy(request);
      assert.equal(response.status, 403);
    });
  });

  test("proxy accepts a configured Replit preview origin", async () => {
    const token = csrfValue();
    await withConfiguredOrigins(
      { REPLIT_DOMAINS: "preview-one.example,preview-two.example" },
      async () => {
        const request = new NextRequest("https://app.example/api/account/delete", {
          method: "POST",
          headers: {
            origin: "https://preview-two.example",
            host: "app.example",
            "x-forwarded-host": "evil.example",
            ...cookieHeaders(token),
          },
        });
        const response = await proxy(request);
        assert.equal(response.status, 200);
      },
    );
  });

  test("proxy leaves bearer-authenticated API mutations to the route authorization layer", async () => {
    await withConfiguredOrigins({}, async () => {
      const request = new NextRequest("https://app.example/api/account/delete", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          authorization: "Bearer route-authenticated-client",
          cookie: "auth_token=cookie-session",
        },
      });
      const response = await proxy(request);
      assert.equal(response.status, 200);
    });
  });

  test("proxy preserves the explicit reset capability path without cookie CSRF", async () => {
    await withConfiguredOrigins({}, async () => {
      const request = new NextRequest("https://app.example/api/auth/reset-password-token", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          cookie: "auth_token=cookie-session",
        },
      });
      const response = await proxy(request);
      assert.equal(response.status, 200);
    });
  });
});