"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, Share2, Check, Globe, Wifi, WifiOff, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import Link from "next/link";

interface PublishingConnection {
  id: number;
  name: string;
  channel: string;
  baseUrl: string;
  status: string;
  lastTestedAt: string | null;
}

interface PublishDialogProps {
  contentId: number;
  contentType: "article" | "social_post" | "video" | "podcast";
  contentTitle: string;
  disabled?: boolean;
}

export function PublishDialog({ contentId, contentType, contentTitle, disabled }: PublishDialogProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedConnections, setSelectedConnections] = useState<number[]>([]);
  const [publishingStates, setPublishingStates] = useState<Record<number, 'idle' | 'publishing' | 'success' | 'error'>>({});

  const { data: connectionsData, isLoading: loadingConnections } = useQuery<{ success: boolean; data: PublishingConnection[] }>({
    queryKey: ['/api/publishing/connections'],
    enabled: open,
  });

  const connections = connectionsData?.data || [];
  const activeConnections = connections.filter(c => ['active', 'verified'].includes(c.status));

  const publishMutation = useMutation({
    mutationFn: async (connectionId: number) => {
      setPublishingStates(prev => ({ ...prev, [connectionId]: 'publishing' }));
      return await apiRequest('/api/publishing/jobs', {
        method: 'POST',
        body: JSON.stringify({
          connectionId,
          contentType,
          contentId,
        }),
      });
    },
    onSuccess: (_, connectionId) => {
      setPublishingStates(prev => ({ ...prev, [connectionId]: 'success' }));
      queryClient.invalidateQueries({ queryKey: ['/api/publishing/jobs'] });
      toast({
        title: "Publishing started",
        description: `${contentTitle} is being published. You can track the status in the publishing dashboard.`,
      });
    },
    onError: (error, connectionId) => {
      setPublishingStates(prev => ({ ...prev, [connectionId]: 'error' }));
      toast({
        title: "Publishing failed",
        description: error instanceof Error ? error.message : "Failed to start publishing job",
        variant: "destructive",
      });
    },
  });

  const handlePublish = (connectionId: number) => {
    publishMutation.mutate(connectionId);
  };

  const handlePublishSelected = () => {
    selectedConnections.forEach(id => {
      if (publishingStates[id] !== 'publishing') {
        publishMutation.mutate(id);
      }
    });
  };

  const toggleConnection = (id: number) => {
    setSelectedConnections(prev => 
      prev.includes(id) 
        ? prev.filter(c => c !== id) 
        : [...prev, id]
    );
  };

  const getChannelIcon = (channel: string) => {
    switch (channel) {
      case 'website':
        return <Globe className="w-4 h-4" />;
      default:
        return <Share2 className="w-4 h-4" />;
    }
  };

  const getPublishButtonState = (connectionId: number) => {
    const state = publishingStates[connectionId] || 'idle';
    switch (state) {
      case 'publishing':
        return { icon: <Loader2 className="w-3 h-3 animate-spin" />, text: 'Publishing...', disabled: true };
      case 'success':
        return { icon: <Check className="w-3 h-3 text-green-600" />, text: 'Sent', disabled: true };
      case 'error':
        return { icon: null, text: 'Retry', disabled: false };
      default:
        return { icon: <Share2 className="w-3 h-3" />, text: 'Publish', disabled: false };
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled} data-testid="button-publish">
          <Share2 className="w-4 h-4 mr-2" />
          Publish
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]" data-testid="dialog-publish">
        <DialogHeader>
          <DialogTitle>Publish Content</DialogTitle>
          <DialogDescription>
            Send this {contentType.replace('_', ' ')} to your connected channels.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {loadingConnections ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : activeConnections.length === 0 ? (
            <div className="text-center py-6 space-y-4">
              <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <WifiOff className="w-6 h-6 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">No active connections</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Set up publishing connections to distribute your content.
                </p>
              </div>
              <Link href="/settings/publishing">
                <Button variant="outline" size="sm" data-testid="link-setup-connections">
                  <ExternalLink className="w-3 h-3 mr-2" />
                  Set Up Connections
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Select destinations for your content:
              </p>
              {activeConnections.map(connection => {
                const buttonState = getPublishButtonState(connection.id);
                return (
                  <div 
                    key={connection.id}
                    className="flex items-center justify-between p-3 border rounded-lg hover-elevate"
                    data-testid={`connection-row-${connection.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                        {getChannelIcon(connection.channel)}
                      </div>
                      <div>
                        <p className="font-medium text-sm" data-testid={`text-connection-name-${connection.id}`}>
                          {connection.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {connection.channel} · {new URL(connection.baseUrl).hostname}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
                        <Wifi className="w-3 h-3 mr-1" />
                        {connection.status === 'verified' ? 'Verified' : 'Active'}
                      </Badge>
                      <Button
                        size="sm"
                        variant={publishingStates[connection.id] === 'success' ? 'outline' : 'default'}
                        onClick={() => handlePublish(connection.id)}
                        disabled={buttonState.disabled}
                        data-testid={`button-publish-to-${connection.id}`}
                      >
                        {buttonState.icon && <span className="mr-1">{buttonState.icon}</span>}
                        {buttonState.text}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button 
            variant="outline" 
            onClick={() => setOpen(false)}
            data-testid="button-close-publish-dialog"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
