"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useRouter } from "next/navigation";
import { Loader2, Settings, AlertCircle } from "lucide-react";

interface MaintenanceData {
  id: number;
  isEnabled: boolean;
  message: string;
}

export default function AdminSettingsPage() {
  const { toast } = useToast();
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState("");

  useEffect(() => {
    if (!isAuthLoading && user && user.role !== "admin") {
      router.replace("/home");
    }
  }, [user, isAuthLoading, router]);

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

  const { data: maintenanceData, isLoading } = useQuery<MaintenanceData>({
    queryKey: ["/api/admin/maintenance"],
    enabled: user.role === "admin",
  });

  const updateMaintenanceMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/admin/maintenance", {
        method: "POST",
        body: JSON.stringify({
          isEnabled: maintenanceEnabled,
          message: maintenanceMessage,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/maintenance"] });
      toast({
        title: "Settings updated",
        description: "Maintenance mode settings have been saved",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Update failed",
        description: error.message || "Failed to update maintenance mode",
      });
    },
  });

  useEffect(() => {
    if (maintenanceData) {
      setMaintenanceEnabled(maintenanceData.isEnabled);
      setMaintenanceMessage(maintenanceData.message);
    }
  }, [maintenanceData]);

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
        <h1 className="text-3xl font-bold" data-testid="text-admin-settings-title">System Settings</h1>
        <p className="text-muted-foreground">Configure system-wide settings and maintenance mode</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Maintenance Mode
          </CardTitle>
          <CardDescription>
            Enable maintenance mode to prevent users from accessing the system. Admins will still have access.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="maintenance-toggle" className="text-base font-medium">
                Enable Maintenance Mode
              </Label>
              <p className="text-sm text-muted-foreground">
                When enabled, only admins can access the system
              </p>
            </div>
            <Switch
              id="maintenance-toggle"
              checked={maintenanceEnabled}
              onCheckedChange={setMaintenanceEnabled}
              data-testid="switch-maintenance-mode"
            />
          </div>

          {maintenanceEnabled && (
            <div className="p-4 border-l-4 border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20 rounded">
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                ⚠️ Warning: Maintenance mode is enabled. Non-admin users will not be able to access the system.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="maintenance-message">Maintenance Message</Label>
            <Textarea
              id="maintenance-message"
              placeholder="Enter the message users will see during maintenance..."
              value={maintenanceMessage}
              onChange={(e) => setMaintenanceMessage(e.target.value)}
              rows={4}
              data-testid="textarea-maintenance-message"
            />
            <p className="text-sm text-muted-foreground">
              This message will be displayed to users when they try to access the system during maintenance.
            </p>
          </div>

          <Button
            onClick={() => updateMaintenanceMutation.mutate()}
            disabled={updateMaintenanceMutation.isPending}
            className="w-full"
            data-testid="button-save-settings"
          >
            {updateMaintenanceMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Settings"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
