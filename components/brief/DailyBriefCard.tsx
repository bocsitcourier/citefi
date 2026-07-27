"use client";

import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  ChevronDown, 
  ChevronUp, 
  ArrowRight, 
  Zap, 
  TrendingUp, 
  Eye, 
  GraduationCap, 
  Mic, 
  Heart 
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import Link from "next/link";

interface BriefSection {
  headline?: string;
  items?: string[];
  insights?: string[];
  lesson?: string;
  groundedIn?: string;
  nudge?: string;
  evidence?: string[];
}

interface DailyBrief {
  todayFocus: {
    type: string;
    action: string;
    why: string;
    ctaPath: string;
  };
  overnightMovement: BriefSection;
  competitorWatch: BriefSection;
  teachingMoment: BriefSection;
  voicePrompt: BriefSection;
  motivation: BriefSection;
}

interface DailyBriefCardProps {
  brief: DailyBrief;
  id: number;
}

export function DailyBriefCard({ brief, id }: DailyBriefCardProps) {
  useEffect(() => {
    const markViewed = async () => {
      try {
        await apiRequest(`/api/briefs/${id}/viewed`, { method: "POST" });
      } catch (err) {
        console.error("Failed to mark brief as viewed:", err);
      }
    };
    markViewed();
  }, [id]);

  return (
    <div className="space-y-6">
      {/* Today's Focus */}
      <Card className="border-primary/30 bg-primary/5 hover-elevate overflow-visible">
        <CardHeader>
          <div className="flex items-center gap-2 text-primary">
            <Zap className="w-5 h-5 fill-current" />
            <CardTitle>Today&apos;s Focus</CardTitle>
          </div>
          <CardDescription>Your highest impact action for today</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <h3 className="text-xl font-bold" data-testid="text-brief-focus-action">
            {brief.todayFocus.action}
          </h3>
          <p className="text-muted-foreground" data-testid="text-brief-focus-why">
            {brief.todayFocus.why}
          </p>
          <Link href={brief.todayFocus.ctaPath}>
            <Button data-testid="button-brief-cta" className="gap-2">
              Execute Now
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <BriefCollapsibleSection
          title="Overnight Movement"
          icon={<TrendingUp className="w-4 h-4 text-blue-500" />}
          headline={brief.overnightMovement.headline}
          items={brief.overnightMovement.items}
          testId="overnight-movement"
        />
        <BriefCollapsibleSection
          title="Competitor Watch"
          icon={<Eye className="w-4 h-4 text-orange-500" />}
          headline={brief.competitorWatch.headline}
          items={brief.competitorWatch.insights}
          testId="competitor-watch"
        />
        <BriefCollapsibleSection
          title="Teaching Moment"
          icon={<GraduationCap className="w-4 h-4 text-green-500" />}
          headline={brief.teachingMoment.lesson}
          items={brief.teachingMoment.groundedIn ? [brief.teachingMoment.groundedIn] : []}
          testId="teaching-moment"
        />
        <BriefCollapsibleSection
          title="Voice & Tone Nudge"
          icon={<Mic className="w-4 h-4 text-purple-500" />}
          headline="Style Tip"
          items={brief.voicePrompt.nudge ? [brief.voicePrompt.nudge] : []}
          testId="voice-prompt"
        />
        <BriefCollapsibleSection
          title="Daily Motivation"
          icon={<Heart className="w-4 h-4 text-red-500" />}
          headline={brief.motivation.headline}
          items={brief.motivation.evidence}
          testId="motivation"
        />
      </div>
    </div>
  );
}

function BriefCollapsibleSection({ 
  title, 
  icon, 
  headline, 
  items, 
  testId 
}: { 
  title: string; 
  icon: React.ReactNode; 
  headline?: string; 
  items?: string[]; 
  testId: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="w-full"
    >
      <Card className="hover-elevate overflow-visible">
        <CollapsibleTrigger asChild>
          <div 
            className="flex items-center justify-between p-4 cursor-pointer"
            data-testid={`collapsible-trigger-${testId}`}
          >
            <div className="flex items-center gap-2">
              {icon}
              <h4 className="font-semibold text-sm">{title}</h4>
            </div>
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 pb-4">
            <div className="space-y-3 pt-2 border-t">
              {headline && (
                <p className="text-sm font-medium text-foreground" data-testid={`text-headline-${testId}`}>
                  {headline}
                </p>
              )}
              {items && items.length > 0 && (
                <ul className="space-y-2">
                  {items.map((item, idx) => (
                    <li 
                      key={idx} 
                      className="text-sm text-muted-foreground flex gap-2"
                      data-testid={`text-item-${testId}-${idx}`}
                    >
                      <span className="text-primary mt-1 shrink-0">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
