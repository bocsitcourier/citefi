"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Globe, RefreshCw, Trash2, ArrowLeft, ExternalLink, Search, Loader2, CheckCircle, XCircle, Clock } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

interface SitePage {
  id: number;
  domain: string;
  url: string;
  path: string;
  title: string | null;
  metaDescription: string | null;
  pageType: string | null;
  wordCount: number | null;
  topics: string[] | null;
  lastCrawledAt: string | null;
}

interface CrawlJob {
  id: number;
  domain: string;
  baseUrl: string;
  status: string;
  maxPages: number | null;
  pagesFound: number | null;
  pagesIndexed: number | null;
  errorMessage: string | null;
  createdAt: string | null;
  completedAt: string | null;
}

export default function SiteMapPage() {
  const { user } = useAuth();
  const [crawlUrl, setCrawlUrl] = useState("");
  const [maxPages, setMaxPages] = useState(50);
  const [isCrawling, setIsCrawling] = useState(false);
  const [pages, setPages] = useState<SitePage[]>([]);
  const [crawlJobs, setCrawlJobs] = useState<CrawlJob[]>([]);
  const [isLoadingPages, setIsLoadingPages] = useState(true);
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [filterDomain, setFilterDomain] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const fetchPages = useCallback(async () => {
    try {
      const token = localStorage.getItem("auth_token");
      const params = new URLSearchParams();
      if (filterDomain) params.set("domain", filterDomain);
      const res = await fetch(`/api/site-map/pages?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setPages(data);
      }
    } catch {
    } finally {
      setIsLoadingPages(false);
    }
  }, [filterDomain]);

  const fetchJobs = useCallback(async () => {
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/site-map/jobs", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setCrawlJobs(data);
      }
    } catch {
    } finally {
      setIsLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    fetchPages();
    fetchJobs();
  }, [fetchPages, fetchJobs]);

  useEffect(() => {
    const hasRunning = crawlJobs.some(j => j.status === "PENDING" || j.status === "RUNNING");
    if (!hasRunning) return;
    const interval = setInterval(() => {
      fetchJobs();
      fetchPages();
    }, 5000);
    return () => clearInterval(interval);
  }, [crawlJobs, fetchJobs, fetchPages]);

  const startCrawl = async () => {
    setError("");
    setSuccessMsg("");
    if (!crawlUrl) {
      setError("Please enter a website URL");
      return;
    }
    try {
      new URL(crawlUrl);
    } catch {
      setError("Please enter a valid URL (e.g. https://example.com)");
      return;
    }

    setIsCrawling(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/site-map/crawl", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ baseUrl: crawlUrl, maxPages, maxDepth: 3 }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(data.message);
        setCrawlUrl("");
        fetchJobs();
      } else {
        setError(data.error || "Failed to start crawl");
      }
    } catch (e: any) {
      setError(e.message || "Network error");
    } finally {
      setIsCrawling(false);
    }
  };

  const deleteDomain = async (domain: string) => {
    if (!confirm(`Remove all indexed pages for ${domain}?`)) return;
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/site-map/pages?domain=${encodeURIComponent(domain)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setSuccessMsg(`All pages for ${domain} removed`);
        fetchPages();
      }
    } catch {}
  };

  const deletePage = async (pageId: number) => {
    try {
      const token = localStorage.getItem("auth_token");
      await fetch(`/api/site-map/pages?id=${pageId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchPages();
    } catch {}
  };

  const domains = [...new Set(pages.map(p => p.domain))];
  const filteredPages = pages.filter(p => {
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      return (
        p.url.toLowerCase().includes(lower) ||
        (p.title || "").toLowerCase().includes(lower) ||
        (p.pageType || "").toLowerCase().includes(lower)
      );
    }
    return true;
  });

  const pageTypeColors: Record<string, string> = {
    homepage: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    blog: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    service: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    product: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    about: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
    contact: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    faq: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
    location: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    page: "bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200",
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "COMPLETED": return <CheckCircle className="w-4 h-4 text-green-500" />;
      case "FAILED": return <XCircle className="w-4 h-4 text-red-500" />;
      case "RUNNING": return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      default: return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-8 py-8 space-y-8">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <Link href="/home">
              <Button variant="ghost" size="icon" data-testid="button-back-home">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold" data-testid="text-page-title">Site Map Manager</h1>
              <p className="text-muted-foreground">
                Crawl your website to enable multi-URL contextual hyperlinking in articles
              </p>
            </div>
          </div>
          <Badge variant="outline" className="no-default-active-elevate" data-testid="badge-page-count">
            {pages.length} pages indexed
          </Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-primary" />
              Crawl Website
            </CardTitle>
            <CardDescription>
              Enter a website URL to discover and index its pages. The crawler will follow internal links
              to map your site structure, enabling articles to link to the most relevant pages.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3 flex-wrap">
              <Input
                placeholder="https://yourwebsite.com"
                value={crawlUrl}
                onChange={(e) => setCrawlUrl(e.target.value)}
                className="flex-1 min-w-[250px]"
                data-testid="input-crawl-url"
              />
              <Input
                type="number"
                placeholder="Max pages"
                value={maxPages}
                onChange={(e) => setMaxPages(parseInt(e.target.value) || 50)}
                className="w-[120px]"
                min={5}
                max={200}
                data-testid="input-max-pages"
              />
              <Button onClick={startCrawl} disabled={isCrawling} data-testid="button-start-crawl">
                {isCrawling ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Globe className="w-4 h-4 mr-2" />
                )}
                {isCrawling ? "Starting..." : "Start Crawl"}
              </Button>
            </div>
            {error && <p className="text-sm text-destructive" data-testid="text-error">{error}</p>}
            {successMsg && <p className="text-sm text-green-600 dark:text-green-400" data-testid="text-success">{successMsg}</p>}
          </CardContent>
        </Card>

        {crawlJobs.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-primary" />
                Crawl History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {crawlJobs.slice(0, 10).map((job) => (
                  <div key={job.id} className="flex items-center justify-between gap-4 p-3 rounded-md border" data-testid={`crawl-job-${job.id}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      {statusIcon(job.status)}
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate" data-testid={`text-job-domain-${job.id}`}>{job.domain}</p>
                        <p className="text-xs text-muted-foreground">
                          {job.pagesIndexed || 0} indexed / {job.pagesFound || 0} found
                          {job.createdAt && ` • ${new Date(job.createdAt).toLocaleDateString()}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={job.status === "COMPLETED" ? "default" : job.status === "FAILED" ? "destructive" : "secondary"} data-testid={`badge-job-status-${job.id}`}>
                        {job.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <CardTitle className="flex items-center gap-2">
                <Search className="w-5 h-5 text-primary" />
                Indexed Pages
              </CardTitle>
              <div className="flex gap-2 flex-wrap">
                {domains.length > 1 && (
                  <select
                    className="text-sm border rounded-md px-2 py-1 bg-background"
                    value={filterDomain}
                    onChange={(e) => setFilterDomain(e.target.value)}
                    data-testid="select-filter-domain"
                  >
                    <option value="">All domains</option>
                    {domains.map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                )}
                <Input
                  placeholder="Search pages..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-[200px]"
                  data-testid="input-search-pages"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingPages ? (
              <div className="flex items-center justify-center py-8" data-testid="loading-pages">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredPages.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground" data-testid="text-no-pages">
                No pages indexed yet. Start by crawling your website above.
              </p>
            ) : (
              <div className="space-y-2">
                {domains.map(domain => {
                  const domainPages = filteredPages.filter(p => p.domain === domain);
                  if (domainPages.length === 0) return null;
                  return (
                    <div key={domain} className="space-y-2">
                      <div className="flex items-center justify-between gap-4 py-2 border-b">
                        <h3 className="font-semibold text-sm" data-testid={`text-domain-${domain}`}>{domain} ({domainPages.length} pages)</h3>
                        <Button variant="ghost" size="sm" onClick={() => deleteDomain(domain)} data-testid={`button-delete-domain-${domain}`}>
                          <Trash2 className="w-3 h-3 mr-1" />
                          Remove All
                        </Button>
                      </div>
                      {domainPages.map((page) => (
                        <div key={page.id} className="flex items-start justify-between gap-3 p-3 rounded-md border" data-testid={`page-row-${page.id}`}>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-sm truncate" data-testid={`text-page-title-${page.id}`}>
                                {page.title || page.path}
                              </p>
                              {page.pageType && (
                                <Badge variant="secondary" className={`text-xs no-default-active-elevate ${pageTypeColors[page.pageType] || ""}`} data-testid={`badge-page-type-${page.id}`}>
                                  {page.pageType}
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate" data-testid={`text-page-url-${page.id}`}>
                              {page.path}
                            </p>
                            {page.metaDescription && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                {page.metaDescription}
                              </p>
                            )}
                            {page.topics && page.topics.length > 0 && (
                              <div className="flex gap-1 mt-1 flex-wrap">
                                {page.topics.slice(0, 4).map((t, i) => (
                                  <Badge key={i} variant="outline" className="text-xs no-default-active-elevate">{t}</Badge>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {page.wordCount && (
                              <span className="text-xs text-muted-foreground whitespace-nowrap">{page.wordCount}w</span>
                            )}
                            <a href={page.url} target="_blank" rel="noopener noreferrer">
                              <Button variant="ghost" size="icon" data-testid={`button-open-page-${page.id}`}>
                                <ExternalLink className="w-3 h-3" />
                              </Button>
                            </a>
                            <Button variant="ghost" size="icon" onClick={() => deletePage(page.id)} data-testid={`button-delete-page-${page.id}`}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
