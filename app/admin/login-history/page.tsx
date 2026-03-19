"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2, History, CheckCircle, XCircle, MapPin, Monitor, Search } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";

interface LoginHistoryData {
  id: number;
  userId: number | null;
  userEmail: string | null;
  userName: string | null;
  ipAddress: string;
  userAgent: string;
  success: boolean;
  failureReason: string | null;
  loginAt: string;
}

export default function AdminLoginHistoryPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const [searchEmail, setSearchEmail] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 50;

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

  const { data: history, isLoading } = useQuery<LoginHistoryData[]>({
    queryKey: ["/api/admin/login-history", page],
    enabled: user.role === "admin",
  });

  const parseUserAgent = (userAgent: string) => {
    if (userAgent.includes("Mobile") || userAgent.includes("Android") || userAgent.includes("iPhone")) {
      return "Mobile";
    }
    if (userAgent.includes("Tablet") || userAgent.includes("iPad")) {
      return "Tablet";
    }
    return "Desktop";
  };

  const getBrowser = (userAgent: string) => {
    if (userAgent.includes("Chrome")) return "Chrome";
    if (userAgent.includes("Firefox")) return "Firefox";
    if (userAgent.includes("Safari")) return "Safari";
    if (userAgent.includes("Edge")) return "Edge";
    return "Unknown";
  };

  const filteredHistory = history?.filter(h => 
    !searchEmail || h.userEmail?.toLowerCase().includes(searchEmail.toLowerCase())
  );

  const successCount = history?.filter(h => h.success).length || 0;
  const failureCount = history?.filter(h => !h.success).length || 0;

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
        <h1 className="text-3xl font-bold" data-testid="text-admin-login-history-title">Login History</h1>
        <p className="text-muted-foreground">Track all login attempts and user authentication activity</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Logins</CardTitle>
            <History className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{history?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Successful</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{successCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
            <XCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{failureCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Login Attempts</CardTitle>
              <CardDescription>All user login attempts with IP and device information</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by email..."
                  value={searchEmail}
                  onChange={(e) => setSearchEmail(e.target.value)}
                  className="pl-8 w-[250px]"
                  data-testid="input-search-email"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!filteredHistory || filteredHistory.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No login history found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Device</TableHead>
                  <TableHead>Browser</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Login Time</TableHead>
                  <TableHead>Failure Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredHistory.map((login) => (
                  <TableRow key={login.id} data-testid={`row-login-${login.id}`}>
                    <TableCell>
                      {login.success ? (
                        <Badge variant="default" className="bg-green-500">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Success
                        </Badge>
                      ) : (
                        <Badge variant="destructive">
                          <XCircle className="h-3 w-3 mr-1" />
                          Failed
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {login.userEmail ? (
                        <div>
                          <div className="font-medium">{login.userName || "Unknown"}</div>
                          <div className="text-sm text-muted-foreground">{login.userEmail}</div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Unknown User</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        <Monitor className="h-3 w-3 mr-1" />
                        {parseUserAgent(login.userAgent)}
                      </Badge>
                    </TableCell>
                    <TableCell>{getBrowser(login.userAgent)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-muted-foreground" />
                        <span className="text-sm">{login.ipAddress}</span>
                      </div>
                    </TableCell>
                    <TableCell>{format(new Date(login.loginAt), "PPpp")}</TableCell>
                    <TableCell>
                      {login.failureReason ? (
                        <span className="text-sm text-destructive">{login.failureReason}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="flex items-center justify-between mt-4">
            <Button
              variant="outline"
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">Page {page + 1}</span>
            <Button
              variant="outline"
              onClick={() => setPage(page + 1)}
              disabled={!history || history.length < pageSize}
            >
              Next
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
