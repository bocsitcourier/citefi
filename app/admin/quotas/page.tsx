"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useRouter } from "next/navigation";
import { Loader2, TrendingUp, BarChart, RefreshCw, Edit } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

interface QuotaData {
  id: number;
  userId: number;
  userEmail: string;
  userName: string | null;
  articlesPerDay: number;
  articlesPerMonth: number;
  socialsPerDay: number;
  socialsPerMonth: number;
  videosPerDay: number;
  videosPerMonth: number;
  currentDayArticles: number;
  currentMonthArticles: number;
  currentDaySocials: number;
  currentMonthSocials: number;
  currentDayVideos: number;
  currentMonthVideos: number;
  quotaPeriodStart: string;
}

export default function AdminQuotasPage() {
  const { toast } = useToast();
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedQuota, setSelectedQuota] = useState<QuotaData | null>(null);
  const [editValues, setEditValues] = useState({
    articlesPerDay: 0,
    articlesPerMonth: 0,
    socialsPerDay: 0,
    socialsPerMonth: 0,
    videosPerDay: 0,
    videosPerMonth: 0,
  });

  const { data: quotas, isLoading } = useQuery<QuotaData[]>({
    queryKey: ["/api/admin/quotas"],
    enabled: user?.role === "admin",
  });

  const updateQuotaMutation = useMutation({
    mutationFn: async () => {
      if (!selectedQuota) throw new Error("No quota selected");
      
      const cleanedValues = {
        articlesPerDay: Number(editValues.articlesPerDay) || 0,
        articlesPerMonth: Number(editValues.articlesPerMonth) || 0,
        socialsPerDay: Number(editValues.socialsPerDay) || 0,
        socialsPerMonth: Number(editValues.socialsPerMonth) || 0,
        videosPerDay: Number(editValues.videosPerDay) || 0,
        videosPerMonth: Number(editValues.videosPerMonth) || 0,
      };
      
      return apiRequest(`/api/admin/quotas/${selectedQuota.userId}`, {
        method: "PUT",
        body: JSON.stringify(cleanedValues),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/quotas"] });
      setEditDialogOpen(false);
      setSelectedQuota(null);
      toast({
        title: "Quota updated",
        description: "User quota limits have been updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Update failed",
        description: error.message || "Failed to update quota",
      });
    },
  });

  const resetQuotaMutation = useMutation({
    mutationFn: async (userId: number) => {
      return apiRequest(`/api/admin/quotas/${userId}`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/quotas"] });
      toast({
        title: "Quota reset",
        description: "User quota usage has been reset to zero",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Reset failed",
        description: error.message || "Failed to reset quota",
      });
    },
  });

  useEffect(() => {
    if (!isAuthLoading && user && user.role !== "admin") {
      router.replace("/home");
    }
  }, [user, isAuthLoading, router]);

  const handleEditQuota = (quota: QuotaData) => {
    setSelectedQuota(quota);
    setEditValues({
      articlesPerDay: quota.articlesPerDay,
      articlesPerMonth: quota.articlesPerMonth,
      socialsPerDay: quota.socialsPerDay,
      socialsPerMonth: quota.socialsPerMonth,
      videosPerDay: quota.videosPerDay,
      videosPerMonth: quota.videosPerMonth,
    });
    setEditDialogOpen(true);
  };

  const getUsagePercentage = (current: number, limit: number) => {
    if (limit === 0) return 0;
    return Math.min(100, (current / limit) * 100);
  };

  const getUsageBadge = (current: number, limit: number) => {
    const percentage = getUsagePercentage(current, limit);
    if (percentage >= 90) {
      return <Badge variant="destructive">Critical</Badge>;
    }
    if (percentage >= 70) {
      return <Badge variant="default" className="bg-orange-500">Warning</Badge>;
    }
    return <Badge variant="default" className="bg-green-500">Normal</Badge>;
  };

  if (isAuthLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return null;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-admin-quotas-title">Usage Quotas</h1>
        <p className="text-muted-foreground">Manage user content generation limits and monitor usage</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{quotas?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">At Risk (&gt;70%)</CardTitle>
            <BarChart className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {quotas?.filter(q => 
                getUsagePercentage(q.currentDayArticles, q.articlesPerDay) >= 70 ||
                getUsagePercentage(q.currentDaySocials, q.socialsPerDay) >= 70 ||
                getUsagePercentage(q.currentDayVideos, q.videosPerDay) >= 70
              ).length || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Exceeded Limits</CardTitle>
            <BarChart className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">
              {quotas?.filter(q => 
                q.currentDayArticles >= q.articlesPerDay ||
                q.currentDaySocials >= q.socialsPerDay ||
                q.currentDayVideos >= q.videosPerDay
              ).length || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>User Quotas</CardTitle>
          <CardDescription>View and manage content generation limits for all users</CardDescription>
        </CardHeader>
        <CardContent>
          {!quotas || quotas.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No quota data found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Articles (Day)</TableHead>
                  <TableHead>Articles (Month)</TableHead>
                  <TableHead>Socials (Day)</TableHead>
                  <TableHead>Videos (Day)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotas.map((quota) => (
                  <TableRow key={quota.id} data-testid={`row-quota-${quota.userId}`}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{quota.userName || "Unknown"}</div>
                        <div className="text-sm text-muted-foreground">{quota.userEmail}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="text-sm">
                          {quota.currentDayArticles} / {quota.articlesPerDay}
                        </div>
                        <Progress 
                          value={getUsagePercentage(quota.currentDayArticles, quota.articlesPerDay)} 
                          className="h-2"
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="text-sm">
                          {quota.currentMonthArticles} / {quota.articlesPerMonth}
                        </div>
                        <Progress 
                          value={getUsagePercentage(quota.currentMonthArticles, quota.articlesPerMonth)} 
                          className="h-2"
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="text-sm">
                          {quota.currentDaySocials} / {quota.socialsPerDay}
                        </div>
                        <Progress 
                          value={getUsagePercentage(quota.currentDaySocials, quota.socialsPerDay)} 
                          className="h-2"
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="text-sm">
                          {quota.currentDayVideos} / {quota.videosPerDay}
                        </div>
                        <Progress 
                          value={getUsagePercentage(quota.currentDayVideos, quota.videosPerDay)} 
                          className="h-2"
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      {getUsageBadge(
                        Math.max(
                          getUsagePercentage(quota.currentDayArticles, quota.articlesPerDay),
                          getUsagePercentage(quota.currentDaySocials, quota.socialsPerDay),
                          getUsagePercentage(quota.currentDayVideos, quota.videosPerDay)
                        ),
                        100
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEditQuota(quota)}
                          data-testid={`button-edit-quota-${quota.userId}`}
                        >
                          <Edit className="h-3 w-3 mr-1" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => resetQuotaMutation.mutate(quota.userId)}
                          disabled={resetQuotaMutation.isPending}
                          data-testid={`button-reset-quota-${quota.userId}`}
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Reset
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Quota Limits</DialogTitle>
            <DialogDescription>
              Update content generation limits for {selectedQuota?.userName || selectedQuota?.userEmail}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="articlesPerDay">Articles per Day</Label>
                <Input
                  id="articlesPerDay"
                  type="number"
                  value={editValues.articlesPerDay}
                  onChange={(e) => setEditValues({...editValues, articlesPerDay: parseInt(e.target.value) || 0})}
                  data-testid="input-articles-per-day"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="articlesPerMonth">Articles per Month</Label>
                <Input
                  id="articlesPerMonth"
                  type="number"
                  value={editValues.articlesPerMonth}
                  onChange={(e) => setEditValues({...editValues, articlesPerMonth: parseInt(e.target.value) || 0})}
                  data-testid="input-articles-per-month"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="socialsPerDay">Socials per Day</Label>
                <Input
                  id="socialsPerDay"
                  type="number"
                  value={editValues.socialsPerDay}
                  onChange={(e) => setEditValues({...editValues, socialsPerDay: parseInt(e.target.value) || 0})}
                  data-testid="input-socials-per-day"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="socialsPerMonth">Socials per Month</Label>
                <Input
                  id="socialsPerMonth"
                  type="number"
                  value={editValues.socialsPerMonth}
                  onChange={(e) => setEditValues({...editValues, socialsPerMonth: parseInt(e.target.value) || 0})}
                  data-testid="input-socials-per-month"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="videosPerDay">Videos per Day</Label>
                <Input
                  id="videosPerDay"
                  type="number"
                  value={editValues.videosPerDay}
                  onChange={(e) => setEditValues({...editValues, videosPerDay: parseInt(e.target.value) || 0})}
                  data-testid="input-videos-per-day"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="videosPerMonth">Videos per Month</Label>
                <Input
                  id="videosPerMonth"
                  type="number"
                  value={editValues.videosPerMonth}
                  onChange={(e) => setEditValues({...editValues, videosPerMonth: parseInt(e.target.value) || 0})}
                  data-testid="input-videos-per-month"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => updateQuotaMutation.mutate()}
              disabled={updateQuotaMutation.isPending}
              data-testid="button-save-quota"
            >
              {updateQuotaMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
