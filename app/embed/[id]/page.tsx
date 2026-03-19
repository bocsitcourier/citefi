"use client";

import { useQuery } from "@tanstack/react-query";
import { use } from "react";
import { Loader2 } from "lucide-react";

interface Article {
  id: number;
  title: string;
  seoTitle: string | null;
  metaDescription: string | null;
  htmlContent: string | null;
  heroImageUrl: string | null;
  createdAt: string;
}

interface ArticleResponse {
  article: Article;
}

export default function EmbedArticle({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const articleId = resolvedParams.id;

  const { data, isLoading, error } = useQuery<ArticleResponse>({
    queryKey: [`/api/content/${articleId}`],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Article Not Found</h2>
          <p className="text-muted-foreground">This article could not be loaded.</p>
        </div>
      </div>
    );
  }

  const { article } = data;

  return (
    <div className="min-h-screen bg-background">
      <article className="max-w-4xl mx-auto px-4 py-8">
        {/* Hero Image */}
        {article.heroImageUrl && (
          <div className="mb-8 rounded-lg overflow-hidden shadow-lg">
            <img
              src={article.heroImageUrl}
              alt={article.title}
              className="w-full h-auto object-cover max-h-[400px]"
            />
          </div>
        )}

        {/* Article Title */}
        <h1 className="text-4xl font-bold mb-4 text-foreground">
          {article.seoTitle || article.title}
        </h1>

        {/* Meta Description */}
        {article.metaDescription && (
          <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
            {article.metaDescription}
          </p>
        )}

        {/* Article Content */}
        {article.htmlContent && (
          <div
            className="prose prose-lg max-w-none dark:prose-invert
              prose-headings:text-foreground
              prose-p:text-foreground
              prose-a:text-primary prose-a:no-underline hover:prose-a:underline
              prose-strong:text-foreground
              prose-ul:text-foreground
              prose-ol:text-foreground
              prose-li:text-foreground
              prose-table:border-collapse prose-table:w-full
              prose-th:border prose-th:border-border prose-th:p-2 prose-th:bg-muted prose-th:font-bold
              prose-td:border prose-td:border-border prose-td:p-2
              prose-img:rounded-lg prose-img:max-w-full prose-img:h-auto prose-img:shadow-md
              prose-video:rounded-lg prose-video:max-w-full
              [&_audio]:w-full [&_audio]:rounded-md
              [&_ul[data-type='taskList']]:list-none [&_ul[data-type='taskList']]:pl-0
              [&_li[data-type='taskItem']]:flex [&_li[data-type='taskItem']]:items-start [&_li[data-type='taskItem']]:gap-2
              prose-iframe:w-full prose-iframe:aspect-video prose-iframe:rounded-lg
              [&_.hashtags]:mt-8 [&_.hashtags]:pt-4 [&_.hashtags]:border-t [&_.hashtags]:border-border
              [&_.hashtag-link]:inline-block [&_.hashtag-link]:px-2 [&_.hashtag-link]:py-1 [&_.hashtag-link]:mr-2 [&_.hashtag-link]:mb-2
              [&_.hashtag-link]:text-sm [&_.hashtag-link]:font-medium [&_.hashtag-link]:text-primary
              [&_.hashtag-link]:border [&_.hashtag-link]:border-primary [&_.hashtag-link]:rounded-md
              [&_.hashtag-link]:no-underline [&_.hashtag-link:hover]:bg-primary [&_.hashtag-link:hover]:text-primary-foreground
              [&_.hashtag-link]:transition-colors"
            dangerouslySetInnerHTML={{ __html: article.htmlContent }}
          />
        )}

        {/* Subtle Footer */}
        <div className="mt-12 pt-6 border-t border-border">
          <p className="text-xs text-muted-foreground text-center">
            Published on {new Date(article.createdAt).toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
          </p>
        </div>
      </article>
    </div>
  );
}
