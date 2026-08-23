"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Campaign, CampaignDetail } from "./campaign-types";
import { campaignKey } from "./campaign-types";

export function useCampaigns() {
  return useQuery<Campaign[]>({
    queryKey: ["/api/campaigns"],
    queryFn: async () => {
      const response = await apiRequest("/api/campaigns") as { campaigns: Campaign[] };
      return response.campaigns;
    },
  });
}

export function useCampaign(id: string) {
  return useQuery<CampaignDetail>({
    queryKey: campaignKey(id),
    queryFn: async () => {
      const response = await apiRequest(`/api/campaigns/${id}`) as { campaign: CampaignDetail };
      return response.campaign;
    },
    enabled: Boolean(id),
  });
}

export function useCreateCampaign() {
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiRequest("/api/campaigns", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] }),
  });
}

export function useUpdateCampaign(id: string) {
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiRequest(`/api/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
    onSuccess: (response: { campaign: CampaignDetail }) => {
      const campaign = response.campaign;
      queryClient.setQueryData(campaignKey(id), campaign);
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
    },
  });
}

export function useConfirmBrand(id: string) {
  return useMutation({
    mutationFn: () => apiRequest(`/api/campaigns/${id}/confirm-brand`, { method: "POST" }),
    onSuccess: async (response: { campaign: CampaignDetail }) => {
      queryClient.setQueryData(campaignKey(id), response.campaign);
      await queryClient.invalidateQueries({ queryKey: campaignKey(id) });
      await queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
    },
  });
}