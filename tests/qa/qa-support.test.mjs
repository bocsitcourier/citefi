import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createServer } from "node:http";
import {
  isSyntheticAccountEmail,
  requireHttpFixture,
  syntheticAccountEmail,
} from "../../QA/support/qa-fixtures.mjs";
import {
  isAllowedSocketTarget,
  parseAllowedPorts,
} from "../../QA/support/offline-guard.mjs";

function withEnvironment(values, callback) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("QA fixture contract", { concurrency: 1 }, () => {
  test("missing HTTP fixture fails clearly instead of using localhost:5000", () => {
    withEnvironment(
      {
        QA_HTTP_FIXTURE_URL: undefined,
        TEST_BASE_URL: undefined,
        QA_ISOLATED_DATABASE: "true",
      },
      () => {
        assert.throws(
          () => requireHttpFixture("fixture regression"),
          /QA HTTP fixture is required.*localhost:5000/i,
        );
      },
    );
  });

  test("the workflow application endpoint is not accepted as an owned fixture", () => {
    withEnvironment(
      {
        QA_HTTP_FIXTURE_URL: undefined,
        TEST_BASE_URL: "http://localhost:5000",
        QA_ISOLATED_DATABASE: "true",
      },
      () => {
        assert.throws(
          () => requireHttpFixture("fixture regression"),
          /not the workflow application endpoint|refusing localhost:5000/i,
        );
      },
    );
  });

  test("owned local fixture requires isolated database and preserves its URL", () => {
    withEnvironment(
      {
        QA_HTTP_FIXTURE_URL: "http://127.0.0.1:15481/",
        TEST_BASE_URL: undefined,
        QA_ISOLATED_DATABASE: "true",
      },
      () => {
        assert.deepEqual(requireHttpFixture("fixture regression"), {
          baseUrl: "http://127.0.0.1:15481",
          origin: "http://127.0.0.1:15481",
          hostname: "127.0.0.1",
          port: 15481,
        });
      },
    );
  });

  test("synthetic account helper keeps test identities on test.invalid", () => {
    const email = syntheticAccountEmail("run/with spaces", "admin");
    assert.equal(email, "qa_run_with_spaces_admin@test.invalid");
    assert.equal(isSyntheticAccountEmail(email), true);
    assert.equal(isSyntheticAccountEmail("admin@example.com"), false);
  });
});

describe("offline network guard contract", () => {
  test("only explicitly listed local fixture ports are allowed", () => {
    const ports = parseAllowedPorts("55481, 15481, invalid, 0, 70000");
    assert.equal(isAllowedSocketTarget({ host: "127.0.0.1", port: 15481 }, ports), true);
    assert.equal(isAllowedSocketTarget({ hostname: "localhost", port: 55481 }, ports), true);
    assert.equal(isAllowedSocketTarget({ host: "example.com", port: 15481 }, ports), false);
    assert.equal(isAllowedSocketTarget({ host: "127.0.0.1", port: 5000 }, ports), false);
  });

  test("global fetch remains blocked until a suite injects a transport", async () => {
    await assert.rejects(
      () => fetch("https://example.com"),
      /QA_OFFLINE_FETCH_BLOCKED/,
    );
  });

  test("local fixture fetch is still blocked when its port is not allowlisted", async () => {
    const fixtureServer = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("owned fixture");
    });
    await new Promise((resolve) => fixtureServer.listen(0, "127.0.0.1", resolve));
    const port = fixtureServer.address().port;
    const originalPorts = process.env.QA_TEST_ALLOWED_PORTS;
    process.env.QA_TEST_ALLOWED_PORTS = String(port);
    try {
      // The preload guard's allowlist is immutable after module initialization;
      // suites must receive the owned HTTP port before the child process starts
      // rather than widening it at runtime.
      await assert.rejects(
        () => fetch(`http://127.0.0.1:${port}`),
        /QA_OFFLINE_FETCH_BLOCKED/,
      );
    } finally {
      if (originalPorts === undefined) delete process.env.QA_TEST_ALLOWED_PORTS;
      else process.env.QA_TEST_ALLOWED_PORTS = originalPorts;
      await new Promise((resolve) => fixtureServer.close(resolve));
    }
  });
});