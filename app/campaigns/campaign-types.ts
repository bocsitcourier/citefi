export type CampaignStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETE" | string;

export interface Campaign {
  id: string | number;
  publicId: string;
  name: string;
  businessUrl: string;
  companyName: string;
  status: CampaignStatus;
  brandStatus: string;
  brandProfileSnapshot?: Record<string, unknown> | null;
  brandConfirmedAt?: string | null;
  goals: string[];
  locations: CampaignLocation[];
  recommendedAssetBundle?: AssetBundle | null;
  assetBundle?: AssetBundle | null;
  creditEstimate?: { totalCredits?: number; [key: string]: unknown } | null;
  compatibilityMode?: string | null;
  compatibilityEndsAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetBundle {
  articles?: number;
  socialPosts?: number;
  videos?: number;
  [key: string]: unknown;
}

export interface CampaignLocation {
  label: string;
  region?: string;
  country?: string;
}
export interface CampaignDetail extends Campaign {
  brandProfile?: Record<string, any> | null;
  batches?: Array<Record<string, any>>;
  articles?: Array<Record<string, any>>;
  socialPosts?: Array<Record<string, any>>;
  videoIdeas?: Array<Record<string, any>>;
  publishingJobs?: Array<Record<string, any>>;
  exports?: Array<Record<string, any>>;
  stats?: {
    approvals?: { pending?: number; approved?: number; rejected?: number } | number;
    publishing?: { queued?: number; published?: number; failed?: number } | number;
    costUsd?: number;
    credits?: number;
    conversions?: number;
    conversionValue?: number;
  };
}

export const campaignKey = (id: string) => ["/api/campaigns", id] as const;

export function campaignId(campaign: Campaign) {
  return campaign.publicId || String(campaign.id);
}

export function bundleTotal(bundle?: AssetBundle | null) {
  if (!bundle) return 0;
  return ["articles", "socialPosts", "videos"].reduce((total, key) => total + (Number(bundle[key]) || 0), 0);
}