"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Bell, Check, X, Video, FileText, Share2, Layers, AlertCircle, CheckCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Notification {
  id: number;
  publicId: string;
  type: 'success' | 'error' | 'warning' | 'info';
  category: string;
  title: string;
  message: string;
  entityId: number | null;
  entityType: string | null;
  actionUrl: string | null;
  read: number;
  createdAt: string;
}

const categoryIcons: Record<string, React.ReactNode> = {
  video: <Video className="h-4 w-4" />,
  article: <FileText className="h-4 w-4" />,
  social_post: <Share2 className="h-4 w-4" />,
  batch: <Layers className="h-4 w-4" />,
  system: <AlertCircle className="h-4 w-4" />,
};

const typeColors: Record<string, string> = {
  success: "text-green-600 dark:text-green-400",
  error: "text-red-600 dark:text-red-400",
  warning: "text-yellow-600 dark:text-yellow-400",
  info: "text-blue-600 dark:text-blue-400",
};

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

let _sharedAudioCtx: AudioContext | null = null;

function playNotificationSound(type: "success" | "error" | "warning" | "info") {
  try {
    if (!_sharedAudioCtx || _sharedAudioCtx.state === "closed") {
      _sharedAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = _sharedAudioCtx;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

    if (type === "success") {
      oscillator.frequency.setValueAtTime(880, ctx.currentTime);
      oscillator.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    } else if (type === "error") {
      oscillator.frequency.setValueAtTime(440, ctx.currentTime);
      oscillator.frequency.setValueAtTime(330, ctx.currentTime + 0.12);
    } else {
      oscillator.frequency.setValueAtTime(660, ctx.currentTime);
    }

    oscillator.type = "sine";
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.45);
  } catch {
  }
}

export function NotificationBell() {
  const { toast } = useToast();
  const [lastCount, setLastCount] = useState(0);
  const initialLoadRef = useRef(true);

  const getToken = () => {
    try { return sessionStorage.getItem("auth_token"); } catch { return null; }
  };

  const { data: countData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications", "count"],
    queryFn: async () => {
      const token = getToken();
      const res = await fetch("/api/notifications?count=true", {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return { count: 0 };
      return res.json();
    },
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    staleTime: 20000,
  });

  const { data: notificationsData } = useQuery<{ notifications: Notification[] }>({
    queryKey: ["/api/notifications"],
    queryFn: async () => {
      const token = getToken();
      const res = await fetch("/api/notifications?limit=10", {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return { notifications: [] };
      return res.json();
    },
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
    staleTime: 45000,
  });

  const unreadCount = countData?.count ?? 0;
  const notifications = notificationsData?.notifications ?? [];

  useEffect(() => {
    if (initialLoadRef.current) {
      setLastCount(unreadCount);
      initialLoadRef.current = false;
      return;
    }

    if (unreadCount > lastCount) {
      const newNotifications = notifications.filter(n => n.read === 0);
      if (newNotifications.length > 0) {
        const latest = newNotifications[0]!;
        playNotificationSound(latest.type);
        toast({
          title: latest.title,
          description: latest.message.slice(0, 100),
          variant: latest.type === "error" ? "destructive" : "default",
        });
      }
    }
    setLastCount(unreadCount);
  }, [unreadCount]);

  const invalidateNotifications = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    queryClient.invalidateQueries({ queryKey: ["/api/notifications", "count"] });
  };

  const markReadMutation = useMutation({
    mutationFn: async (notificationId: number) => {
      return apiRequest(`/api/notifications/${notificationId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "read" }),
      });
    },
    onSuccess: invalidateNotifications,
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/notifications", {
        method: "POST",
        body: JSON.stringify({ action: "mark_all_read" }),
      });
    },
    onSuccess: invalidateNotifications,
  });

  const dismissMutation = useMutation({
    mutationFn: async (notificationId: number) => {
      return apiRequest(`/api/notifications/${notificationId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "dismiss" }),
      });
    },
    onSuccess: invalidateNotifications,
    onError: (error: Error) => {
      toast({
        title: "Failed to dismiss",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const dismissAllMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/notifications", {
        method: "POST",
        body: JSON.stringify({ action: "dismiss_all" }),
      });
    },
    onSuccess: invalidateNotifications,
    onError: (error: Error) => {
      toast({
        title: "Failed to clear notifications",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleNotificationClick = (notification: Notification) => {
    if (notification.read === 0) {
      markReadMutation.mutate(notification.id);
    }
    if (notification.actionUrl) {
      window.location.href = notification.actionUrl;
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" data-testid="button-notification-bell">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs"
              data-testid="badge-notification-count"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80" data-testid="dropdown-notifications">
        <DropdownMenuLabel className="flex items-center justify-between gap-1">
          <span>Notifications</span>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() => markAllReadMutation.mutate()}
                data-testid="button-mark-all-read"
              >
                <Check className="h-3 w-3 mr-1" />
                Mark all read
              </Button>
            )}
            {notifications.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-muted-foreground"
                onClick={() => dismissAllMutation.mutate()}
                disabled={dismissAllMutation.isPending}
                data-testid="button-dismiss-all"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Clear all
              </Button>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-[360px] overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground" data-testid="text-no-notifications">
            <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No notifications yet</p>
          </div>
        ) : (
          notifications.map((notification) => (
            <DropdownMenuItem
              key={notification.id}
              className={cn(
                "flex items-start gap-3 p-3 cursor-pointer",
                notification.read === 0 && "bg-accent/50"
              )}
              onClick={() => handleNotificationClick(notification)}
              data-testid={`notification-item-${notification.id}`}
            >
              <div className={cn("mt-0.5 shrink-0", typeColors[notification.type])}>
                {notification.type === "success" ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  categoryIcons[notification.category] || <Bell className="h-4 w-4" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{notification.title}</p>
                <p className="text-xs text-muted-foreground line-clamp-2">{notification.message}</p>
                <p className="text-xs text-muted-foreground mt-1">{formatTimeAgo(notification.createdAt)}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  dismissMutation.mutate(notification.id);
                }}
                data-testid={`button-dismiss-${notification.id}`}
              >
                <X className="h-3 w-3" />
              </Button>
            </DropdownMenuItem>
          ))
        )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
