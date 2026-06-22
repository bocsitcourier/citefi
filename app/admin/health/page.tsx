"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2, Activity, Database, HardDrive, Cpu, Clock, AlertCircle, Zap } from "lucide-react";

interface SystemHealthData {
  memory: {
    total: number;
    free: number;
    used: number;
    percentage: number;
  };
  cpu: {
    loadAverage: number;
    cores: number;
  };
  uptime: number;
  database: {
    size: number;
    activeConnections: number;
  };
  queue: {
    activeJobs: number;
    completedJobs: number;
    failedJobs: number;
    retryJobs: number;
  };
  timestamp: string;
}

interface OpenAIStatsData {
  openai: {
    totalCalls: number;
    totalRetries: number;
    totalFailures: number;
    queueSize: number;
    activeRequests: number;
    errorRate: number;
    retryRate: number;
    successRate: number;
  };
  health: {
    status: "healthy" | "warning" | "critical";
    message: string;
  };
  timestamp: string;
}

export default function AdminHealthPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthLoading && (!user || user.role !== "admin")) {
      router.push("/login");
    }
  }, [user, isAuthLoading, router]);

  const { data: health, isLoading } = useQuery<SystemHealthData>({
    queryKey: ["/api/admin/system-health"],
    enabled: user?.role === "admin",
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
  });

  const { data: openaiStats, isLoading: isOpenAILoading } = useQuery<OpenAIStatsData>({
    queryKey: ["/api/admin/openai-stats"],
    enabled: user?.role === "admin",
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });

  const formatBytes = (bytes: number) => {
    const gb = bytes / (1024 ** 3);
    return gb.toFixed(2) + " GB";
  };

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
  };

  const getHealthStatus = (percentage: number) => {
    if (percentage >= 90) return { label: "Critical", color: "destructive" };
    if (percentage >= 70) return { label: "Warning", color: "default" };
    return { label: "Healthy", color: "default" };
  };

  if (isLoading || isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!health) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">No health data available</p>
      </div>
    );
  }

  const memoryStatus = getHealthStatus(health.memory.percentage);
  const cpuStatus = getHealthStatus((health.cpu.loadAverage / health.cpu.cores) * 100);

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-system-health-title">System Health</h1>
        <p className="text-muted-foreground">Real-time monitoring of system resources and queue status</p>
      </div>

      {/* Resource Overview */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Memory Usage</CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{health.memory.percentage.toFixed(1)}%</div>
            <Progress value={health.memory.percentage} className="mt-2" />
            <p className="text-xs text-muted-foreground mt-2">
              {formatBytes(health.memory.used)} / {formatBytes(health.memory.total)}
            </p>
            <Badge variant={memoryStatus.color as any} className="mt-2">
              {memoryStatus.label}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">CPU Load</CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{health.cpu.loadAverage.toFixed(2)}</div>
            <Progress value={(health.cpu.loadAverage / health.cpu.cores) * 100} className="mt-2" />
            <p className="text-xs text-muted-foreground mt-2">
              {health.cpu.cores} cores available
            </p>
            <Badge variant={cpuStatus.color as any} className="mt-2">
              {cpuStatus.label}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">System Uptime</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatUptime(health.uptime)}</div>
            <p className="text-xs text-muted-foreground mt-2">
              Since last restart
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Database Size</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatBytes(health.database.size)}</div>
            <p className="text-xs text-muted-foreground mt-2">
              {health.database.activeConnections} active connections
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Queue Status */}
      <Card>
        <CardHeader>
          <CardTitle>Job Queue Status</CardTitle>
          <CardDescription>Real-time monitoring of background job processing</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Active Jobs</p>
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-blue-500" />
                <span className="text-2xl font-bold">{health.queue.activeJobs}</span>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Completed Jobs</p>
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-green-500" />
                <span className="text-2xl font-bold">{health.queue.completedJobs}</span>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Failed Jobs</p>
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-destructive" />
                <span className="text-2xl font-bold">{health.queue.failedJobs}</span>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Retry Queue</p>
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-yellow-500" />
                <span className="text-2xl font-bold">{health.queue.retryJobs}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* OpenAI API Metrics */}
      {openaiStats && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>OpenAI API Metrics</CardTitle>
                <CardDescription>Real-time monitoring of OpenAI integration health and performance</CardDescription>
              </div>
              <Badge variant={
                openaiStats.health.status === "healthy" ? "default" :
                openaiStats.health.status === "warning" ? "default" : "destructive"
              }>
                {openaiStats.health.status === "healthy" ? "Healthy" :
                 openaiStats.health.status === "warning" ? "Warning" : "Critical"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-3">
              {/* Success Rate */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">Success Rate</p>
                  <Zap className="h-4 w-4 text-green-500" />
                </div>
                <div className="text-3xl font-bold">{openaiStats.openai.successRate}%</div>
                <Progress value={openaiStats.openai.successRate} className="mt-2" />
                <p className="text-xs text-muted-foreground">
                  {openaiStats.openai.totalCalls - openaiStats.openai.totalFailures} / {openaiStats.openai.totalCalls} successful
                </p>
              </div>

              {/* Error Rate */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">Error Rate</p>
                  <AlertCircle className={`h-4 w-4 ${
                    openaiStats.openai.errorRate < 2 ? "text-green-500" :
                    openaiStats.openai.errorRate < 10 ? "text-yellow-500" : "text-destructive"
                  }`} />
                </div>
                <div className="text-3xl font-bold">{openaiStats.openai.errorRate}%</div>
                <Progress value={openaiStats.openai.errorRate} className="mt-2" />
                <p className="text-xs text-muted-foreground">
                  {openaiStats.openai.totalFailures} failures (Target: &lt;2%)
                </p>
              </div>

              {/* Retry Rate */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">Retry Rate</p>
                  <Activity className="h-4 w-4 text-blue-500" />
                </div>
                <div className="text-3xl font-bold">{openaiStats.openai.retryRate}%</div>
                <Progress value={openaiStats.openai.retryRate} className="mt-2" />
                <p className="text-xs text-muted-foreground">
                  {openaiStats.openai.totalRetries} retries across all calls
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Total API Calls</p>
                <div className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-blue-500" />
                  <span className="text-2xl font-bold">{openaiStats.openai.totalCalls.toLocaleString()}</span>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Queue Size</p>
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-yellow-500" />
                  <span className="text-2xl font-bold">{openaiStats.openai.queueSize}</span>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Active Requests</p>
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-green-500" />
                  <span className="text-2xl font-bold">{openaiStats.openai.activeRequests}</span>
                </div>
              </div>
            </div>

            {openaiStats.health.status !== "healthy" && (
              <div className="mt-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  ⚠️ {openaiStats.health.message}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Last updated: {new Date(health.timestamp).toLocaleString()}
      </p>
    </div>
  );
}
