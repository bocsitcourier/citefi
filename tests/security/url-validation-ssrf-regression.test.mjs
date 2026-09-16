import assert from "node:assert/strict";
import test from "node:test";
import { validateExternalUrl } from "../../lib/url-validation.ts";

test("SSRF validation rejects IPv4-mapped loopback addresses", () => {
  // This address is loopback through an IPv4-mapped IPv6 literal. It must be
  // denied before any caller passes the URL to fetch().
  assert.throws(
    () => validateExternalUrl("http://[::ffff:127.0.0.1]/"),
    /internal|private|not allowed/i,
  );
});