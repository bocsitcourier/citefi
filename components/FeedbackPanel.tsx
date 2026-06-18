"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ThumbsUp, ThumbsDown, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface FeedbackPanelProps {
  contentType: "article" | "social_post";
  contentId: number;
  metricId?: number;
  className?: string;
}

export function FeedbackPanel({ contentType, contentId, metricId, className }: FeedbackPanelProps) {
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (data: { rating: "up" | "down"; comment?: string }) =>
      apiRequest("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          contentType,
          ...(contentType === "article" ? { articleId: contentId } : { socialPostId: contentId }),
          rating: data.rating,
          comment: data.comment || undefined,
          metricId,
        }),
      }),
    onSuccess: () => {
      setSubmitted(true);
      toast({ title: "Feedback received", description: "Thanks — this helps improve future content." });
    },
    onError: () => {
      toast({ title: "Could not submit feedback", variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!rating) return;
    mutation.mutate({ rating, comment: comment || undefined });
  };

  if (submitted) {
    return (
      <div className={cn("flex items-center gap-2 text-sm text-muted-foreground py-2", className)}>
        <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
        <span>Feedback submitted — thank you!</span>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Rate this content:</span>
        <Button
          size="sm"
          variant={rating === "up" ? "default" : "outline"}
          onClick={() => { setRating("up"); setComment(""); }}
          disabled={mutation.isPending}
          data-testid="button-feedback-up"
        >
          <ThumbsUp className="w-3.5 h-3.5 mr-1" />
          Looks good
        </Button>
        <Button
          size="sm"
          variant={rating === "down" ? "destructive" : "outline"}
          onClick={() => setRating("down")}
          disabled={mutation.isPending}
          data-testid="button-feedback-down"
        >
          <ThumbsDown className="w-3.5 h-3.5 mr-1" />
          Needs work
        </Button>
      </div>

      {rating === "down" && (
        <Textarea
          placeholder="What could be improved? (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="text-sm"
          rows={2}
          data-testid="textarea-feedback-comment"
        />
      )}

      {rating && (
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={mutation.isPending}
          data-testid="button-feedback-submit"
        >
          {mutation.isPending ? "Submitting..." : "Submit Feedback"}
        </Button>
      )}
    </div>
  );
}
