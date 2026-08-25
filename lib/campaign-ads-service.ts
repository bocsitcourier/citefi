import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { GoogleGenAI } from "@google/genai";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { getModel } from "./model-resolver";
import { PRODUCT_POLICY_DEFAULTS, LAUNCH_POLICY_VERSION, EXTERNAL_PLATFORM_APPROVALS } from "./launch-governance";
import { safeFetchPageWithRedirects } from "./client-brand-profile-service";
import { campaignAds, campaignAdApprovals, campaigns } from "@/shared/schema";
import { extractGeminiUsage, isProviderAccountingError, logCostTelemetry, logFailedProviderAttempt } from "./cost-telemetry";

export const AD_EXPORT_NOTICE = PRODUCT_POLICY_DEFAULTS.advertising.exportNotice;
export type AdPlatform = "google" | "meta";

export interface GoogleRsaAssets {
  headlines: string[];
  descriptions: string[];
  path1?: string;
  path2?: string;
  keywords?: string[];
}
export interface MetaCreativeVariant {
  name: string;
  primaryText: string;
  headline: string;
  description?: string;
  callToAction: string;
  imageBrief: string;
}
export interface MetaCreativePack { variants: MetaCreativeVariant[] }

export interface AdValidationIssue {
  code: string;
  field: string;
  severity: "error" | "warning";
  message: string;
}

function asciiSlug(value: string): string {
  return value.normalize("NFKD").replace(/[^\x00-\x7F]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 200) || "campaign";
}

function forbiddenHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  // Ad destinations must be DNS names. Rejecting all IP literals avoids private,
  // loopback, link-local, IPv4-mapped IPv6, and alternate-address ambiguity.
  return isIP(h) !== 0;
}

export function validateLandingUrl(landingUrl: string, businessUrl: string | null): URL {
  let landing: URL;
  try { landing = new URL(landingUrl); } catch { throw new Error("Landing URL is invalid"); }
  if (landing.protocol !== "https:") throw new Error("Landing URL must use HTTPS");
  if (landing.username || landing.password || forbiddenHostname(landing.hostname)) {
    throw new Error("Landing URL host is not allowed");
  }
  if (businessUrl) {
    let business: URL;
    try { business = new URL(businessUrl); } catch { throw new Error("Campaign business URL is invalid"); }
    const a = landing.hostname.toLowerCase().replace(/^www\./, "");
    const b = business.hostname.toLowerCase().replace(/^www\./, "");
    if (a !== b && !a.endsWith(`.${b}`) && !b.endsWith(`.${a}`)) {
      throw new Error("Landing URL domain does not align with the campaign business domain");
    }
  }
  return landing;
}

function visiblePageText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .slice(0, 200_000);
}

function significantTerms(value: string): string[] {
  const ignored = new Set(["about", "after", "before", "campaign", "complete", "create", "customer", "from", "into", "local", "marketing", "service", "their", "these", "this", "with"]);
  return [...new Set(value.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])]
    .filter((term) => !ignored.has(term))
    .slice(0, 24);
}

export async function inspectLandingPage(input: {
  landingUrl: string;
  businessUrl: string | null;
  companyName: string;
  campaignName: string;
  brief?: string;
}) {
  const landing = validateLandingUrl(input.landingUrl, input.businessUrl);
  const response = await safeFetchPageWithRedirects(landing.href);
  if (!response || !response.ok) throw new Error("Landing page must return a successful 2xx response");
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/html")) throw new Error("Landing page must return HTML");
  const html = await response.text();
  const text = visiblePageText(html);
  const brandTerms = significantTerms(input.companyName);
  const offerTerms = significantTerms(`${input.campaignName} ${input.brief ?? ""}`);
  const matchedBrandTerms = brandTerms.filter((term) => text.includes(term));
  const matchedOfferTerms = offerTerms.filter((term) => text.includes(term));
  if (brandTerms.length && matchedBrandTerms.length === 0) {
    throw new Error("Landing page does not contain the campaign brand name");
  }
  if (offerTerms.length && matchedOfferTerms.length === 0) {
    throw new Error("Landing page does not align with the campaign offer");
  }
  return {
    status: "pass" as const,
    httpsRequired: true,
    campaignDomainAligned: true,
    networkFetchPerformed: true,
    httpStatus: response.status,
    contentType,
    brandMatched: brandTerms.length === 0 || matchedBrandTerms.length > 0,
    matchedBrandTerms,
    offerMatched: offerTerms.length === 0 || matchedOfferTerms.length > 0,
    matchedOfferTerms,
    ssrfUnsafeHostsRejected: true,
  };
}

export function buildAdTrackingUrl(input: {
  landingUrl: string; platform: AdPlatform; campaign: string; asset: string;
  variant: string; keyword?: string; approveUtmOverwrite?: boolean;
}): string {
  const url = new URL(input.landingUrl);
  const existingUtms = [...url.searchParams.keys()].filter((k) => k.toLowerCase().startsWith("utm_"));
  if (existingUtms.length && !input.approveUtmOverwrite) {
    throw new Error(`Landing URL already has UTM parameters (${existingUtms.join(", ")}); explicit overwrite approval is required`);
  }
  const channel = input.platform === "google"
    ? PRODUCT_POLICY_DEFAULTS.utm.googleAds : PRODUCT_POLICY_DEFAULTS.utm.metaAds;
  url.searchParams.set("utm_source", channel.source);
  url.searchParams.set("utm_medium", channel.medium);
  url.searchParams.set("utm_campaign", asciiSlug(input.campaign));
  url.searchParams.set("utm_content", `${asciiSlug(input.asset)}--${asciiSlug(input.variant)}`);
  if (input.keyword) url.searchParams.set("utm_term", asciiSlug(input.keyword));
  else url.searchParams.delete("utm_term");
  return url.toString();
}

export function buildAdExportRowsFromManifest(manifest: any) {
  if (!manifest || manifest.schemaVersion !== "campaign-ads-export/v1" || !manifest.google || !manifest.meta) {
    throw new Error("Finalized ad manifest is invalid");
  }
  const googleRows = manifest.google.headlines.map((headline: string, index: number) => ({
    headline,
    description: manifest.google.descriptions[index % manifest.google.descriptions.length],
    finalUrl: buildAdTrackingUrl({
      landingUrl: manifest.landingUrl,
      platform: "google",
      campaign: manifest.campaignSlug,
      asset: "rsa",
      variant: String(index + 1),
      keyword: manifest.google.keywords?.[0],
      approveUtmOverwrite: true,
    }),
    path1: manifest.google.path1 ?? "",
    path2: manifest.google.path2 ?? "",
  }));
  const metaRows = manifest.meta.variants.map((variant: any, index: number) => ({
    ...variant,
    destinationUrl: buildAdTrackingUrl({
      landingUrl: manifest.landingUrl,
      platform: "meta",
      campaign: manifest.campaignSlug,
      asset: "creative",
      variant: variant.name || String(index + 1),
      approveUtmOverwrite: true,
    }),
  }));
  return { googleRows, metaRows };
}

export function validateGoogleRsa(asset: GoogleRsaAssets): AdValidationIssue[] {
  const issues: AdValidationIssue[] = [];
  if (!Array.isArray(asset.headlines) || asset.headlines.length < 3 || asset.headlines.length > 15)
    issues.push({ code: "GOOGLE_HEADLINE_COUNT", field: "headlines", severity: "error", message: "Google RSA requires 3–15 headlines" });
  asset.headlines?.forEach((v, i) => {
    if (!v.trim() || v.length > 30) issues.push({ code: "GOOGLE_HEADLINE_LENGTH", field: `headlines.${i}`, severity: "error", message: "Headline must be 1–30 characters" });
  });
  if (!Array.isArray(asset.descriptions) || asset.descriptions.length < 2 || asset.descriptions.length > 4)
    issues.push({ code: "GOOGLE_DESCRIPTION_COUNT", field: "descriptions", severity: "error", message: "Google RSA requires 2–4 descriptions" });
  asset.descriptions?.forEach((v, i) => {
    if (!v.trim() || v.length > 90) issues.push({ code: "GOOGLE_DESCRIPTION_LENGTH", field: `descriptions.${i}`, severity: "error", message: "Description must be 1–90 characters" });
  });
  for (const key of ["path1", "path2"] as const) {
    if (asset[key] && asset[key]!.length > 15) issues.push({ code: "GOOGLE_PATH_LENGTH", field: key, severity: "error", message: "Display path must be at most 15 characters" });
  }
  return issues;
}

export function validateMetaPack(pack: MetaCreativePack): AdValidationIssue[] {
  const issues: AdValidationIssue[] = [];
  if (!Array.isArray(pack.variants) || pack.variants.length < 3)
    issues.push({ code: "META_VARIANT_COUNT", field: "variants", severity: "error", message: "Meta pack requires at least 3 variants" });
  pack.variants?.forEach((v, i) => {
    if (!v.primaryText?.trim()) issues.push({ code: "META_PRIMARY_REQUIRED", field: `variants.${i}.primaryText`, severity: "error", message: "Primary text is required" });
    if (v.primaryText?.length > 125) issues.push({ code: "META_PRIMARY_RECOMMENDED", field: `variants.${i}.primaryText`, severity: "warning", message: "Primary text exceeds the 125-character recommended visible length" });
    if (!v.headline?.trim() || v.headline.length > 40) issues.push({ code: "META_HEADLINE_LENGTH", field: `variants.${i}.headline`, severity: "error", message: "Meta headline must be 1–40 characters" });
    if (!v.imageBrief?.trim()) issues.push({ code: "META_IMAGE_BRIEF_REQUIRED", field: `variants.${i}.imageBrief`, severity: "error", message: "A non-logo-recreation image brief is required" });
  });
  return issues;
}

function allCopy(google: GoogleRsaAssets, meta: MetaCreativePack): string {
  return [...google.headlines, ...google.descriptions,
    ...meta.variants.flatMap((v) => [v.primaryText, v.headline, v.description ?? ""])].join("\n").toLowerCase();
}

export function deterministicPolicyCheck(google: GoogleRsaAssets, meta: MetaCreativePack, snapshot: any) {
  const pack = snapshot?.brandPolicyPack ?? {};
  const copy = allCopy(google, meta);
  const prohibited = [...(pack.prohibitedClaims ?? []), ...(pack.prohibitedPhrases ?? [])]
    .filter((phrase: unknown) => typeof phrase === "string" && phrase.trim() && copy.includes(phrase.toLowerCase()));
  const requiredDisclaimers: string[] = Array.isArray(pack.requiredDisclaimers) ? pack.requiredDisclaimers : [];
  const unresolvedDisclaimers = requiredDisclaimers.filter((d) => !copy.includes(d.toLowerCase()));
  const regulated = Boolean(pack.regulatedVertical) ||
    (Array.isArray(pack.localeConstraints) && pack.localeConstraints.some((x: any) => x?.regulatoryDisclaimers?.length));
  return {
    policyVersion: LAUNCH_POLICY_VERSION,
    prohibitedMatches: prohibited,
    requiredDisclaimers,
    unresolvedDisclaimers,
    regulatedVertical: regulated,
    regulatedReviewRequired: regulated,
    blocksExport: prohibited.length > 0 || unresolvedDisclaimers.length > 0,
  };
}

interface CampaignAdsTelemetryContext {
  teamId: number;
  campaignId: number;
  requestKey: string;
}

async function generateAssets(prompt: string, telemetry: CampaignAdsTelemetryContext): Promise<{ google: GoogleRsaAssets; meta: MetaCreativePack; model: string }> {
  if (!Number.isInteger(telemetry.teamId) || telemetry.teamId <= 0) {
    throw new Error("Campaign ad generation requires a validated teamId");
  }
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required for ad generation");
  const model = getModel("geminiFlash");
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const startedAt = Date.now();
  let providerAttemptLogged = false;
  try {
    const result = await client.models.generateContent({
      model, contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json" },
    });
    await logCostTelemetry(
      { operationType: "campaign_ads", provider: "gemini", model, ...telemetry, attempt: 1,
        providerRequestId: (result as any).responseId ?? null, resourceType: "campaign", resourceId: telemetry.campaignId },
      extractGeminiUsage(result), Date.now() - startedAt, true
    );
    providerAttemptLogged = true;
    const parsed = JSON.parse(result.text ?? "{}");
    if (!parsed.google || !parsed.meta) throw new Error("AI returned an invalid ad asset contract");
    return { google: parsed.google, meta: parsed.meta, model };
  } catch (error) {
    if (isProviderAccountingError(error)) throw error;
    if (!providerAttemptLogged) {
      await logFailedProviderAttempt(
        { operationType: "campaign_ads", provider: "gemini", model, ...telemetry, attempt: 1,
          resourceType: "campaign", resourceId: telemetry.campaignId },
        { totalTokens: 0 }, Date.now() - startedAt, error
      );
    }
    throw error;
  }
}

export async function createCampaignAdPack(teamId: number, userId: number, campaignId: number, input: {
  requestKey: string; landingUrl: string; brief?: string; approveUtmOverwrite?: boolean;
}) {
  const [campaign] = await db.select().from(campaigns).where(and(
    eq(campaigns.id, campaignId), eq(campaigns.teamId, teamId), isNull(campaigns.deletedAt)
  )).limit(1);
  if (!campaign) return null;
  if (campaign.brandStatus !== "confirmed" || !campaign.brandProfileSnapshot || !campaign.brandConfirmedAt)
    throw new Error("A confirmed campaign Brand Intelligence snapshot is required");
  const landingAlignment = await inspectLandingPage({
    landingUrl: input.landingUrl,
    businessUrl: campaign.businessUrl,
    companyName: campaign.companyName ?? "",
    campaignName: campaign.name ?? "Campaign",
    brief: input.brief,
  });
  // Validate overwrite consent before spending model credits.
  buildAdTrackingUrl({ landingUrl: input.landingUrl, platform: "google", campaign: campaign.name ?? "Campaign", asset: "rsa", variant: "1", approveUtmOverwrite: input.approveUtmOverwrite });
  const [existing] = await db.select().from(campaignAds).where(and(
    eq(campaignAds.teamId, teamId), eq(campaignAds.requestKey, input.requestKey)
  )).limit(1);
  if (existing) return existing;

  const snapshot = campaign.brandProfileSnapshot as any;
  const generated = await generateAssets(`Create an export-only local advertising pack. Return only JSON:
{"google":{"headlines":["3 to 15, each <=30 chars"],"descriptions":["2 to 4, each <=90 chars"],"path1":"<=15","path2":"<=15","keywords":[]},"meta":{"variants":[{"name":"slug","primaryText":"prefer <=125 chars","headline":"<=40 chars","description":"","callToAction":"LEARN_MORE","imageBrief":"scene only; never recreate logos, trademarks, or text"}]}}
Create at least 3 Meta variants. Use only grounded approved claims. Include every required disclaimer in ad copy.
Campaign: ${campaign.name}; company: ${campaign.companyName}; locations: ${JSON.stringify(campaign.locations ?? [])}
Brief: ${input.brief ?? ""}; immutable brand snapshot: ${JSON.stringify(snapshot)}`, { teamId, campaignId, requestKey: input.requestKey });
  const validation = [...validateGoogleRsa(generated.google), ...validateMetaPack(generated.meta)];
  const existingUtmParameters = [...new URL(input.landingUrl).searchParams.keys()]
    .filter((key) => key.toLowerCase().startsWith("utm_"));
  const policy = {
    ...deterministicPolicyCheck(generated.google, generated.meta, snapshot),
    landingAlignment,
    utmOverwriteApproved: existingUtmParameters.length === 0 || input.approveUtmOverwrite === true,
    existingUtmParameters,
  };
  const [row] = await db.insert(campaignAds).values({
    teamId, campaignId, createdBy: userId, requestKey: input.requestKey,
    landingUrl: input.landingUrl, campaignSlug: asciiSlug(campaign.name),
    googleAssets: generated.google as any, metaAssets: generated.meta as any,
    validationJson: validation as any, policyJson: policy as any,
    generationModel: generated.model, brandSnapshot: snapshot,
  }).onConflictDoNothing({ target: [campaignAds.teamId, campaignAds.requestKey] }).returning();
  if (row) return row;
  return (await db.select().from(campaignAds).where(and(eq(campaignAds.teamId, teamId), eq(campaignAds.requestKey, input.requestKey))).limit(1))[0] ?? null;
}

export async function listCampaignAds(teamId: number, campaignId: number) {
  return db.select().from(campaignAds).where(and(eq(campaignAds.teamId, teamId), eq(campaignAds.campaignId, campaignId))).orderBy(desc(campaignAds.createdAt));
}

export async function getCampaignAdByRequestKey(teamId: number, campaignId: number, requestKey: string) {
  const [row] = await db.select().from(campaignAds).where(and(
    eq(campaignAds.teamId, teamId), eq(campaignAds.campaignId, campaignId), eq(campaignAds.requestKey, requestKey)
  )).limit(1);
  return row ?? null;
}

export function canonicalAdManifestJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalAdManifestJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as any).sort().map((k) => `${JSON.stringify(k)}:${canonicalAdManifestJson((value as any)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}

export async function approveCampaignAd(teamId: number, userId: number, role: string, campaignId: number, adPublicId: string, input: {
  approvalType: "client" | "policy" | "export"; decision: "approved" | "rejected";
  humanAcknowledged: boolean; acknowledgementText?: string;
}) {
  const [ad] = await db.select().from(campaignAds).where(and(
    eq(campaignAds.teamId, teamId), eq(campaignAds.campaignId, campaignId), eq(campaignAds.publicId, adPublicId)
  )).limit(1);
  if (!ad) return null;
  if (ad.finalizedAt) throw new Error("Finalized ad manifests and approvals are immutable");
  if (!input.humanAcknowledged) throw new Error("Human acknowledgement is required");
  if (input.approvalType === "export" && !["owner", "admin"].includes(role)) throw new Error("Workspace owner or admin authorization is required for export");
  const priorApprovals = await db.select().from(campaignAdApprovals).where(and(
    eq(campaignAdApprovals.teamId, teamId), eq(campaignAdApprovals.campaignAdId, ad.id)
  )).orderBy(desc(campaignAdApprovals.createdAt));
  const priorLatest = (type: string) => priorApprovals.find((a) => a.approvalType === type)?.decision;
  const policy: any = ad.policyJson;
  const issues: any[] = ad.validationJson as any[];
  if (input.approvalType === "export" && input.decision === "approved" && (
    priorLatest("client") !== "approved" || priorLatest("policy") !== "approved" ||
    policy.blocksExport || issues.some((x) => x.severity === "error")
  )) {
    throw new Error("Client approval, policy approval, disclaimers, and deterministic validation must pass before export authorization");
  }
  await db.insert(campaignAdApprovals).values({
    teamId, campaignAdId: ad.id, actorUserId: userId, ...input,
    metadataJson: { notice: AD_EXPORT_NOTICE, policyVersion: LAUNCH_POLICY_VERSION },
  });
  const approvals = await db.select().from(campaignAdApprovals).where(and(eq(campaignAdApprovals.teamId, teamId), eq(campaignAdApprovals.campaignAdId, ad.id))).orderBy(desc(campaignAdApprovals.createdAt));
  const latest = (type: string) => approvals.find((a) => a.approvalType === type)?.decision;
  let status = input.decision === "rejected" ? "internal_review" :
    latest("client") === "approved" ? "client_approved" : "internal_review";
  if (latest("client") === "approved" && latest("policy") === "approved" && !policy.blocksExport && !issues.some((x) => x.severity === "error")) status = "export_ready";
  let manifest: any = null;
  let hash: string | null = null;
  if (input.approvalType === "export" && input.decision === "approved") {
    manifest = {
      schemaVersion: "campaign-ads-export/v1", policyVersion: LAUNCH_POLICY_VERSION,
      mode: "export_only", directPublishing: false, notice: AD_EXPORT_NOTICE,
       campaignId: ad.campaignId, adPublicId: ad.publicId, campaignSlug: ad.campaignSlug, landingUrl: ad.landingUrl,
       landingAlignment: (ad.policyJson as any)?.landingAlignment,
      utmConvention: PRODUCT_POLICY_DEFAULTS.utm,
      brandSnapshot: ad.brandSnapshot, google: ad.googleAssets, meta: ad.metaAssets,
      validation: ad.validationJson, policy: ad.policyJson,
      externalApprovals: { google: EXTERNAL_PLATFORM_APPROVALS.googleAds.status, meta: EXTERNAL_PLATFORM_APPROVALS.metaAds.status },
      approvals: approvals.map((a) => ({ type: a.approvalType, decision: a.decision, actorUserId: a.actorUserId, humanAcknowledged: a.humanAcknowledged, createdAt: a.createdAt })),
    };
    hash = createHash("sha256").update(canonicalAdManifestJson(manifest)).digest("hex");
    status = "exported";
  }
  const [updated] = await db.update(campaignAds).set({
    status, ...(manifest ? { manifestJson: manifest, manifestSha256: hash, finalizedAt: new Date() } : {}), updatedAt: new Date(),
  }).where(and(eq(campaignAds.teamId, teamId), eq(campaignAds.id, ad.id))).returning();
  return updated ?? null;
}

export async function getCampaignAdForExport(teamId: number, campaignId: number, adPublicId: string) {
  const [ad] = await db.select().from(campaignAds).where(and(
    eq(campaignAds.teamId, teamId), eq(campaignAds.campaignId, campaignId), eq(campaignAds.publicId, adPublicId)
  )).limit(1);
  return ad?.status === "exported" && ad.manifestJson && ad.manifestSha256 ? ad : null;
}