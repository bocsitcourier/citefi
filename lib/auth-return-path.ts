const returnRoots = new Set(["home", "dashboard", "pricing", "features", "solutions", "cities", "free-article", "content", "campaigns", "social", "seo-tools", "media", "intelligence", "personas", "learning", "journeys", "agency", "client", "client-dashboard", "settings", "admin", "batches", "site-map", "monitoring", "embed"]);
/** Navigation only: never grants permissions or accepts API/action/external targets. */
export function safeSignInReturn(value: string | null | undefined): string | undefined {
  if (!value || value.length > 2048 || !value.startsWith("/") || value.startsWith("//")) return undefined;
  try {
    const decoded = decodeURIComponent(value);
    if (/[\u0000-\u0020\\]/.test(decoded) || decoded.startsWith("//")) return undefined;
    const url = new URL(value, "https://citefi.co");
    if (url.origin !== "https://citefi.co" || !returnRoots.has(url.pathname.split("/")[1]!)) return undefined;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return undefined; }
}
