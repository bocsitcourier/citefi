"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, ArrowRight, Users, Globe, FileText, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface OnboardingStatus {
  isAgency: boolean;
  hasClients: boolean;
  hasPublishingConnection: boolean;
  hasContent: boolean;
  isComplete: boolean;
  stepsComplete: number;
}

const STEPS = [
  {
    id: 1,
    title: "Create your first client",
    description: "Add a client workspace to manage their SEO content and publishing separately from yours.",
    icon: Users,
  },
  {
    id: 2,
    title: "Connect a publishing destination",
    description: "Link a client website so generated articles are delivered automatically.",
    icon: Globe,
  },
  {
    id: 3,
    title: "Generate your first content batch",
    description: "Pick a topic and location to create your first set of local SEO articles.",
    icon: FileText,
  },
];

function StepIndicator({ step, current, done }: { step: number; current: number; done: boolean }) {
  const isActive = step === current;
  return (
    <div className={`flex items-center justify-center h-8 w-8 rounded-full text-sm font-semibold border-2 shrink-0 ${
      done ? "bg-primary border-primary text-primary-foreground" : isActive ? "border-primary text-primary" : "border-muted-foreground/30 text-muted-foreground"
    }`}>
      {done ? <CheckCircle2 className="h-4 w-4" /> : step}
    </div>
  );
}

function Step1CreateClient({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");

  const createMutation = useMutation({
    mutationFn: () => apiRequest("/api/agency/clients", { method: "POST", body: JSON.stringify({ name: name.trim(), billingPlan: "free" }) }),
    onSuccess: () => {
      toast({ title: "Client created", description: `"${name.trim()}" workspace is ready.` });
      onDone();
    },
    onError: (err: any) => {
      toast({ title: "Failed to create client", description: err?.message ?? "Please try again.", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="client-name">Client or business name</Label>
        <Input
          id="client-name"
          placeholder="Acme Plumbing Co."
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="input-client-name"
        />
      </div>
      <Button
        onClick={() => createMutation.mutate()}
        disabled={name.trim().length < 2 || createMutation.isPending}
        className="w-full"
        data-testid="button-create-client"
      >
        {createMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating...</> : <>Create workspace <ArrowRight className="h-4 w-4 ml-2" /></>}
      </Button>
    </div>
  );
}

function Step2Publishing({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Connect a publishing destination in Settings. Once you have an active connection, come back and continue.
      </p>
      <div className="flex flex-col gap-2">
        <Button onClick={() => router.push("/settings/publishing")} variant="outline" className="w-full justify-between" data-testid="button-go-publishing-settings">
          Open Publishing Settings
          <ExternalLink className="h-4 w-4 ml-2" />
        </Button>
        <Button onClick={onDone} variant="ghost" size="sm" className="w-full" data-testid="button-skip-publishing">
          Skip for now
        </Button>
      </div>
    </div>
  );
}

function Step3Content({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Head to the content generator to create your first batch of local SEO articles. Choose a topic, a location, and let Citefi build 50 optimized titles for you.
      </p>
      <div className="flex flex-col gap-2">
        <Button onClick={() => router.push("/client/generate")} className="w-full justify-between" data-testid="button-go-generate">
          Go to content generator
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
        <Button onClick={onDone} variant="ghost" size="sm" className="w-full" data-testid="button-skip-content">
          Skip for now
        </Button>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery<OnboardingStatus>({
    queryKey: ["/api/onboarding/status"],
    queryFn: () => apiRequest("/api/onboarding/status"),
    staleTime: 10_000,
  });

  const currentStep = !status ? 1 : status.hasClients ? (status.hasPublishingConnection ? 3 : 2) : 1;

  function handleStepDone() {
    queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
  }

  function handleFinish() {
    router.push("/client/dashboard");
    toast({ title: "Welcome to Citefi!", description: "Your agency workspace is ready." });
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status?.isComplete) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-4">
          <CheckCircle2 className="h-12 w-12 text-primary mx-auto" />
          <h1 className="text-2xl font-semibold">You&apos;re all set!</h1>
          <p className="text-muted-foreground text-sm">Your agency workspace is fully configured.</p>
          <Button onClick={() => router.push("/client/dashboard")} className="w-full" data-testid="button-go-dashboard">
            Go to dashboard <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
      <div className="max-w-lg w-full space-y-6">
        <div className="text-center space-y-1">
          <Badge variant="secondary" className="mb-2">Getting started</Badge>
          <h1 className="text-2xl font-semibold" data-testid="heading-onboarding">Set up your agency</h1>
          <p className="text-sm text-muted-foreground">Three quick steps to start generating local SEO content for your clients.</p>
        </div>

        <div className="space-y-3">
          {STEPS.map((step) => {
            const isDone = status ? (step.id === 1 ? status.hasClients : step.id === 2 ? status.hasPublishingConnection : status.hasContent) : false;
            const isActive = step.id === currentStep;
            const StepIcon = step.icon;

            return (
              <Card
                key={step.id}
                className={isActive ? "border-primary/50 shadow-sm" : ""}
                data-testid={`card-step-${step.id}`}
              >
                <CardHeader className="flex flex-row items-start gap-3 flex-wrap pb-2">
                  <StepIndicator step={step.id} current={currentStep} done={isDone} />
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2 flex-wrap">
                      {step.title}
                      {isDone && <Badge variant="secondary" className="text-xs">Done</Badge>}
                    </CardTitle>
                    <CardDescription className="text-xs mt-0.5">{step.description}</CardDescription>
                  </div>
                  <StepIcon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                </CardHeader>

                {isActive && !isDone && (
                  <CardContent className="pt-2">
                    {step.id === 1 && <Step1CreateClient onDone={handleStepDone} />}
                    {step.id === 2 && <Step2Publishing onDone={handleStepDone} />}
                    {step.id === 3 && <Step3Content onDone={handleFinish} />}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>

        <div className="text-center">
          <Button variant="ghost" size="sm" onClick={() => router.push("/client/dashboard")} data-testid="button-skip-onboarding">
            Skip onboarding for now
          </Button>
        </div>
      </div>
    </div>
  );
}
