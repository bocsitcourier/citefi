// Preload for isolated QA tests. No external sockets or real fetch calls.
// Local integration ports must be explicitly allowed and owned by the test.
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

export function parseAllowedPorts(value = process.env.QA_TEST_ALLOWED_PORTS || "") {
  return new Set(
    value
      .split(",")
      .map((entry) => Number(entry.trim()))
      .filter((port) => Number.isInteger(port) && port > 0 && port < 65_536),
  );
}

const allowedPorts = parseAllowedPorts();
const allowedHosts = new Set(["localhost", "127.0.0.1", "::1"]);

function targetFromConnectArgs(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first && typeof first === "object") {
    return {
      host: first.host ?? first.hostname ?? "localhost",
      port: Number(first.port),
    };
  }

  return {
    host: typeof args[1] === "string" ? args[1] : "localhost",
    port: Number(first),
  };
}

export function isAllowedSocketTarget(target, ports = allowedPorts) {
  const host = String(target?.host ?? target?.hostname ?? "localhost")
    .toLowerCase()
    .replace(/\.$/, "");
  const port = Number(target?.port);
  return allowedHosts.has(host) && ports.has(port);
}

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const target = targetFromConnectArgs(args);
  if (!isAllowedSocketTarget(target)) {
    throw new Error(
      `QA_OFFLINE_NETWORK_BLOCKED: ${target.host}:${target.port} is not an ` +
        "explicitly allowed local QA fixture target",
    );
  }
  return connect.apply(this, args);
};

const nativeFetch = globalThis.fetch.bind(globalThis);

function targetFromFetchInput(input) {
  const rawUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input?.url;
  if (!rawUrl) return undefined;

  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    return { host: hostname, port };
  } catch {
    return undefined;
  }
}

globalThis.fetch = async function qaOfflineFetchGuard(input, init) {
  const target = targetFromFetchInput(input);
  if (!target || !isAllowedSocketTarget(target)) {
    throw new Error(
      `QA_OFFLINE_FETCH_BLOCKED: ${target?.host ?? "unknown"}:${target?.port ?? "unknown"} ` +
        "is not an explicitly allowed local QA fixture target",
    );
  }
  return nativeFetch(input, init);
};
syncBuiltinESMExports();
