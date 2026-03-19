"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Trash2, Play, Clock, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type CleanupJobType = "media" | "logs" | "orphans" | "sessions";
type CleanupStatus = "RUNNING" | "COMPLETE" | "FAILED";

interface CleanupJob {
  id: number;
  jobType: CleanupJobType;
  status: CleanupStatus;
  dryRun: number;
  itemsProcessed: number | null;
  itemsDeleted: number | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface CleanupDefaults {
  media: number;
  logs: number;
  orphans: number;
  sessions: number;
}

export default function AdminCleanupPage() {
  const { toast } = useToast();
  const [selectedJobType, setSelectedJobType] = useState<CleanupJobType>("media");
  const [dryRun, setDryRun] = useState(true);
  const [customRetention, setCustomRetention] = useState<number | null>(null);

  // Fetch cleanup data
  const { data, isLoading } = useQuery<{
    jobs: CleanupJob[];
    defaults: CleanupDefaults;
    config: any[];
  }>({
    queryKey: ["/api/cleanup"],
  });

  // Manual trigger mutation
  const triggerMutation = useMutation({
    mutationFn: async (params: {
      jobType: CleanupJobType;
      dryRun: boolean;
      retentionDays?: number;
    }) => {
      return apiRequest("/api/cleanup", {
        method: "POST",
        body: JSON.stringify(params),
        headers: { "Content-Type": "application/json" },
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Cleanup Job Queued",
        description: data.message || "Cleanup job has been queued successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/cleanup"] });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Queue Cleanup",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const handleTriggerCleanup = () => {
    triggerMutation.mutate({
      jobType: selectedJobType,
      dryRun,
      retentionDays: customRetention || undefined,
    });
  };

  const getStatusIcon = (status: CleanupStatus) => {
    switch (status) {
      case "RUNNING":
        return <Clock className="h-4 w-4 text-blue-500" />;
      case "COMPLETE":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "FAILED":
        return <XCircle className="h-4 w-4 text-red-500" />;
    }
  };

  const getStatusColor = (status: CleanupStatus) => {
    switch (status) {
      case "RUNNING":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "COMPLETE":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "FAILED":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
    }
  };

  const jobTypeLabels: Record<CleanupJobType, string> = {
    media: "Soft-Deleted Media",
    logs: "Activity Logs",
    orphans: "Orphaned Assets",
    sessions: "Inactive Sessions",
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Cleanup Management</h1>
        <p className="text-muted-foreground mt-2">
          Manage data retention policies and cleanup jobs
        </p>
      </div>

      {/* Manual Trigger Card */}
      <Card data-testid="card-manual-cleanup">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            Manual Cleanup Trigger
          </CardTitle>
          <CardDescription>
            Manually trigger cleanup jobs for testing or immediate cleanup needs
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="jobType">Cleanup Type</Label>
              <Select
                value={selectedJobType}
                onValueChange={(value) => setSelectedJobType(value as CleanupJobType)}
              >
                <SelectTrigger id="jobType" data-testid="select-job-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="media">
                    Soft-Deleted Media ({data?.defaults.media || 30} days)
                  </SelectItem>
                  <SelectItem value="logs">
                    Activity Logs ({data?.defaults.logs || 90} days)
                  </SelectItem>
                  <SelectItem value="orphans">
                    Orphaned Assets ({data?.defaults.orphans || 3} days)
                  </SelectItem>
                  <SelectItem value="sessions">
                    Inactive Sessions ({data?.defaults.sessions || 7} days)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="customRetention">Custom Retention (days)</Label>
              <Input
                id="customRetention"
                type="number"
                min={7}
                max={365}
                placeholder={`Default: ${data?.defaults[selectedJobType] || 30}`}
                value={customRetention || ""}
                onChange={(e) =>
                  setCustomRetention(e.target.value ? parseInt(e.target.value) : null)
                }
                data-testid="input-custom-retention"
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="dryRun"
              checked={dryRun}
              onCheckedChange={setDryRun}
              data-testid="switch-dry-run"
            />
            <Label htmlFor="dryRun" className="cursor-pointer">
              Dry Run (preview without deleting)
            </Label>
          </div>

          <Button
            onClick={handleTriggerCleanup}
            disabled={triggerMutation.isPending}
            data-testid="button-trigger-cleanup"
          >
            <Play className="h-4 w-4 mr-2" />
            {triggerMutation.isPending ? "Queueing..." : "Trigger Cleanup"}
          </Button>
        </CardContent>
      </Card>

      {/* Retention Policies Card */}
      <Card data-testid="card-retention-policies">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5" />
            Retention Policies
          </CardTitle>
          <CardDescription>
            Default retention periods for automated cleanup
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Object.entries(jobTypeLabels).map(([type, label]) => (
              <div key={type} className="space-y-2">
                <Label className="text-sm font-medium">{label}</Label>
                <div className="text-2xl font-bold">
                  {data?.defaults[type as CleanupJobType] || 30}
                  <span className="text-sm font-normal text-muted-foreground ml-1">days</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Cleanup Jobs */}
      <Card data-testid="card-recent-jobs">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Recent Cleanup Jobs
          </CardTitle>
          <CardDescription>History of cleanup job executions</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-center py-8">Loading cleanup history...</p>
          ) : !data?.jobs || data.jobs.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No cleanup jobs found</p>
          ) : (
            <div className="space-y-3">
              {data.jobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                  data-testid={`cleanup-job-${job.id}`}
                >
                  <div className="flex items-center gap-4">
                    {getStatusIcon(job.status)}
                    <div>
                      <div className="font-medium">{jobTypeLabels[job.jobType]}</div>
                      <div className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {job.status === "COMPLETE" && (
                      <div className="text-sm text-right">
                        <div className="font-medium">
                          {job.itemsProcessed || 0} processed
                        </div>
                        <div className="text-muted-foreground">
                          {job.itemsDeleted || 0} deleted
                        </div>
                      </div>
                    )}

                    {job.status === "FAILED" && job.errorMessage && (
                      <div className="text-sm text-red-600 max-w-xs truncate">
                        {job.errorMessage}
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Badge className={getStatusColor(job.status)}>
                        {job.status}
                      </Badge>
                      {job.dryRun === 1 && (
                        <Badge variant="outline">DRY RUN</Badge>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
