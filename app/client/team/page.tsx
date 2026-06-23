"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Users, MailOpen, Clock, UserMinus, Send, Copy, X } from "lucide-react";

interface TeamMember {
  memberId: number;
  userId: number;
  role: string;
  joinedAt: string;
  email: string;
  fullName: string | null;
  profilePictureUrl: string | null;
  lastLoginAt: string | null;
}

interface PendingInvite {
  id: number;
  email: string;
  status: string;
  createdAt: string;
  expiresAt: string | null;
}

interface TeamData {
  members: TeamMember[];
  pendingInvites: PendingInvite[];
}

function relativeTime(iso: string | null) {
  if (!iso) return "Never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

const ROLE_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
  admin: "default",
  member: "secondary",
};

export default function TeamPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null);
  const [cancelInviteTarget, setCancelInviteTarget] = useState<PendingInvite | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<TeamData>({
    queryKey: ["/api/client/team"],
    queryFn: () => apiRequest("/api/client/team"),
    staleTime: 60_000,
  });

  const isAdmin = data?.members.some(
    (m) => m.userId === (user as any)?.id && m.role === "admin"
  ) ?? false;

  const inviteMutation = useMutation({
    mutationFn: () =>
      apiRequest("/api/client/team", {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      }),
    onSuccess: (res: any) => {
      toast({ title: "Invite created", description: res.message });
      if (res.inviteUrl) setInviteLink(res.inviteUrl);
      setInviteEmail("");
      qc.invalidateQueries({ queryKey: ["/api/client/team"] });
    },
    onError: (err: Error) => {
      toast({ title: "Invite failed", description: err.message, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: number) =>
      apiRequest("/api/client/team", {
        method: "DELETE",
        body: JSON.stringify({ memberId }),
      }),
    onSuccess: () => {
      toast({ title: "Member removed" });
      setRemoveTarget(null);
      qc.invalidateQueries({ queryKey: ["/api/client/team"] });
    },
    onError: (err: Error) => {
      toast({ title: "Remove failed", description: err.message, variant: "destructive" });
      setRemoveTarget(null);
    },
  });

  const cancelInviteMutation = useMutation({
    mutationFn: (inviteId: number) =>
      apiRequest(`/api/client/team/invite/${inviteId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Invite cancelled" });
      setCancelInviteTarget(null);
      qc.invalidateQueries({ queryKey: ["/api/client/team"] });
    },
    onError: (err: Error) => {
      toast({ title: "Cancel failed", description: err.message, variant: "destructive" });
      setCancelInviteTarget(null);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-8 text-center text-muted-foreground text-sm">
        Failed to load team data. Please refresh and try again.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold">Team</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {data.members.length} member{data.members.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Invite form — admin only */}
      {isAdmin && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Send className="h-4 w-4" />
              Invite a Member
            </CardTitle>
            <CardDescription>They will receive an invite link valid for 7 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-48 space-y-1.5">
                <Label htmlFor="invite-email" className="text-xs">Email address</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="colleague@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  data-testid="input-invite-email"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-role" className="text-xs">Role</Label>
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "member" | "admin")}>
                  <SelectTrigger id="invite-role" className="w-32" data-testid="select-invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => inviteMutation.mutate()}
                disabled={!inviteEmail.trim() || inviteMutation.isPending}
                data-testid="button-send-invite"
              >
                {inviteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Create invite
              </Button>
            </div>

            {/* Invite link to copy and share */}
            {inviteLink && (
              <div className="mt-4 space-y-1.5">
                <Label className="text-xs">Invite link — share this with your colleague</Label>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={inviteLink}
                    className="font-mono text-xs"
                    data-testid="input-invite-link"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      navigator.clipboard.writeText(inviteLink);
                      toast({ title: "Copied", description: "Invite link copied to clipboard." });
                    }}
                    data-testid="button-copy-invite-link"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setInviteLink(null)}
                    data-testid="button-dismiss-invite-link"
                  >
                    Dismiss
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">This link expires in 7 days.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Members */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Members
          </CardTitle>
          <CardDescription>People with access to your team workspace</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {data.members.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No team members found.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden sm:table-cell">Last active</TableHead>
                  <TableHead className="hidden sm:table-cell">Joined</TableHead>
                  {isAdmin && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.members.map((member) => {
                  const isSelf = member.userId === (user as any)?.id;
                  return (
                    <TableRow key={member.memberId} data-testid={`row-member-${member.memberId}`}>
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium">
                            {member.fullName ?? member.email}
                            {isSelf && (
                              <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                            )}
                          </p>
                          {member.fullName && (
                            <p className="text-xs text-muted-foreground">{member.email}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={ROLE_VARIANTS[member.role] ?? "outline"}
                          data-testid={`badge-role-${member.memberId}`}
                        >
                          {member.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                        {relativeTime(member.lastLoginAt)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                        {relativeTime(member.joinedAt)}
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          {!isSelf && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setRemoveTarget(member)}
                              data-testid={`button-remove-member-${member.memberId}`}
                            >
                              <UserMinus className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pending invites */}
      {data.pendingInvites.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MailOpen className="h-4 w-4" />
              Pending Invites
            </CardTitle>
            <CardDescription>Invitations waiting to be accepted</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">Expires</TableHead>
                  {isAdmin && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.pendingInvites.map((invite) => (
                  <TableRow key={invite.id} data-testid={`row-invite-${invite.id}`}>
                    <TableCell className="text-sm">{invite.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="flex items-center gap-1 w-fit">
                        <Clock className="h-3 w-3" />
                        pending
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right text-xs text-muted-foreground">
                      {invite.expiresAt ? relativeTime(invite.expiresAt) + " left" : "—"}
                    </TableCell>
                    {isAdmin && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setCancelInviteTarget(invite)}
                          data-testid={`button-cancel-invite-${invite.id}`}
                        >
                          <X className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Cancel invite confirmation */}
      <AlertDialog open={!!cancelInviteTarget} onOpenChange={(open) => { if (!open) setCancelInviteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel invite?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelInviteTarget && (
                <>
                  The invite for <strong>{cancelInviteTarget.email}</strong> will be cancelled immediately.
                  They will no longer be able to use the invite link.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-invite-dismiss">Keep invite</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancelInviteTarget && cancelInviteMutation.mutate(cancelInviteTarget.id)}
              disabled={cancelInviteMutation.isPending}
              data-testid="button-confirm-cancel-invite"
            >
              {cancelInviteMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Cancel invite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove member confirmation */}
      <AlertDialog open={!!removeTarget} onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove team member?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget && (
                <>
                  <strong>{removeTarget.fullName ?? removeTarget.email}</strong> will lose access to
                  this workspace immediately. This action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-remove">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeTarget && removeMutation.mutate(removeTarget.memberId)}
              disabled={removeMutation.isPending}
              data-testid="button-confirm-remove"
            >
              {removeMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Remove member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
