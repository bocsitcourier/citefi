"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { 
  Loader2, 
  Plus, 
  Calendar, 
  Trash2, 
  Play, 
  Pause, 
  CheckCircle2, 
  XCircle, 
  Clock,
  ArrowLeft,
  RefreshCw,
  Settings,
  Send
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface ContentSchedule {
  id: number;
  publicId: string;
  name: string;
  coreTopic: string;
  targetUrl: string;
  businessName: string;
  articlesPerRun: number;
  tone: string;
  cronExpression: string;
  timezone: string;
  autoPublishEnabled: number;
  autoPublishConnectionIds: number[] | null;
  status: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  totalRuns: number;
  totalArticlesGenerated: number;
  createdAt: string;
}

interface PublishingConnection {
  id: number;
  name: string;
  channel: string;
  status: string;
}

const SCHEDULE_PRESETS = [
  { value: "0 2 * * *", label: "Daily at 2 AM" },
  { value: "0 6 * * *", label: "Daily at 6 AM" },
  { value: "0 2 * * 1", label: "Weekly (Monday 2 AM)" },
  { value: "0 2 1 * *", label: "Monthly (1st at 2 AM)" },
  { value: "0 */4 * * *", label: "Every 4 hours" },
  { value: "0 */12 * * *", label: "Every 12 hours" },
];

const TONE_OPTIONS = [
  { value: "professional", label: "Professional" },
  { value: "casual", label: "Casual" },
  { value: "conversational", label: "Conversational" },
  { value: "technical", label: "Technical" },
  { value: "educational", label: "Educational" },
  { value: "authoritative", label: "Authoritative" },
];

function getStatusBadge(status: string) {
  switch (status) {
    case "active":
      return <Badge variant="default" className="bg-green-600" data-testid="status-active"><Play className="w-3 h-3 mr-1" />Active</Badge>;
    case "paused":
      return <Badge variant="secondary" data-testid="status-paused"><Pause className="w-3 h-3 mr-1" />Paused</Badge>;
    case "disabled":
      return <Badge variant="destructive" data-testid="status-disabled"><XCircle className="w-3 h-3 mr-1" />Disabled</Badge>;
    default:
      return <Badge variant="outline" data-testid="status-unknown">{status}</Badge>;
  }
}

function formatNextRun(nextRunAt: string | null) {
  if (!nextRunAt) return "Not scheduled";
  const date = new Date(nextRunAt);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  
  if (diff < 0) return "Running soon...";
  if (diff < 3600000) return `In ${Math.round(diff / 60000)} minutes`;
  if (diff < 86400000) return `In ${Math.round(diff / 3600000)} hours`;
  return date.toLocaleString();
}

function getCronDescription(cron: string) {
  const preset = SCHEDULE_PRESETS.find(p => p.value === cron);
  if (preset) return preset.label;
  return cron;
}

export default function SchedulesPage() {
  const { toast } = useToast();
  const [showAddDialog, setShowAddDialog] = useState(false);
  
  const [newScheduleName, setNewScheduleName] = useState("");
  const [newCoreTopic, setNewCoreTopic] = useState("");
  const [newTargetUrl, setNewTargetUrl] = useState("");
  const [newBusinessName, setNewBusinessName] = useState("");
  const [newArticlesPerRun, setNewArticlesPerRun] = useState(5);
  const [newTone, setNewTone] = useState("professional");
  const [newCronExpression, setNewCronExpression] = useState("0 2 * * *");
  const [newAutoPublishEnabled, setNewAutoPublishEnabled] = useState(true);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<Set<number>>(new Set());

  const { data: schedulesResponse, isLoading } = useQuery<{ success: boolean; data: ContentSchedule[] }>({
    queryKey: ["/api/schedules"],
  });

  const { data: connectionsResponse } = useQuery<{ success: boolean; data: PublishingConnection[] }>({
    queryKey: ["/api/publishing/connections"],
  });

  const schedules = schedulesResponse?.data || [];
  const connections = connectionsResponse?.data?.filter(c => c.status === "active") || [];

  const createScheduleMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("/api/schedules", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      toast({
        title: "Schedule created",
        description: "Your content will be generated automatically on schedule.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      setShowAddDialog(false);
      resetForm();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create schedule",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateScheduleMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      return await apiRequest(`/api/schedules/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      toast({ title: "Schedule updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update schedule",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest(`/api/schedules/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      toast({ title: "Schedule deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete schedule",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setNewScheduleName("");
    setNewCoreTopic("");
    setNewTargetUrl("");
    setNewBusinessName("");
    setNewArticlesPerRun(5);
    setNewTone("professional");
    setNewCronExpression("0 2 * * *");
    setNewAutoPublishEnabled(true);
    setSelectedConnectionIds(new Set());
  };

  const toggleConnection = (connectionId: number) => {
    const newSelected = new Set(selectedConnectionIds);
    if (newSelected.has(connectionId)) {
      newSelected.delete(connectionId);
    } else {
      newSelected.add(connectionId);
    }
    setSelectedConnectionIds(newSelected);
  };

  const handleCreateSchedule = () => {
    if (!newScheduleName || !newCoreTopic || !newTargetUrl || !newBusinessName) {
      toast({
        title: "Missing required fields",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }

    createScheduleMutation.mutate({
      name: newScheduleName,
      coreTopic: newCoreTopic,
      targetUrl: newTargetUrl,
      businessName: newBusinessName,
      articlesPerRun: newArticlesPerRun,
      tone: newTone,
      cronExpression: newCronExpression,
      autoPublishEnabled: newAutoPublishEnabled,
      autoPublishConnectionIds: Array.from(selectedConnectionIds),
    });
  };

  const toggleScheduleStatus = (schedule: ContentSchedule) => {
    const newStatus = schedule.status === "active" ? "paused" : "active";
    updateScheduleMutation.mutate({
      id: schedule.id,
      data: { status: newStatus },
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard">
              <Button variant="outline" size="sm" data-testid="button-back">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">Content Schedules</h1>
              <p className="text-sm text-muted-foreground">Automatically generate and publish content while you sleep</p>
            </div>
          </div>

          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-schedule">
                <Plus className="w-4 h-4 mr-2" />
                New Schedule
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create Content Schedule</DialogTitle>
                <DialogDescription>
                  Set up automatic content generation on a schedule
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="scheduleName">Schedule Name *</Label>
                  <Input
                    id="scheduleName"
                    placeholder="e.g., Daily Blog Posts"
                    value={newScheduleName}
                    onChange={(e) => setNewScheduleName(e.target.value)}
                    data-testid="input-schedule-name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="coreTopic">Core Topic *</Label>
                  <Input
                    id="coreTopic"
                    placeholder="e.g., Digital Marketing Tips"
                    value={newCoreTopic}
                    onChange={(e) => setNewCoreTopic(e.target.value)}
                    data-testid="input-core-topic"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="targetUrl">Target URL *</Label>
                    <Input
                      id="targetUrl"
                      placeholder="https://example.com"
                      value={newTargetUrl}
                      onChange={(e) => setNewTargetUrl(e.target.value)}
                      data-testid="input-target-url"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="businessName">Business Name *</Label>
                    <Input
                      id="businessName"
                      placeholder="Your Company"
                      value={newBusinessName}
                      onChange={(e) => setNewBusinessName(e.target.value)}
                      data-testid="input-business-name"
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="articlesPerRun">Articles per Run</Label>
                    <Input
                      id="articlesPerRun"
                      type="number"
                      min={1}
                      max={25}
                      value={newArticlesPerRun}
                      onChange={(e) => setNewArticlesPerRun(parseInt(e.target.value) || 5)}
                      data-testid="input-articles-per-run"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tone">Tone</Label>
                    <Select value={newTone} onValueChange={setNewTone}>
                      <SelectTrigger data-testid="select-tone">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TONE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="schedule">Schedule</Label>
                  <Select value={newCronExpression} onValueChange={setNewCronExpression}>
                    <SelectTrigger data-testid="select-schedule">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCHEDULE_PRESETS.map((preset) => (
                        <SelectItem key={preset.value} value={preset.value}>
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-4 border-t pt-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="flex items-center gap-2">
                        <Send className="w-4 h-4" />
                        Auto-Publish When Complete
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Automatically publish articles after generation
                      </p>
                    </div>
                    <Switch
                      checked={newAutoPublishEnabled}
                      onCheckedChange={setNewAutoPublishEnabled}
                      data-testid="switch-auto-publish"
                    />
                  </div>

                  {newAutoPublishEnabled && connections.length > 0 && (
                    <div className="space-y-2 pl-6 border-l-2 border-primary/20">
                      <Label className="text-sm">Select Destinations</Label>
                      <div className="space-y-2">
                        {connections.map((connection) => (
                          <div
                            key={connection.id}
                            className="flex items-center gap-3 p-2 rounded border"
                          >
                            <Checkbox
                              id={`connection-${connection.id}`}
                              checked={selectedConnectionIds.has(connection.id)}
                              onCheckedChange={() => toggleConnection(connection.id)}
                            />
                            <label htmlFor={`connection-${connection.id}`} className="flex-1 cursor-pointer">
                              <span className="text-sm font-medium">{connection.name}</span>
                              <Badge variant="outline" className="ml-2 text-xs">{connection.channel}</Badge>
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {newAutoPublishEnabled && connections.length === 0 && (
                    <p className="text-sm text-muted-foreground pl-6 border-l-2 border-primary/20">
                      No active publishing connections. <Link href="/settings/publishing" className="text-primary underline">Set up connections</Link> first.
                    </p>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleCreateSchedule} 
                  disabled={createScheduleMutation.isPending}
                  data-testid="button-create-schedule"
                >
                  {createScheduleMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  <Calendar className="w-4 h-4 mr-2" />
                  Create Schedule
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {schedules.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Calendar className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Schedules Yet</h3>
              <p className="text-muted-foreground text-center mb-4">
                Create a schedule to automatically generate and publish content while you sleep.
              </p>
              <Button onClick={() => setShowAddDialog(true)} data-testid="button-create-first">
                <Plus className="w-4 h-4 mr-2" />
                Create Your First Schedule
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {schedules.map((schedule) => (
              <Card key={schedule.id} data-testid={`schedule-card-${schedule.id}`}>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg">{schedule.name}</CardTitle>
                      {getStatusBadge(schedule.status)}
                    </div>
                    <CardDescription>{schedule.coreTopic}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleScheduleStatus(schedule)}
                      disabled={updateScheduleMutation.isPending}
                      data-testid={`button-toggle-${schedule.id}`}
                    >
                      {schedule.status === "active" ? (
                        <>
                          <Pause className="w-4 h-4 mr-1" />
                          Pause
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 mr-1" />
                          Resume
                        </>
                      )}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" data-testid={`button-delete-${schedule.id}`}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Schedule</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete "{schedule.name}"? This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteScheduleMutation.mutate(schedule.id)}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Schedule</p>
                      <p className="font-medium">{getCronDescription(schedule.cronExpression)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Next Run</p>
                      <p className="font-medium flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatNextRun(schedule.nextRunAt)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Articles/Run</p>
                      <p className="font-medium">{schedule.articlesPerRun}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Total Generated</p>
                      <p className="font-medium">{schedule.totalArticlesGenerated} articles ({schedule.totalRuns} runs)</p>
                    </div>
                  </div>
                  {schedule.autoPublishEnabled === 1 && (
                    <div className="mt-3 pt-3 border-t flex items-center gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      Auto-publishing enabled
                      {schedule.autoPublishConnectionIds && schedule.autoPublishConnectionIds.length > 0 && (
                        <span>to {schedule.autoPublishConnectionIds.length} destination(s)</span>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
