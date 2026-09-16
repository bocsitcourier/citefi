// Preload for isolated QA tests. No external sockets or real fetch calls.
// Local integration ports must be explicitly allowed and owned by the test.
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

const allowedPorts = new Set(
  (process.env.QA_TEST_ALLOWED_PORTS || "")
    .split(",")
    .filter(Boolean)
    .map(Number),
);
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = args[0];
  const options = Array.isArray(first) ? first[0] : first;
  const port = typeof options === "object" ? Number(options?.port) : Number(options);
  const host = typeof options === "object"
    ? options?.host ?? "localhost"
    : typeof args[1] === "string" ? args[1] : "localhost";
  if (!["localhost", "127.0.0.1", "::1"].includes(host) || !allowedPorts.has(port)) {
    throw new Error("QA_OFFLINE_NETWORK_BLOCKED");
  }
  return connect.apply(this, args);
};
globalThis.fetch = async function () {
  throw new Error("QA_OFFLINE_FETCH_BLOCKED: inject a test transport");
};
syncBuiltinESMExports();