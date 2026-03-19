"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, X } from "lucide-react";

interface AdvancedOptionsProps {
  competitorUrls: string[];
  setCompetitorUrls: (urls: string[]) => void;
  serpFeatureTarget: string;
  setSerpFeatureTarget: (target: string) => void;
  geographicFocus: string;
  setGeographicFocus: (geo: string) => void;
  semanticClusterId?: number;
  setSemanticClusterId: (id?: number) => void;
}

export function AdvancedOptions({
  competitorUrls,
  setCompetitorUrls,
  serpFeatureTarget,
  setSerpFeatureTarget,
  geographicFocus,
  setGeographicFocus,
  semanticClusterId,
  setSemanticClusterId,
}: AdvancedOptionsProps) {
  const [newUrl, setNewUrl] = useState("");

  const addCompetitorUrl = () => {
    if (newUrl && competitorUrls.length < 5) {
      setCompetitorUrls([...competitorUrls, newUrl]);
      setNewUrl("");
    }
  };

  const removeUrl = (index: number) => {
    setCompetitorUrls(competitorUrls.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6 bg-muted/30 p-6 rounded-lg border">
        <div className="space-y-2">
          <Label>Competitor URLs (Up to 5)</Label>
          <div className="flex gap-2">
            <Input
              placeholder="https://competitor.com/article"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              data-testid="input-competitor-url"
            />
            <Button
              onClick={addCompetitorUrl}
              disabled={competitorUrls.length >= 5 || !newUrl}
              data-testid="button-add-competitor"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {competitorUrls.map((url, idx) => (
              <Badge key={idx} variant="secondary" className="gap-1">
                {url.slice(0, 40)}...
                <X
                  className="w-3 h-3 cursor-pointer"
                  onClick={() => removeUrl(idx)}
                  data-testid={`button-remove-competitor-${idx}`}
                />
              </Badge>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label>SERP Feature Target</Label>
          <Select value={serpFeatureTarget} onValueChange={setSerpFeatureTarget}>
            <SelectTrigger data-testid="select-serp-feature">
              <SelectValue placeholder="Select SERP feature" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="Featured Snippet">Featured Snippet</SelectItem>
              <SelectItem value="PAA">People Also Ask (PAA)</SelectItem>
              <SelectItem value="List">List/Carousel</SelectItem>
              <SelectItem value="Q&A">Q&A Schema</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Geographic Focus *</Label>
          <Input
            placeholder="e.g., Boston, Massachusetts or Seattle, Washington"
            value={geographicFocus}
            onChange={(e) => setGeographicFocus(e.target.value)}
            data-testid="input-geo-focus"
            required
          />
          <p className="text-xs text-muted-foreground">
            REQUIRED: All titles will include this location for local SEO optimization.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Semantic Cluster ID (Optional)</Label>
          <Input
            type="number"
            placeholder="Link to existing cluster"
            value={semanticClusterId || ""}
            onChange={(e) => setSemanticClusterId(e.target.value ? parseInt(e.target.value) : undefined)}
            data-testid="input-semantic-cluster"
          />
          <p className="text-xs text-muted-foreground">
            Link this batch to a semantic cluster for internal linking
          </p>
        </div>
    </div>
  );
}
