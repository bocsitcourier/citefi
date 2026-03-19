"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { 
  Loader2, 
  Users, 
  Plus, 
  Sparkles,
  Brain,
  Heart,
  Zap,
  Shield,
  Target,
  Edit,
  Trash2,
  Star,
  RefreshCw,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Progress } from "@/components/ui/progress";

interface Persona {
  id: number;
  publicId: string;
  name: string;
  description: string | null;
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
  riskTolerance: number;
  decisionStyle: string;
  preferredTone: string;
  preferredContentLength: string;
  isDefault: number;
  totalContentGenerated: number;
  avgEngagementRate: number;
}

const OCEAN_LABELS = {
  openness: { icon: Sparkles, color: "text-purple-500", lowLabel: "Traditional", highLabel: "Creative" },
  conscientiousness: { icon: Target, color: "text-blue-500", lowLabel: "Flexible", highLabel: "Detail-oriented" },
  extraversion: { icon: Zap, color: "text-yellow-500", lowLabel: "Reflective", highLabel: "Outgoing" },
  agreeableness: { icon: Heart, color: "text-pink-500", lowLabel: "Competitive", highLabel: "Cooperative" },
  neuroticism: { icon: Shield, color: "text-green-500", lowLabel: "Calm", highLabel: "Sensitive" },
};

const TONE_OPTIONS = ["professional", "casual", "authoritative", "friendly", "urgent", "reassuring"];
const DECISION_STYLES = ["analytical", "emotional", "balanced", "impulsive"];
const CONTENT_LENGTHS = ["short", "medium", "long", "detailed"];

export default function PersonasPage() {
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    openness: 50,
    conscientiousness: 50,
    extraversion: 50,
    agreeableness: 50,
    neuroticism: 50,
    riskTolerance: 50,
    decisionStyle: "balanced",
    preferredTone: "professional",
    preferredContentLength: "medium",
    isDefault: false,
  });

  const { data: personasData, isLoading, refetch } = useQuery<{ success: boolean; personas: Persona[] }>({
    queryKey: ["/api/personas"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return apiRequest("/api/personas", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      toast({ title: "Persona created", description: "Your new audience persona is ready" });
      queryClient.invalidateQueries({ queryKey: ["/api/personas"] });
      setIsCreateOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({ title: "Failed to create persona", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof formData }) => {
      return apiRequest(`/api/personas/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      toast({ title: "Persona updated", description: "Changes saved successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/personas"] });
      setEditingPersona(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({ title: "Failed to update persona", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/personas/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      toast({ title: "Persona deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/personas"] });
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete persona", description: error.message, variant: "destructive" });
    },
  });

  const initializeMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/personas/initialize", { method: "POST" });
    },
    onSuccess: () => {
      toast({ title: "Personas initialized", description: "5 preset personas have been added" });
      queryClient.invalidateQueries({ queryKey: ["/api/personas"] });
    },
    onError: (error: any) => {
      toast({ title: "Failed to initialize", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      openness: 50,
      conscientiousness: 50,
      extraversion: 50,
      agreeableness: 50,
      neuroticism: 50,
      riskTolerance: 50,
      decisionStyle: "balanced",
      preferredTone: "professional",
      preferredContentLength: "medium",
      isDefault: false,
    });
  };

  const loadPersonaForEdit = (persona: Persona) => {
    setFormData({
      name: persona.name,
      description: persona.description || "",
      openness: persona.openness,
      conscientiousness: persona.conscientiousness,
      extraversion: persona.extraversion,
      agreeableness: persona.agreeableness,
      neuroticism: persona.neuroticism,
      riskTolerance: persona.riskTolerance,
      decisionStyle: persona.decisionStyle || "balanced",
      preferredTone: persona.preferredTone || "professional",
      preferredContentLength: persona.preferredContentLength || "medium",
      isDefault: persona.isDefault === 1,
    });
    setEditingPersona(persona);
  };

  const handleSubmit = () => {
    if (!formData.name) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }

    if (editingPersona) {
      updateMutation.mutate({ id: editingPersona.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const personas = personasData?.personas || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const PersonaForm = () => (
    <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-2">
      <div className="space-y-2">
        <Label htmlFor="name">Persona Name</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="e.g., Health-Conscious Professional"
          data-testid="input-persona-name"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Describe this persona's characteristics..."
          data-testid="input-persona-description"
        />
      </div>

      <div className="border-t pt-4">
        <h4 className="font-semibold mb-4 flex items-center gap-2">
          <Brain className="w-4 h-4" />
          OCEAN Personality Traits
        </h4>
        
        {Object.entries(OCEAN_LABELS).map(([trait, config]) => {
          const Icon = config.icon;
          const value = formData[trait as keyof typeof formData] as number;
          
          return (
            <div key={trait} className="space-y-2 mb-4">
              <div className="flex justify-between items-center">
                <Label className="flex items-center gap-2 capitalize">
                  <Icon className={`w-4 h-4 ${config.color}`} />
                  {trait}
                </Label>
                <span className="text-sm text-muted-foreground">{value}%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-20">{config.lowLabel}</span>
                <Slider
                  value={[value]}
                  onValueChange={(v) => setFormData({ ...formData, [trait]: v[0] })}
                  max={100}
                  step={5}
                  className="flex-1"
                  data-testid={`slider-${trait}`}
                />
                <span className="text-xs text-muted-foreground w-24 text-right">{config.highLabel}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t pt-4 space-y-4">
        <h4 className="font-semibold">Messaging Preferences</h4>
        
        <div className="space-y-2">
          <Label>Risk Tolerance</Label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-20">Risk-averse</span>
            <Slider
              value={[formData.riskTolerance]}
              onValueChange={(v) => setFormData({ ...formData, riskTolerance: v[0] })}
              max={100}
              step={5}
              className="flex-1"
              data-testid="slider-risk-tolerance"
            />
            <span className="text-xs text-muted-foreground w-24 text-right">Risk-seeking</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Decision Style</Label>
            <Select
              value={formData.decisionStyle}
              onValueChange={(v) => setFormData({ ...formData, decisionStyle: v })}
            >
              <SelectTrigger data-testid="select-decision-style">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DECISION_STYLES.map((style) => (
                  <SelectItem key={style} value={style} className="capitalize">
                    {style}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Preferred Tone</Label>
            <Select
              value={formData.preferredTone}
              onValueChange={(v) => setFormData({ ...formData, preferredTone: v })}
            >
              <SelectTrigger data-testid="select-tone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TONE_OPTIONS.map((tone) => (
                  <SelectItem key={tone} value={tone} className="capitalize">
                    {tone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Preferred Content Length</Label>
          <Select
            value={formData.preferredContentLength}
            onValueChange={(v) => setFormData({ ...formData, preferredContentLength: v })}
          >
            <SelectTrigger data-testid="select-content-length">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTENT_LENGTHS.map((length) => (
                <SelectItem key={length} value={length} className="capitalize">
                  {length}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button
          variant="outline"
          onClick={() => {
            setIsCreateOpen(false);
            setEditingPersona(null);
            resetForm();
          }}
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={createMutation.isPending || updateMutation.isPending}
          data-testid="button-save-persona"
        >
          {(createMutation.isPending || updateMutation.isPending) && (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          )}
          {editingPersona ? "Update Persona" : "Create Persona"}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Users className="w-6 h-6" />
            Audience Personas
          </h1>
          <p className="text-muted-foreground mt-1">
            Define target audiences using OCEAN personality traits for psychographic content targeting
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => refetch()}
            data-testid="button-refresh"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          
          {personas.length === 0 && (
            <Button
              variant="outline"
              onClick={() => initializeMutation.mutate()}
              disabled={initializeMutation.isPending}
              data-testid="button-initialize"
            >
              {initializeMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-2" />
              )}
              Add Presets
            </Button>
          )}

          <Dialog open={isCreateOpen || !!editingPersona} onOpenChange={(open) => {
            if (!open) {
              setIsCreateOpen(false);
              setEditingPersona(null);
              resetForm();
            }
          }}>
            <DialogTrigger asChild>
              <Button onClick={() => setIsCreateOpen(true)} data-testid="button-create-persona">
                <Plus className="w-4 h-4 mr-2" />
                Create Persona
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>
                  {editingPersona ? "Edit Persona" : "Create New Persona"}
                </DialogTitle>
                <DialogDescription>
                  Define your target audience's personality profile using OCEAN traits
                </DialogDescription>
              </DialogHeader>
              <PersonaForm />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-primary/10">
                <Users className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-total-personas">{personas.length}</p>
                <p className="text-sm text-muted-foreground">Active Personas</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-green-500/10">
                <Target className="w-6 h-6 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-total-content">
                  {personas.reduce((sum, p) => sum + p.totalContentGenerated, 0)}
                </p>
                <p className="text-sm text-muted-foreground">Content Generated</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-blue-500/10">
                <Brain className="w-6 h-6 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-avg-engagement">
                  {personas.length > 0 
                    ? Math.round(personas.reduce((sum, p) => sum + p.avgEngagementRate, 0) / personas.length)
                    : 0}%
                </p>
                <p className="text-sm text-muted-foreground">Avg Engagement</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Your Personas</h2>
        
        {personas.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="mb-4">No personas yet. Create one or add preset personas to get started.</p>
              <Button
                onClick={() => initializeMutation.mutate()}
                disabled={initializeMutation.isPending}
                data-testid="button-add-presets"
              >
                {initializeMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4 mr-2" />
                )}
                Add 5 Preset Personas
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {personas.map((persona) => (
              <Card key={persona.id} data-testid={`card-persona-${persona.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        {persona.name}
                        {persona.isDefault === 1 && (
                          <Badge variant="secondary" className="text-xs">
                            <Star className="w-3 h-3 mr-1" />
                            Default
                          </Badge>
                        )}
                      </CardTitle>
                      {persona.description && (
                        <CardDescription className="mt-1">
                          {persona.description}
                        </CardDescription>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => loadPersonaForEdit(persona)}
                        data-testid={`button-edit-${persona.id}`}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteMutation.mutate(persona.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-${persona.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="grid grid-cols-5 gap-2">
                      {Object.entries(OCEAN_LABELS).map(([trait, config]) => {
                        const Icon = config.icon;
                        const value = persona[trait as keyof typeof persona] as number;
                        return (
                          <div key={trait} className="text-center">
                            <Icon className={`w-4 h-4 mx-auto ${config.color}`} />
                            <Progress value={value} className="h-1 mt-1" />
                            <span className="text-xs text-muted-foreground">{value}</span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex flex-wrap gap-2 pt-2 border-t">
                      <Badge variant="outline">{persona.preferredTone}</Badge>
                      <Badge variant="outline">{persona.decisionStyle}</Badge>
                      <Badge variant="outline">{persona.preferredContentLength}</Badge>
                    </div>

                    <div className="flex justify-between text-sm text-muted-foreground pt-2">
                      <span>{persona.totalContentGenerated} content pieces</span>
                      <span>{persona.avgEngagementRate}% engagement</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            How Psychographic Targeting Works
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-muted/30">
              <h4 className="font-medium text-foreground mb-2">OCEAN Personality Model</h4>
              <p>The Big Five personality traits (Openness, Conscientiousness, Extraversion, Agreeableness, Neuroticism) predict how people respond to messaging.</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/30">
              <h4 className="font-medium text-foreground mb-2">Adaptive Messaging</h4>
              <p>Content is automatically adjusted based on persona traits - tone, length, persuasion techniques, and CTAs are optimized for each audience.</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/30">
              <h4 className="font-medium text-foreground mb-2">Behavioral Learning</h4>
              <p>The system learns from engagement patterns to refine persona profiles and improve content performance over time.</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/30">
              <h4 className="font-medium text-foreground mb-2">Combined with AI Learning</h4>
              <p>Persona targeting integrates with the AI Learning System - successful patterns for each persona are remembered and reused.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
