// Keep the offline socket guard, allowing fetch only to this owned HTTP fixture.
const nativeFetch = globalThis.fetch;
await import("./offline-guard.mjs");
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== "5110") {
    throw new Error("QA_ARTICLE_CHAIN_FETCH_DENIED");
  }
  return nativeFetch(input, { ...init, redirect: "error" });
};