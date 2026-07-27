"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Sparkles, Clock, Globe, Mail, Bell, CalendarDays } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertDailyBriefPreferenceSchema } from "@/shared/schema";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel } from "@/components/ui/form";
import * as z from "zod";

const briefSettingsSchema = insertDailyBriefPreferenceSchema.extend({
  emailEnabled: z.number(),
  inAppEnabled: z.number(),
});

type BriefSettingsValues = z.infer<typeof briefSettingsSchema>;

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "America/Phoenix", label: "Arizona (MST)" },
  { value: "America/Anchorage", label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii (HST)" },
];

const SEND_HOURS = Array.from({ length: 6 }, (_, i) => ({
  value: (i + 5).toString(),
  label: `${i + 5}:00 AM`,
}));

export default function BriefSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: preferences, isLoading } = useQuery({
    queryKey: ["/api/briefs/preferences"],
  });

  const form = useForm<BriefSettingsValues>({
    resolver: zodResolver(briefSettingsSchema),
    defaultValues: {
      cadence: "daily",
      timezone: "America/New_York",
      sendHourLocal: 7,
      emailEnabled: 1,
      inAppEnabled: 1,
    },
    values: preferences ? {
      cadence: preferences.cadence || "daily",
      timezone: preferences.timezone || "America/New_York",
      sendHourLocal: preferences.sendHourLocal ?? 7,
      emailEnabled: preferences.emailEnabled ?? 1,
      inAppEnabled: preferences.inAppEnabled ?? 1,
    } : undefined,
  });

  const mutation = useMutation({
    mutationFn: async (values: BriefSettingsValues) => {
      return apiRequest("/api/briefs/preferences", {
        method: "PATCH",
        body: JSON.stringify(values),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/briefs/preferences"] });
      toast({
        title: "Settings saved",
        description: "Your brief preferences have been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  function onSubmit(values: BriefSettingsValues) {
    mutation.mutate(values);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Daily Marketing Brief Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure how and when you receive your personalized marketing AI brief
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center gap-3 pb-4">
              <CalendarDays className="w-5 h-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-base">Delivery Schedule</CardTitle>
                <CardDescription>Choose how often and when you receive updates</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="cadence"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>Cadence</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="flex flex-col space-y-1"
                      >
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="daily" data-testid="radio-cadence-daily" />
                          </FormControl>
                          <FormLabel className="font-normal">
                            Daily (7 days a week)
                          </FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="3x_week" data-testid="radio-cadence-3x" />
                          </FormControl>
                          <FormLabel className="font-normal">
                            3x a week (Mon, Wed, Fri)
                          </FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="weekly" data-testid="radio-cadence-weekly" />
                          </FormControl>
                          <FormLabel className="font-normal">
                            Weekly (Monday morning)
                          </FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="timezone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Globe className="w-3.5 h-3.5" /> Timezone
                      </FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-timezone">
                            <SelectValue placeholder="Select timezone" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {TIMEZONES.map((tz) => (
                            <SelectItem key={tz.value} value={tz.value}>
                              {tz.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="sendHourLocal"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5" /> Send Time
                      </FormLabel>
                      <Select 
                        onValueChange={(val) => field.onChange(parseInt(val))} 
                        defaultValue={field.value?.toString()}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-send-hour">
                            <SelectValue placeholder="Select hour" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SEND_HOURS.map((hour) => (
                            <SelectItem key={hour.value} value={hour.value}>
                              {hour.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>Local time in selected timezone</FormDescription>
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-3 pb-4">
              <Sparkles className="w-5 h-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-base">Notification Channels</CardTitle>
                <CardDescription>Where should we deliver your brief?</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="emailEnabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
                    <div className="space-y-0.5">
                      <FormLabel className="flex items-center gap-2">
                        <Mail className="w-4 h-4 text-muted-foreground" /> Email Delivery
                      </FormLabel>
                      <FormDescription>
                        Receive the brief directly in your inbox
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value === 1}
                        onCheckedChange={(checked) => field.onChange(checked ? 1 : 0)}
                        data-testid="switch-email-enabled"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="inAppEnabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
                    <div className="space-y-0.5">
                      <FormLabel className="flex items-center gap-2">
                        <Bell className="w-4 h-4 text-muted-foreground" /> In-App Notification
                      </FormLabel>
                      <FormDescription>
                        Show the brief on your dashboard when you log in
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value === 1}
                        onCheckedChange={(checked) => field.onChange(checked ? 1 : 0)}
                        data-testid="switch-in-app-enabled"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button 
              type="submit" 
              disabled={mutation.isPending}
              data-testid="button-save-settings"
            >
              {mutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
              ) : (
                "Save Preferences"
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
