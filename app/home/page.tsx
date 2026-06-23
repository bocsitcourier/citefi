"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, FileText, Zap, Shield, LogIn, UserPlus, Brain, Users, Globe } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { NotificationBell } from "@/components/NotificationBell";

export default function Home() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-8 py-16 space-y-16">
        <div className="text-center space-y-4">
          <div className="flex justify-end gap-2 mb-8">
            {user ? (
              <div className="flex items-center gap-3">
                <NotificationBell />
                <span className="text-sm text-muted-foreground">
                  {user.email}
                </span>
                <Button variant="outline" size="sm" onClick={logout} data-testid="button-logout">
                  Logout
                </Button>
              </div>
            ) : (
              <>
                <Link href="/login">
                  <Button variant="outline" size="sm" data-testid="button-login-link">
                    <LogIn className="w-4 h-4 mr-2" />
                    Login
                  </Button>
                </Link>
                <Link href="/signup">
                  <Button size="sm" data-testid="button-signup-link">
                    <UserPlus className="w-4 h-4 mr-2" />
                    Sign Up
                  </Button>
                </Link>
              </>
            )}
          </div>
          <h1 className="text-5xl font-bold bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent" data-testid="text-page-title">
            Citefi
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto" data-testid="text-page-description">
            Enterprise-grade dual-AI SEO content factory powered by advanced AI
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Card className="hover-elevate border-primary/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                Dashboard
              </CardTitle>
              <CardDescription>
                Generate 1 or multiple articles with full SEO optimization
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/dashboard">
                <Button className="w-full" data-testid="button-dashboard">
                  Start Creating
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="hover-elevate">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                Content Library
              </CardTitle>
              <CardDescription>
                Browse and export your generated articles
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/content">
                <Button className="w-full" variant="outline" data-testid="button-content">
                  View Content
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="hover-elevate border-purple-500/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-purple-600" />
                Social Media AI
              </CardTitle>
              <CardDescription>
                Generate & schedule posts for X, Facebook, Instagram, Pinterest, LinkedIn
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/social">
                <Button className="w-full" data-testid="button-social">
                  Social Dashboard
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="hover-elevate">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-primary" />
                SEO Tools
              </CardTitle>
              <CardDescription>
                AI-powered local research, competitor analysis, and content optimization
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/seo-tools">
                <Button className="w-full" variant="outline" data-testid="button-seo-tools">
                  SEO Intelligence
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="hover-elevate">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                Media Library
              </CardTitle>
              <CardDescription>
                Upload and manage images, audio, and video files
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/media">
                <Button className="w-full" variant="outline" data-testid="button-media">
                  Media Manager
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="hover-elevate border-green-500/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-green-600" />
                AI Learning Center
              </CardTitle>
              <CardDescription>
                View what your AI has learned and optimize agents for better content
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/learning">
                <Button className="w-full" variant="outline" data-testid="button-learning">
                  AI Learning
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="hover-elevate border-orange-500/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-orange-600" />
                Audience Personas
              </CardTitle>
              <CardDescription>
                Create OCEAN-based personality profiles for psychographic content targeting
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/personas">
                <Button className="w-full" variant="outline" data-testid="button-personas">
                  Manage Personas
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="hover-elevate border-cyan-500/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="w-5 h-5 text-cyan-600" />
                Site Map
              </CardTitle>
              <CardDescription>
                Crawl your website to enable intelligent multi-page hyperlinking in articles
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/site-map">
                <Button className="w-full" variant="outline" data-testid="button-site-map">
                  Manage Site Map
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="hover-elevate border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                Admin
              </CardTitle>
              <CardDescription>
                User management, system monitoring, SEO reports, cost tracking
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {user && user.role === "admin" && (
                <Link href="/admin/users">
                  <Button className="w-full" variant="default" data-testid="button-admin-users">
                    User Management
                  </Button>
                </Link>
              )}
              <Link href="/admin">
                <Button className="w-full" variant={user && user.role === "admin" ? "outline" : "default"} data-testid="button-admin">
                  Admin Dashboard
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              3-Stage Content Pipeline
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <h3 className="font-semibold">Stage 1: Title Pool Generation</h3>
              <p className="text-sm text-muted-foreground">
                AI generates 50 SEO-optimized article titles with keywords and content strategy
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold">Stage 2: Content & Image Generation</h3>
              <p className="text-sm text-muted-foreground">
                AI creates 800-2000 word articles with structured metadata and generates 5 images per article
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold">Stage 3: QA & Finalization</h3>
              <p className="text-sm text-muted-foreground">
                AI inserts hyperlinks, places images strategically, and formats publication-ready HTML
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
