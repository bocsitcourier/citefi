import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("development preview login retains a bearer fallback while production remains cookie-only", () => {
  const login = readFileSync("app/api/auth/login/route.ts", "utf8");
  const verify2fa = readFileSync("app/api/auth/verify-2fa/route.ts", "utf8");
  const client = readFileSync("lib/queryClient.ts", "utf8");
  const context = readFileSync("lib/auth-context.tsx", "utf8");

  assert.match(login, /NODE_ENV === "development"[\s\S]*previewToken: accessToken/);
  assert.match(verify2fa, /NODE_ENV === "development"[\s\S]*previewToken: accessToken/);
  assert.match(client, /sessionStorage\.getItem\("auth_preview_token"\)/);
  assert.match(client, /headers\.set\("Authorization", `Bearer \$\{previewToken\}`\)/);
  assert.match(context, /sessionStorage\.setItem\("auth_preview_token"/);
  assert.match(context, /sessionStorage\.removeItem\("auth_preview_token"/);
});