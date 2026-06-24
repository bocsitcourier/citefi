"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useRouter } from "next/navigation";
import { Loader2, Check, X, Shield, User, Mail, Calendar, UserPlus, Send, Trash2, Copy, LogOut, MoreVertical, Key, ShieldAlert, ShieldCheck, ShieldOff, Home, Eye } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

interface UserData {
  id: number;
  email: string;
  fullName: string | null;
  role: "admin" | "team_member";
  accountStatus: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  twoFactorEnforced: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  teamName: string | null;
}

interface InviteData {
  id: number;
  email: string;
  role: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  invitedByName: string;
  invitedByEmail: string;
  message: string | null;
}

export default function AdminUsersPage() {
  const { toast } = useToast();
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "team_member">("team_member");
  const [inviteMessage, setInviteMessage] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [resetPasswordUrl, setResetPasswordUrl] = useState("");
  const [toggle2FADialogOpen, setToggle2FADialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectUser, setRejectUser] = useState<UserData | null>(null);
  const [rejectSendEmail, setRejectSendEmail] = useState(true);
  const [cancelSubUser, setCancelSubUser] = useState<UserData | null>(null);
  const [cancelSubDialogOpen, setCancelSubDialogOpen] = useState(false);

  const { data: users, isLoading } = useQuery<UserData[]>({
    queryKey: ["/api/admin/users"],
    enabled: user?.role === "admin",
  });

  const { data: invites } = useQuery<InviteData[]>({
    queryKey: ["/api/admin/invites"],
    enabled: user?.role === "admin",
  });

  const approveUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      return apiRequest(`/api/admin/users/${userId}/approve`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pending-count"] });
      toast({
        title: "User approved",
        description: "The user can now log in to the system.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Approval failed",
        description: error.message || "Failed to approve user",
      });
    },
  });

  const rejectUserMutation = useMutation({
    mutationFn: async ({ userId, sendEmail }: { userId: number; sendEmail: boolean }) => {
      return apiRequest(`/api/admin/users/${userId}/reject`, {
        method: "POST",
        body: JSON.stringify({ sendEmail }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pending-count"] });
      setRejectDialogOpen(false);
      setRejectUser(null);
      toast({
        title: "Registration rejected",
        description: "The registration has been rejected.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Rejection failed",
        description: error.message || "Failed to reject registration",
      });
    },
  });

  const suspendUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      return apiRequest(`/api/admin/users/${userId}/suspend`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "User suspended",
        description: "The user has been suspended from the system.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Suspension failed",
        description: error.message || "Failed to suspend user",
      });
    },
  });

  const cancelSubscriptionMutation = useMutation({
    mutationFn: async (userId: number) => {
      return apiRequest(`/api/admin/users/${userId}/cancel-subscription`, {
        method: "POST",
        body: JSON.stringify({ immediate: false }),
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "Subscription cancelled",
        description: `Cancellation scheduled${data?.currentPeriodEnd ? ` — active until ${new Date(data.currentPeriodEnd).toLocaleDateString()}` : " at period end"}.`,
      });
      setCancelSubDialogOpen(false);
      setCancelSubUser(null);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Cancellation failed",
        description: error.message || "Failed to cancel subscription",
      });
    },
  });

  const sendInviteMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/admin/invites", {
        method: "POST",
        body: JSON.stringify({
          email: inviteEmail,
          role: inviteRole,
          message: inviteMessage || undefined,
        }),
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/invites"] });
      toast({
        title: "Invite sent",
        description: `Invitation sent to ${inviteEmail}`,
      });
      setInviteDialogOpen(false);
      setInviteEmail("");
      setInviteRole("team_member");
      setInviteMessage("");

      if (data.invite?.inviteUrl) {
        navigator.clipboard.writeText(data.invite.inviteUrl);
        toast({
          title: "Invite link copied",
          description: "The invite link has been copied to your clipboard.",
        });
      }
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Invite failed",
        description: error.message || "Failed to send invite",
      });
    },
  });

  const revokeInviteMutation = useMutation({
    mutationFn: async (inviteId: number) => {
      return apiRequest(`/api/admin/invites/${inviteId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/invites"] });
      toast({
        title: "Invite revoked",
        description: "The invitation has been revoked.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Revoke failed",
        description: error.message || "Failed to revoke invite",
      });
    },
  });

  const changeRoleMutation = useMutation({
    mutationFn: async ({ userId, newRole }: { userId: number; newRole: string }) => {
      return apiRequest(`/api/admin/users/${userId}/change-role`, {
        method: "POST",
        body: JSON.stringify({ newRole }),
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      const roleDisplay = variables.newRole === 'admin' ? 'Admin' : 'Team Member';
      toast({
        title: "Role changed",
        description: `User role changed to ${roleDisplay}`,
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Role change failed",
        description: error.message || "Failed to change user role",
      });
    },
  });

  const forceLogoutMutation = useMutation({
    mutationFn: async ({ userId, reason }: { userId: number; reason?: string }) => {
      return apiRequest(`/api/admin/users/${userId}/force-logout`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "User logged out",
        description: `Terminated ${data.sessionsTerminated} active session(s)`,
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Force logout failed",
        description: error.message || "Failed to force logout",
      });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (userId: number) => {
      return apiRequest(`/api/admin/users/${userId}/reset-password`, {
        method: "POST",
      });
    },
    onSuccess: (data: any) => {
      setResetPasswordUrl(data.resetUrl);
      setResetPasswordDialogOpen(true);
      toast({
        title: "Password reset link generated",
        description: "Reset link has been generated and sent to user's email",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Reset failed",
        description: error.message || "Failed to generate password reset link",
      });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      return apiRequest(`/api/admin/users/${userId}/delete`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setDeleteDialogOpen(false);
      setDeleteConfirmText("");
      setSelectedUser(null);
      toast({
        title: "User deleted",
        description: "User account has been permanently deleted",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: error.message || "Failed to delete user",
      });
    },
  });

  const toggle2FAMutation = useMutation({
    mutationFn: async (userId: number) => {
      return apiRequest(`/api/admin/users/${userId}/toggle-2fa`, {
        method: "POST",
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setToggle2FADialogOpen(false);
      setSelectedUser(null);
      toast({
        title: "2FA updated",
        description: data.message,
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "2FA toggle failed",
        description: error.message || "Failed to toggle 2FA enforcement",
      });
    },
  });

  useEffect(() => {
    if (!isAuthLoading && user && user.role !== "admin") {
      router.replace("/home");
    }
  }, [user, isAuthLoading, router]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge variant="default" className="bg-green-500">Active</Badge>;
      case "pending_approval":
        return <Badge variant="secondary">Pending Approval</Badge>;
      case "suspended":
        return <Badge variant="destructive">Suspended</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getRoleBadge = (role: string) => {
    if (role === "admin") {
      return (
        <Badge variant="default" className="bg-purple-500">
          <Shield className="w-3 h-3 mr-1" />
          Admin
        </Badge>
      );
    }
    return (
      <Badge variant="outline">
        <User className="w-3 h-3 mr-1" />
        Team Member
      </Badge>
    );
  };

  const get2FABadge = (twoFactorEnabled: boolean, twoFactorEnforced: boolean) => {
    if (twoFactorEnforced && twoFactorEnabled) {
      return (
        <Badge variant="default" className="bg-green-600">
          <ShieldCheck className="w-3 h-3 mr-1" />
          Enforced
        </Badge>
      );
    }
    if (twoFactorEnabled) {
      return (
        <Badge variant="default" className="bg-blue-500">
          <ShieldAlert className="w-3 h-3 mr-1" />
          Enabled
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <ShieldOff className="w-3 h-3 mr-1" />
        Not Setup
      </Badge>
    );
  };

  const handleCopyResetLink = () => {
    navigator.clipboard.writeText(resetPasswordUrl);
    toast({
      title: "Link copied",
      description: "Password reset link copied to clipboard",
    });
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

  const pendingUsers = users?.filter(u => u.accountStatus === "pending_approval") || [];
  const activeUsers = users?.filter(u => u.accountStatus === "active") || [];
  const suspendedUsers = users?.filter(u => u.accountStatus === "suspended") || [];
  const pendingInvites = invites?.filter(i => i.status === "pending") || [];

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push('/home')}
            data-testid="button-home"
          >
            <Home className="h-4 w-4 mr-2" />
            Home
          </Button>
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-admin-users-title">User Management</h1>
            <p className="text-muted-foreground">Manage user accounts and permissions</p>
          </div>
        </div>
        <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-invite-user">
              <UserPlus className="h-4 w-4 mr-2" />
              Invite User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite New User</DialogTitle>
              <DialogDescription>
                Send an invitation to join your team
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="user@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  data-testid="input-invite-email"
                />
              </div>
              <div>
                <Label htmlFor="role">Role</Label>
                <Select value={inviteRole} onValueChange={(value: "admin" | "team_member") => setInviteRole(value)}>
                  <SelectTrigger data-testid="select-invite-role">
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="team_member">Team Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="message">Welcome Message (Optional)</Label>
                <Textarea
                  id="message"
                  placeholder="Add a personal message to the invitation..."
                  value={inviteMessage}
                  onChange={(e) => setInviteMessage(e.target.value)}
                  rows={3}
                  data-testid="input-invite-message"
                />
              </div>
              <Button
                onClick={() => sendInviteMutation.mutate()}
                disabled={!inviteEmail || sendInviteMutation.isPending}
                className="w-full"
                data-testid="button-send-invite"
              >
                {sendInviteMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Send Invitation
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Pending Invites */}
      {pendingInvites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="w-5 h-5" />
              Pending Invites
              <Badge variant="secondary">{pendingInvites.length}</Badge>
            </CardTitle>
            <CardDescription>Invitations waiting to be accepted</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Invited By</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvites.map((invite) => (
                  <TableRow key={invite.id} data-testid={`row-invite-${invite.id}`}>
                    <TableCell className="font-medium" data-testid={`text-invite-email-${invite.id}`}>
                      {invite.email}
                    </TableCell>
                    <TableCell data-testid={`badge-invite-role-${invite.id}`}>
                      {getRoleBadge(invite.role)}
                    </TableCell>
                    <TableCell data-testid={`text-invited-by-${invite.id}`}>
                      {invite.invitedByName}
                    </TableCell>
                    <TableCell data-testid={`text-expires-${invite.id}`}>
                      {new Date(invite.expiresAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => revokeInviteMutation.mutate(invite.id)}
                        disabled={revokeInviteMutation.isPending}
                        data-testid={`button-revoke-invite-${invite.id}`}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Pending Approvals */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Pending Approvals
            <Badge variant="secondary">{pendingUsers.length}</Badge>
          </CardTitle>
          <CardDescription>Review and approve new user registrations</CardDescription>
        </CardHeader>
        <CardContent>
          {pendingUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No pending registrations</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingUsers.map((u) => (
                  <TableRow key={u.id} data-testid={`row-pending-user-${u.id}`}>
                    <TableCell className="font-medium" data-testid={`text-email-${u.id}`}>{u.email}</TableCell>
                    <TableCell data-testid={`text-name-${u.id}`}>{u.fullName || "-"}</TableCell>
                    <TableCell data-testid={`text-team-${u.id}`}>{u.teamName || "-"}</TableCell>
                    <TableCell data-testid={`text-created-${u.id}`}>
                      {new Date(u.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        size="sm"
                        onClick={() => approveUserMutation.mutate(u.id)}
                        disabled={approveUserMutation.isPending || rejectUserMutation.isPending}
                        data-testid={`button-approve-${u.id}`}
                      >
                        {approveUserMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Check className="h-4 w-4 mr-1" />
                            Approve
                          </>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setRejectUser(u);
                          setRejectSendEmail(true);
                          setRejectDialogOpen(true);
                        }}
                        disabled={approveUserMutation.isPending || rejectUserMutation.isPending}
                        data-testid={`button-reject-${u.id}`}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Reject
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Reject Registration Dialog */}
      <AlertDialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Registration</AlertDialogTitle>
            <AlertDialogDescription>
              Reject the registration for <strong>{rejectUser?.email}</strong>? Their account will be suspended and they will not be able to log in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 px-1 py-2">
            <input
              type="checkbox"
              id="reject-send-email"
              checked={rejectSendEmail}
              onChange={(e) => setRejectSendEmail(e.target.checked)}
              className="h-4 w-4"
              data-testid="checkbox-reject-send-email"
            />
            <label htmlFor="reject-send-email" className="text-sm text-muted-foreground">
              Notify the user by email
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-reject-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (rejectUser) {
                  rejectUserMutation.mutate({ userId: rejectUser.id, sendEmail: rejectSendEmail });
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-reject-confirm"
            >
              {rejectUserMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              Reject Registration
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Active Users */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5" />
            Active Users
            <Badge variant="secondary">{activeUsers.length}</Badge>
          </CardTitle>
          <CardDescription>Currently active user accounts</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>2FA Status</TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeUsers.map((u) => (
                <TableRow key={u.id} data-testid={`row-active-user-${u.id}`}>
                  <TableCell className="font-medium" data-testid={`text-email-${u.id}`}>{u.email}</TableCell>
                  <TableCell data-testid={`text-name-${u.id}`}>{u.fullName || "-"}</TableCell>
                  <TableCell data-testid={`badge-role-${u.id}`}>{getRoleBadge(u.role)}</TableCell>
                  <TableCell data-testid={`badge-status-${u.id}`}>{getStatusBadge(u.accountStatus)}</TableCell>
                  <TableCell data-testid={`badge-2fa-${u.id}`}>{get2FABadge(u.twoFactorEnabled, u.twoFactorEnforced)}</TableCell>
                  <TableCell data-testid={`text-lastlogin-${u.id}`}>
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "Never"}
                  </TableCell>
                  <TableCell className="text-right">
                    {u.id !== user?.id ? (
                      <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => router.push(`/admin/users/${u.id}`)}
                        data-testid={`button-view-user-${u.id}`}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" data-testid={`button-actions-${u.id}`}>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => changeRoleMutation.mutate({
                              userId: u.id,
                              newRole: u.role === 'admin' ? 'team_member' : 'admin'
                            })}
                            disabled={changeRoleMutation.isPending}
                            data-testid={`action-change-role-${u.id}`}
                          >
                            <Shield className="h-4 w-4 mr-2" />
                            {u.role === 'admin' ? 'Demote to Member' : 'Promote to Admin'}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => forceLogoutMutation.mutate({ userId: u.id })}
                            disabled={forceLogoutMutation.isPending}
                            data-testid={`action-force-logout-${u.id}`}
                          >
                            <LogOut className="h-4 w-4 mr-2" />
                            Force Logout
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedUser(u);
                              setToggle2FADialogOpen(true);
                            }}
                            data-testid={`action-toggle-2fa-${u.id}`}
                          >
                            <ShieldAlert className="h-4 w-4 mr-2" />
                            {u.twoFactorEnforced ? 'Remove 2FA Enforcement' : 'Enforce 2FA'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => resetPasswordMutation.mutate(u.id)}
                            disabled={resetPasswordMutation.isPending}
                            data-testid={`action-reset-password-${u.id}`}
                          >
                            <Key className="h-4 w-4 mr-2" />
                            Reset Password
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => suspendUserMutation.mutate(u.id)}
                            disabled={suspendUserMutation.isPending}
                            data-testid={`action-suspend-${u.id}`}
                          >
                            <X className="h-4 w-4 mr-2" />
                            Suspend Account
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => {
                              setCancelSubUser(u);
                              setCancelSubDialogOpen(true);
                            }}
                            data-testid={`action-cancel-sub-${u.id}`}
                          >
                            <X className="h-4 w-4 mr-2" />
                            Cancel Subscription
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedUser(u);
                              setDeleteDialogOpen(true);
                            }}
                            className="text-destructive focus:text-destructive"
                            data-testid={`action-delete-${u.id}`}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete User
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">Current User</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Suspended Users */}
      {suspendedUsers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <X className="w-5 h-5" />
              Suspended Users
              <Badge variant="destructive">{suspendedUsers.length}</Badge>
            </CardTitle>
            <CardDescription>Suspended user accounts</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suspendedUsers.map((u) => (
                  <TableRow key={u.id} data-testid={`row-suspended-user-${u.id}`}>
                    <TableCell className="font-medium" data-testid={`text-email-${u.id}`}>{u.email}</TableCell>
                    <TableCell data-testid={`text-name-${u.id}`}>{u.fullName || "-"}</TableCell>
                    <TableCell data-testid={`badge-role-${u.id}`}>{getRoleBadge(u.role)}</TableCell>
                    <TableCell data-testid={`badge-status-${u.id}`}>{getStatusBadge(u.accountStatus)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() => approveUserMutation.mutate(u.id)}
                        disabled={approveUserMutation.isPending}
                        data-testid={`button-reactivate-${u.id}`}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Reactivate
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Password Reset Dialog */}
      <Dialog open={resetPasswordDialogOpen} onOpenChange={setResetPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Password Reset Link Generated</DialogTitle>
            <DialogDescription>
              The password reset link has been generated and sent to the user's email. You can also copy it below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-muted rounded-md">
              <code className="text-sm break-all">{resetPasswordUrl}</code>
            </div>
            <Button onClick={handleCopyResetLink} className="w-full" data-testid="button-copy-reset-link">
              <Copy className="h-4 w-4 mr-2" />
              Copy Link to Clipboard
            </Button>
            <p className="text-sm text-muted-foreground">
              This link will expire in 24 hours.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete User Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently Delete User?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the user account and all associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {selectedUser && (
            <div className="space-y-4">
              <div className="p-4 border rounded-md space-y-2">
                <div>
                  <span className="text-sm font-medium">Email:</span>
                  <span className="text-sm ml-2">{selectedUser.email}</span>
                </div>
                <div>
                  <span className="text-sm font-medium">Name:</span>
                  <span className="text-sm ml-2">{selectedUser.fullName || "Not set"}</span>
                </div>
                <div>
                  <span className="text-sm font-medium">Role:</span>
                  <span className="text-sm ml-2">{selectedUser.role === 'admin' ? 'Admin' : 'Team Member'}</span>
                </div>
                <div>
                  <span className="text-sm font-medium">Created:</span>
                  <span className="text-sm ml-2">{new Date(selectedUser.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
              <div>
                <Label htmlFor="deleteConfirm">Type the user's email to confirm deletion:</Label>
                <Input
                  id="deleteConfirm"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={selectedUser.email}
                  data-testid="input-delete-confirm"
                />
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setDeleteConfirmText("");
              setSelectedUser(null);
            }} data-testid="button-cancel-delete">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selectedUser) {
                  deleteUserMutation.mutate(selectedUser.id);
                }
              }}
              disabled={deleteConfirmText !== selectedUser?.email || deleteUserMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteUserMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete User"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Toggle 2FA Enforcement Dialog */}
      <AlertDialog open={toggle2FADialogOpen} onOpenChange={setToggle2FADialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {selectedUser?.twoFactorEnforced ? 'Remove 2FA Enforcement' : 'Enforce 2FA'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {selectedUser?.twoFactorEnforced
                ? 'This will remove the 2FA requirement for this user. They can still use 2FA if they have it set up.'
                : 'This will require the user to set up two-factor authentication before they can access the system.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {selectedUser && (
            <div className="p-4 border rounded-md space-y-2">
              <div>
                <span className="text-sm font-medium">User:</span>
                <span className="text-sm ml-2">{selectedUser.email}</span>
              </div>
              <div>
                <span className="text-sm font-medium">Current 2FA Status:</span>
                <span className="text-sm ml-2">
                  {get2FABadge(selectedUser.twoFactorEnabled, selectedUser.twoFactorEnforced)}
                </span>
              </div>
              <div>
                <span className="text-sm font-medium">New Status:</span>
                <span className="text-sm ml-2">
                  {selectedUser.twoFactorEnforced ? 'Optional' : 'Enforced'}
                </span>
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedUser(null)} data-testid="button-cancel-2fa">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selectedUser) {
                  toggle2FAMutation.mutate(selectedUser.id);
                }
              }}
              disabled={toggle2FAMutation.isPending}
              data-testid="button-confirm-2fa"
            >
              {toggle2FAMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                "Confirm"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Subscription Dialog */}
      <AlertDialog open={cancelSubDialogOpen} onOpenChange={setCancelSubDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Subscription for {cancelSubUser?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will schedule the cancellation at the end of the current billing period. The user
              keeps access until then. You can view the exact date on their detail page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => { setCancelSubUser(null); }}
              data-testid="button-cancel-sub-dismiss"
            >
              Keep Subscription
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (cancelSubUser) cancelSubscriptionMutation.mutate(cancelSubUser.id); }}
              disabled={cancelSubscriptionMutation.isPending}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-cancel-sub"
            >
              {cancelSubscriptionMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Cancelling...</>
              ) : (
                "Yes, Cancel Subscription"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
