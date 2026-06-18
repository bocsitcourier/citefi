"use client";

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, Users, MailOpen, Clock } from "lucide-react";
import Link from "next/link";

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
  const { data, isLoading, isError } = useQuery<TeamData>({
    queryKey: ["/api/client/team"],
    queryFn: () => apiRequest("/api/client/team"),
    staleTime: 60_000,
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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Team</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data.members.length} member{data.members.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" asChild data-testid="link-manage-team">
          <Link href="/admin/users">
            <Users className="h-4 w-4 mr-2" />
            Manage in Admin
          </Link>
        </Button>
      </div>

      {/* Members */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Members</CardTitle>
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
                  <TableHead className="hidden sm:table-cell text-right">Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.members.map(member => (
                  <TableRow key={member.memberId} data-testid={`row-member-${member.memberId}`}>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium">{member.fullName ?? member.email}</p>
                        {member.fullName && (
                          <p className="text-xs text-muted-foreground">{member.email}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={ROLE_VARIANTS[member.role] ?? "outline"} data-testid={`badge-role-${member.memberId}`}>
                        {member.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                      {relativeTime(member.lastLoginAt)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right text-xs text-muted-foreground">
                      {relativeTime(member.joinedAt)}
                    </TableCell>
                  </TableRow>
                ))}
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.pendingInvites.map(invite => (
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
