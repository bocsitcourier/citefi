"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Target, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface ConversionLabelerProps {
  contentType: "article" | "social_post";
  contentId: number;
  className?: string;
}

export function ConversionLabeler({ contentType, contentId, className }: ConversionLabelerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [justLabeled, setJustLabeled] = useState(false);

  const conversionKey = ["/api/events/conversion", contentType, contentId];

  const { data } = useQuery<{ conversions: number }>({
    queryKey: conversionKey,
    queryFn: () =>
      apiRequest(`/api/events/conversion?contentType=${contentType}&contentId=${contentId}`),
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("/api/events/conversion", {
        method: "POST",
        body: JSON.stringify({ contentType, contentId }),
      }),
    onSuccess: () => {
      setJustLabeled(true);
      queryClient.invalidateQueries({ queryKey: conversionKey });
      toast({ title: "Conversion recorded", description: "This content has been labeled as converted." });
    },
    onError: () => {
      toast({ title: "Could not record conversion", variant: "destructive" });
    },
  });

  const count = data?.conversions ?? 0;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Button
        size="sm"
        variant="outline"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        data-testid="button-label-conversion"
      >
        {justLabeled ? (
          <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-green-500" />
        ) : (
          <Target className="w-3.5 h-3.5 mr-1" />
        )}
        {mutation.isPending ? "Recording..." : "Mark as Converted"}
      </Button>
      {count > 0 && (
        <span className="text-xs text-muted-foreground" data-testid="text-conversion-count">
          {count} conversion{count !== 1 ? "s" : ""} recorded
        </span>
      )}
    </div>
  );
}
