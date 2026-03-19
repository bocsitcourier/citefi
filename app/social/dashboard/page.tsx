"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { 
  Facebook, 
  Twitter, 
  Instagram, 
  Linkedin, 
  Pin, 
  Home, 
  Plus, 
  TrendingUp,
  Calendar,
  BarChart3,
  Image as ImageIcon,
  MessageSquare,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Video,
  MapPin,
  ChevronsUpDown,
  Check,
  FileText,
  Target,
  Sparkles,
  LogIn
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { NotificationBell } from "@/components/NotificationBell";

interface HashtagItem {
  tag: string;
  type?: string;
  mailtoLink?: string;
}

interface SocialPost {
  id: number;
  socialPostId: number; // Parent post ID for navigation
  userId: number;
  articleId: number | null;
  title: string;
  topic: string;
  location: string;
  platform: string;
  caption: string;
  hashtagsJson: HashtagItem[] | string[];
  status: string;
  videoStatus: string | null;
  videoUrl: string | null;
  imageUrl: string | null;
  scheduleAt: string | null;
  createdAt: string;
}

function getHashtagText(tag: HashtagItem | string): string {
  if (typeof tag === 'string') return tag;
  return tag.tag || '';
}

interface Article {
  id: number;
  title: string;
  word_count: number | null;
  location: string | null;
  seo_score: number | null;
  article_status: string;
}

interface DashboardStats {
  totalPosts: number;
  byPlatform: Record<string, number>;
  byStatus: Record<string, number>;
  recentPosts: SocialPost[];
}

export default function SocialMediaDashboard() {
  const router = useRouter();
  const { toast } = useToast();
  const [selectedArticleId, setSelectedArticleId] = useState<string>("");
  const [showLatestOnly, setShowLatestOnly] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [authReady, setAuthReady] = useState(false);
  
  // Check authentication status before fetching posts
  const { data: authData, isLoading: authLoading, isError: authError } = useQuery<{ user: any }>({
    queryKey: ['/api/auth/me'],
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
  
  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && (authError || !authData?.user)) {
      router.push('/login?redirect=/social/dashboard');
    }
  }, [authLoading, authError, authData, router]);
  
  // Set authReady when we have valid auth data
  useEffect(() => {
    if (authData?.user) {
      setAuthReady(true);
    }
  }, [authData]);
  
  // Only fetch social posts when authentication is confirmed
  // Auto-refresh every 5 seconds when there are pending posts
  const { data: posts, isLoading, isError, error, refetch } = useQuery<SocialPost[]>({
    queryKey: ['/api/social_posts'],
    enabled: authReady, // Only run when authenticated
    retry: 2,
    staleTime: 5 * 1000, // 5 seconds
    refetchInterval: (query) => {
      // Auto-poll every 5s if there are pending posts or videos generating
      const data = query.state.data;
      if (!data) return false;
      const hasPending = data.some(p => 
        p.status === 'PENDING' || 
        p.status === 'GENERATING' ||
        p.videoStatus === 'PENDING' ||
        p.videoStatus === 'GENERATING'
      );
      return hasPending ? 5000 : false;
    },
  });

  // Fetch all articles for the dropdown (up to 1000) - only when authenticated
  const { data: allArticles, isLoading: articlesLoading } = useQuery<Article[]>({
    queryKey: ['/api/articles/list', { limit: 1000 }],
    enabled: authReady, // Only run when authenticated
  });

  // Filter articles based on "latest" toggle and search
  const filteredArticles = useMemo(() => {
    if (!allArticles) return [];
    
    let filtered = allArticles;
    
    // Apply latest filter
    if (showLatestOnly) {
      filtered = filtered.slice(0, 20); // Show latest 20 articles
    }
    
    // Apply search filter
    if (searchTerm) {
      filtered = filtered.filter(article => 
        article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (article.location && article.location.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }
    
    return filtered;
  }, [allArticles, showLatestOnly, searchTerm]);

  // Find selected article
  const selectedArticle = useMemo(() => {
    if (!selectedArticleId) return null;
    return allArticles?.find(a => a.id.toString() === selectedArticleId) || null;
  }, [allArticles, selectedArticleId]);

  const handleRefresh = async () => {
    try {
      await refetch();
      toast({
        title: "Refreshed",
        description: "Social posts data has been updated",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to refresh data",
        variant: "destructive",
      });
    }
  };

  const platformIcon = (platform: string, className = "w-4 h-4") => {
    if (!platform) return <MessageSquare className={className} />;
    switch (platform.toLowerCase()) {
      case 'x':
      case 'twitter': 
        return <Twitter className={className} />;
      case 'facebook': 
        return <Facebook className={className} />;
      case 'instagram': 
        return <Instagram className={className} />;
      case 'linkedin': 
        return <Linkedin className={className} />;
      case 'pinterest': 
        return <Pin className={className} />;
      case 'tiktok':
        return <Video className={className} />;
      default: 
        return <MessageSquare className={className} />;
    }
  };

  const statusIcon = (status: string) => {
    if (!status) return <AlertCircle className="w-4 h-4 text-yellow-500" />;
    switch (status.toLowerCase()) {
      case 'ready':
      case 'published':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'scheduled':
        return <Clock className="w-4 h-4 text-blue-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'draft':
      case 'generating':
        return <RefreshCw className="w-4 h-4 text-blue-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-yellow-500" />;
    }
  };

  // Normalize platform names for consistent display
  const normalizePlatform = (platform: string): string => {
    if (!platform) return 'Unknown';
    const normalized = platform.toLowerCase();
    if (normalized === 'twitter' || normalized === 'x') return 'X';
    if (normalized === 'tiktok') return 'TikTok';
    return platform.charAt(0).toUpperCase() + platform.slice(1).toLowerCase();
  };

  // Calculate stats
  const stats: DashboardStats = {
    totalPosts: posts?.length || 0,
    byPlatform: {},
    byStatus: {},
    recentPosts: posts?.slice(0, 5) || [],
  };

  posts?.forEach(post => {
    const normalizedPlatform = normalizePlatform(post.platform);
    stats.byPlatform[normalizedPlatform] = (stats.byPlatform[normalizedPlatform] || 0) + 1;
    const normalizedStatus = post.status ? post.status.toUpperCase() : 'UNKNOWN';
    stats.byStatus[normalizedStatus] = (stats.byStatus[normalizedStatus] || 0) + 1;
  });

  const platforms = ['X', 'Instagram', 'Facebook', 'LinkedIn', 'Pinterest'];

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2" data-testid="text-page-title">
              Social Media Dashboard
            </h1>
            <p className="text-muted-foreground">
              Manage your AI-generated social media content across all platforms
            </p>
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <Button variant="outline" onClick={handleRefresh} disabled={isLoading} data-testid="button-refresh">
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Link href="/home">
              <Button variant="outline" data-testid="button-home">
                <Home className="w-4 h-4 mr-2" />
                Home
              </Button>
            </Link>
            <Link href="/social/create">
              <Button data-testid="button-create-post">
                <Plus className="w-4 h-4 mr-2" />
                Create Post
              </Button>
            </Link>
            <Link href="/social/idea-video">
              <Button variant="outline" data-testid="button-idea-video">
                <Video className="w-4 h-4 mr-2" />
                Idea to Video
              </Button>
            </Link>
          </div>
        </div>

        {/* Recent Articles - Quick Access */}
        <Card data-testid="card-recent-articles">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Recent Articles
            </CardTitle>
            <CardDescription>
              Your latest completed articles - click to generate social posts
            </CardDescription>
          </CardHeader>
          <CardContent>
            {articlesLoading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : allArticles && allArticles.length > 0 ? (
              <div className="space-y-4">
                {/* Filter Toggle */}
                <div className="flex items-center gap-2">
                  <Button
                    variant={showLatestOnly ? "default" : "outline"}
                    size="sm"
                    onClick={() => setShowLatestOnly(true)}
                    data-testid="button-show-latest"
                  >
                    <TrendingUp className="w-4 h-4 mr-2" />
                    Latest 20
                  </Button>
                  <Button
                    variant={!showLatestOnly ? "default" : "outline"}
                    size="sm"
                    onClick={() => setShowLatestOnly(false)}
                    data-testid="button-show-all"
                  >
                    All Articles ({allArticles?.length || 0})
                  </Button>
                </div>

                {/* Search Input */}
                <input
                  type="text"
                  placeholder="Search articles by title..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    // When searching, show all articles to search through everything
                    if (e.target.value && showLatestOnly) {
                      setShowLatestOnly(false);
                    }
                  }}
                  data-testid="input-search-articles"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />

                {/* Article List - Show articles directly */}
                <div className="border rounded-md max-h-64 overflow-y-auto">
                  {filteredArticles.length === 0 ? (
                    <div className="p-4 text-center text-muted-foreground">
                      {searchTerm ? (
                        <p>No articles match &quot;{searchTerm}&quot;</p>
                      ) : (
                        <p>No articles available</p>
                      )}
                    </div>
                  ) : (
                    filteredArticles.slice(0, 50).map((article) => (
                      <div
                        key={article.id}
                        onClick={() => setSelectedArticleId(article.id.toString())}
                        className={`p-3 cursor-pointer hover:bg-muted border-b last:border-b-0 transition-colors ${
                          selectedArticleId === article.id.toString() ? 'bg-primary/10 border-l-2 border-l-primary' : ''
                        }`}
                        data-testid={`article-item-${article.id}`}
                      >
                        <p className="text-sm font-medium line-clamp-1">{article.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          {article.word_count && (
                            <span className="text-xs text-muted-foreground">{article.word_count.toLocaleString()} words</span>
                          )}
                          {article.seo_score && (
                            <span className="text-xs text-muted-foreground">SEO: {article.seo_score}/100</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  {filteredArticles.length > 50 && (
                    <div className="p-2 text-center text-xs text-muted-foreground bg-muted">
                      Showing 50 of {filteredArticles.length} articles. Use search to narrow results.
                    </div>
                  )}
                </div>

                {/* Selected Article Preview */}
                {selectedArticle && (
                  <Card className="bg-muted/50">
                    <CardContent className="pt-4">
                      <div className="space-y-3">
                        <div>
                          <h4 className="font-medium text-sm mb-2">Selected Article:</h4>
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {selectedArticle.title}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {selectedArticle.location && (
                            <Badge variant="secondary" className="text-xs">
                              <MapPin className="w-3 h-3 mr-1" />
                              {selectedArticle.location}
                            </Badge>
                          )}
                          {selectedArticle.word_count && (
                            <Badge variant="secondary" className="text-xs">
                              <FileText className="w-3 h-3 mr-1" />
                              {selectedArticle.word_count.toLocaleString()} words
                            </Badge>
                          )}
                          {selectedArticle.seo_score && (
                            <Badge variant="secondary" className="text-xs">
                              <Target className="w-3 h-3 mr-1" />
                              SEO: {selectedArticle.seo_score}/100
                            </Badge>
                          )}
                        </div>
                        <Button 
                          className="w-full" 
                          onClick={() => router.push(`/social/create?articleId=${selectedArticle.id}`)}
                          data-testid="button-generate-from-selected"
                        >
                          <Sparkles className="w-4 h-4 mr-2" />
                          Generate Social Posts
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>No articles available</p>
                <p className="text-sm mt-1">Complete some articles to see them here</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Generation Progress Banner */}
        {((stats.byStatus['PENDING'] || 0) + (stats.byStatus['GENERATING'] || 0)) > 0 && (
          <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20" data-testid="card-generation-progress">
            <CardContent className="py-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-5 h-5 text-yellow-600 animate-spin" />
                  <span className="font-medium text-yellow-700 dark:text-yellow-400">
                    {(() => {
                      const inProgress = (stats.byStatus['PENDING'] || 0) + (stats.byStatus['GENERATING'] || 0);
                      return `Generating ${inProgress} post${inProgress > 1 ? 's' : ''}...`;
                    })()}
                  </span>
                </div>
                <div className="flex-1">
                  <div className="h-2 bg-yellow-200 dark:bg-yellow-900 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-yellow-500 rounded-full animate-pulse" 
                      style={{ width: '60%' }}
                    />
                  </div>
                </div>
                <span className="text-sm text-yellow-600 dark:text-yellow-400">
                  Auto-refreshing every 5s
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats Overview */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card data-testid="card-total-posts">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Posts</CardTitle>
              <MessageSquare className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-count">
                {stats.totalPosts}
              </div>
              <p className="text-xs text-muted-foreground">
                Across all platforms
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-published">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Published</CardTitle>
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600" data-testid="text-published-count">
                {stats.byStatus['PUBLISHED'] || 0}
              </div>
              <p className="text-xs text-muted-foreground">
                Live on social media
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-scheduled">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Scheduled</CardTitle>
              <Clock className="w-4 h-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600" data-testid="text-scheduled-count">
                {stats.byStatus['SCHEDULED'] || 0}
              </div>
              <p className="text-xs text-muted-foreground">
                Queued for posting
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-pending">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending</CardTitle>
              <AlertCircle className="w-4 h-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600" data-testid="text-pending-count">
                {stats.byStatus['PENDING'] || 0}
              </div>
              <p className="text-xs text-muted-foreground">
                Awaiting action
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Platform Distribution */}
        <Card data-testid="card-platform-distribution">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Platform Distribution
            </CardTitle>
            <CardDescription>Posts across all social platforms</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-5">
              {platforms.map(platform => (
                <div key={platform} className="flex flex-col items-center gap-2" data-testid={`platform-stat-${platform.toLowerCase()}`}>
                  <div className="flex items-center gap-2">
                    {platformIcon(platform, "w-5 h-5")}
                    <span className="text-sm font-medium">{platform}</span>
                  </div>
                  <div className="text-2xl font-bold text-primary">
                    {stats.byPlatform[platform] || 0}
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {stats.totalPosts > 0 
                      ? Math.round(((stats.byPlatform[platform] || 0) / stats.totalPosts) * 100)
                      : 0}%
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card data-testid="card-recent-activity">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              Recent Activity
            </CardTitle>
            <CardDescription>Your latest social media posts</CardDescription>
          </CardHeader>
          <CardContent>
            {authLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Checking authentication...
              </div>
            ) : authError || !authData?.user ? (
              <div className="text-center py-8">
                <LogIn className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground mb-4">Please sign in to view your posts</p>
                <Link href="/login">
                  <Button variant="outline" data-testid="button-login">
                    <LogIn className="w-4 h-4 mr-2" />
                    Sign In
                  </Button>
                </Link>
              </div>
            ) : isLoading || !authReady ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading recent posts...
              </div>
            ) : isError ? (
              <div className="text-center py-8">
                <AlertCircle className="w-12 h-12 mx-auto text-destructive mb-3" />
                <p className="text-destructive mb-2">Failed to load posts</p>
                <p className="text-muted-foreground text-sm mb-4">{error?.message || 'Unknown error'}</p>
                <Button variant="outline" onClick={() => refetch()} data-testid="button-retry">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Retry
                </Button>
              </div>
            ) : stats.recentPosts.length === 0 ? (
              <div className="text-center py-8">
                <MessageSquare className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground mb-4">No posts yet</p>
                <Link href="/social/create">
                  <Button variant="outline" data-testid="button-create-first">
                    <Plus className="w-4 h-4 mr-2" />
                    Create Your First Post
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {stats.recentPosts.map(post => (
                  <div 
                    key={post.id}
                    className="flex items-start gap-4 p-4 rounded-lg border hover-elevate"
                    data-testid={`recent-post-${post.id}`}
                  >
                    <div className="flex flex-col items-center gap-1">
                      {platformIcon(post.platform, "w-5 h-5")}
                      <Badge variant="secondary" className="text-xs">
                        {normalizePlatform(post.platform)}
                      </Badge>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm mb-1 line-clamp-1" data-testid={`title-${post.id}`}>
                        {post.title || post.topic || "Untitled Post"}
                      </h3>
                      <div className="flex items-center gap-2 mb-2">
                        {statusIcon(post.status)}
                        <Badge variant="outline" data-testid={`status-${post.id}`}>
                          {post.status}
                        </Badge>
                        {post.videoStatus && post.videoStatus !== 'NOT_STARTED' && (
                          <Badge variant="secondary" className="text-xs" data-testid={`video-status-${post.id}`}>
                            Video: {post.videoStatus}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {new Date(post.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2" data-testid={`caption-${post.id}`}>
                        {post.caption}
                      </p>
                      {post.hashtagsJson && post.hashtagsJson.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {post.hashtagsJson.slice(0, 5).map((tag, idx) => (
                            <Badge key={idx} variant="secondary" className="text-xs">
                              {getHashtagText(tag)}
                            </Badge>
                          ))}
                          {post.hashtagsJson.length > 5 && (
                            <Badge variant="secondary" className="text-xs">
                              +{post.hashtagsJson.length - 5} more
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Link href={`/social/${post.socialPostId}`}>
                        <Button size="sm" variant="outline" data-testid={`button-view-${post.id}`}>
                          View
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* All Posts by Platform */}
        <Card data-testid="card-all-posts">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              All Posts
            </CardTitle>
            <CardDescription>Browse posts by platform</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="All">
              <TabsList className="mb-4">
                <TabsTrigger value="All" data-testid="tab-all">
                  All ({stats.totalPosts})
                </TabsTrigger>
                {platforms.map(platform => (
                  <TabsTrigger 
                    key={platform} 
                    value={platform}
                    data-testid={`tab-${platform.toLowerCase()}`}
                  >
                    {platform} ({stats.byPlatform[platform] || 0})
                  </TabsTrigger>
                ))}
              </TabsList>

              {['All', ...platforms].map(platform => (
                <TabsContent key={platform} value={platform}>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {posts
                      ?.filter(post => platform === 'All' || normalizePlatform(post.platform) === platform)
                      .map(post => (
                        <Card key={post.id} data-testid={`post-card-${post.id}`} className="hover-elevate">
                          <CardHeader>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {platformIcon(post.platform)}
                                <CardTitle className="text-base line-clamp-1" title={post.title}>
                                  {post.title || post.topic || "Untitled Post"}
                                </CardTitle>
                              </div>
                              <div className="flex gap-2 items-center flex-wrap">
                                <Badge data-testid={`post-status-${post.id}`}>
                                  {post.status}
                                </Badge>
                                {post.videoStatus && post.videoStatus !== 'NOT_STARTED' && (
                                  <Badge variant="secondary" className="text-xs">
                                    Video: {post.videoStatus}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div data-testid={`platform-location-${post.id}`} className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Badge variant="outline" className="text-xs">
                                {normalizePlatform(post.platform)}
                              </Badge>
                              {post.location && (
                                <span className="text-xs flex items-center gap-1">
                                  <MapPin className="w-3 h-3" />
                                  {post.location}
                                </span>
                              )}
                              {post.articleId && (
                                <span className="text-xs">• Article #{post.articleId}</span>
                              )}
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <p className="text-sm line-clamp-3" data-testid={`post-caption-${post.id}`}>
                              {post.caption}
                            </p>
                            {post.hashtagsJson && post.hashtagsJson.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {post.hashtagsJson.slice(0, 8).map((tag, idx) => (
                                  <Badge key={idx} variant="secondary" className="text-xs">
                                    {getHashtagText(tag)}
                                  </Badge>
                                ))}
                              </div>
                            )}
                            <div className="flex gap-2">
                              <Link href={`/social/${post.socialPostId}`} className="flex-1">
                                <Button size="sm" variant="outline" className="w-full" data-testid={`button-view-detail-${post.id}`}>
                                  View Details
                                </Button>
                              </Link>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    {posts?.filter(post => platform === 'All' || normalizePlatform(post.platform) === platform).length === 0 && (
                      <div className="col-span-full text-center py-8 text-muted-foreground">
                        No posts for {platform}
                      </div>
                    )}
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
