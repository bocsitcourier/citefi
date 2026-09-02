import { describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { requireCookieCsrf } from "../../lib/csrf.js";

process.env.JWT_SECRET ||= "csrf-test-secret-that-is-not-used-in-production";

function csrfValue(raw = "random-client-token"): string {
  const signature = crypto.createHmac("sha256", process.env.JWT_SECRET!)
    .update(raw).digest("base64url");
  return `${raw}.${signature}`;
}

describe("cookie authentication CSRF", () => {
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

  test("does not require CSRF for bearer clients", () => {
    const request = new Request("https://app.example/api/admin/mutation", {
      method: "DELETE",
      headers: { authorization: "Bearer api-token" },
    });
    assert.doesNotThrow(() => requireCookieCsrf(request));
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
});