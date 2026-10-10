import type { FormattedContent } from "./types";

export interface ReviewedAsset {
  sourceKey: string;
  sha256: string;
  size: number;
  pinnedKey: string;
}

export interface ReviewManifest {
  version: 1;
  digest: string;
  sourceHash: string;
  contentType: "article" | "podcast";
  assignmentTeamId: number | null;
  requestedAt: string | null;
  destination: {
    id: number;
    name: string;
    channel: string;
    origin: string;
    accountFingerprint: string;
  };
  formatted: FormattedContent;
  assets: ReviewedAsset[];
}

export interface ApprovalSnapshot extends ReviewManifest {
  reviewId: string;
  reviewedBy: number;
  reviewerTeamId: number;
  reviewerRole: string;
  reviewerMembership: string;
  reviewedAt: string;
}
