import type { CatalogModel } from "./model-policy";

/** Metadata only. Never submit a generation/canary to discover model IDs. */
export async function fetchModelCatalog(
  provider: "gemini" | "openai", key: string | undefined, transport: typeof fetch = fetch,
): Promise<CatalogModel[]> {
  if (!key) throw new Error(`${provider} catalog credential missing`);
  const models = new Map<string, CatalogModel>(), tokens = new Set<string>();
  let token: string | undefined;
  for (let page = 0; page < 20; page++) {
    const url = new URL(provider === "gemini"
      ? "https://generativelanguage.googleapis.com/v1beta/models"
      : "https://api.openai.com/v1/models");
    if (provider === "gemini") {
      url.searchParams.set("pageSize", "200");
      if (token) url.searchParams.set("pageToken", token);
    }
    const response = await transport(url, {
      headers: provider === "gemini" ? { "x-goog-api-key": key } : { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`${provider} catalog HTTP ${response.status}`);
    const body = await response.json();
    const entries = provider === "gemini" ? body.models : body.data;
    if (!Array.isArray(entries)) throw new Error(`${provider} malformed catalog`);
    for (const entry of entries) {
      const rawId = provider === "gemini" ? entry?.name : entry?.id;
      if (typeof rawId !== "string") throw new Error(`${provider} malformed model ID`);
      const id = rawId.replace(/^models\//, "");
      if (!/^[a-zA-Z0-9_.:-]{1,120}$/.test(id)) throw new Error(`${provider} malformed model ID`);
      const methods = provider === "gemini" ? entry.supportedGenerationMethods : undefined;
      if (provider === "gemini" && (!Array.isArray(methods) || methods.some((m: unknown) => typeof m !== "string")))
        throw new Error("gemini malformed operation metadata");
      models.set(id, { id, ...(methods ? { methods: [...methods] } : {}) });
    }
    if (provider === "openai") {
      if (body.has_more === true) throw new Error("openai incomplete catalog");
      return [...models.values()];
    }
    token = body.nextPageToken;
    if (token == null || token === "") return [...models.values()];
    if (typeof token !== "string" || tokens.has(token)) throw new Error("gemini invalid pagination");
    tokens.add(token);
  }
  throw new Error(`${provider} catalog page limit exceeded`);
}
