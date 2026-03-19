import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, jobBatches } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import archiver from "archiver";
import { PassThrough } from "stream";
import { requireTeamMember } from "@/lib/api/auth";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // CRITICAL: Verify authentication and get team context
    const { teamId } = await requireTeamMember(request);

    const { id } = await context.params;
    const batchId = parseInt(id);

    if (isNaN(batchId)) {
      return NextResponse.json(
        { error: "Invalid batch ID" },
        { status: 400 }
      );
    }

    // CRITICAL: Verify batch belongs to user's team
    const [batch] = await db
      .select()
      .from(jobBatches)
      .where(
        and(
          eq(jobBatches.id, batchId),
          eq(jobBatches.teamId, teamId) // TEAM ISOLATION
        )
      );

    if (!batch) {
      return NextResponse.json(
        { error: "Batch not found or access denied" },
        { status: 404 }
      );
    }

    const batchArticles = await db
      .select()
      .from(articles)
      .where(eq(articles.batchId, batchId));

    if (batchArticles.length === 0) {
      return NextResponse.json(
        { error: "No articles found in this batch" },
        { status: 404 }
      );
    }

    const archive = archiver('zip', { zlib: { level: 9 } });
    const passThrough = new PassThrough();
    
    archive.pipe(passThrough);

    archive.on('error', (err) => {
      console.error('Archive error:', err);
      passThrough.destroy(err);
    });
    
    const csvData = generateCSVReport(batchArticles);
    archive.append(csvData, { name: 'metadata.csv' });

    for (const article of batchArticles) {
      if (article.finalHtmlContent) {
        const slug = article.slug || `article-${article.id}`;
        
        archive.append(article.finalHtmlContent, { name: `html/${slug}.html` });
        
        const markdown = htmlToMarkdown(article.finalHtmlContent);
        archive.append(markdown, { name: `markdown/${slug}.md` });
      }
    }

    archive.finalize();

    return new NextResponse(passThrough as any, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="batch-${batchId}-export.zip"`,
      },
    });

  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json(
      { error: "Failed to export batch", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

function generateCSVReport(articles: any[]): string {
  const headers = ['ID', 'Title', 'SEO Title', 'Slug', 'Word Count', 'Status', 'Created At', 'Updated At'];
  const rows = articles.map(a => [
    a.id,
    `"${(a.chosenTitle || '').replace(/"/g, '""')}"`,
    `"${(a.seoTitle || '').replace(/"/g, '""')}"`,
    a.slug || '',
    a.wordCount || 0,
    a.articleStatus,
    a.createdAt,
    a.updatedAt,
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

function htmlToMarkdown(html: string): string {
  let md = html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
    .replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi, '![$2]($1)')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');

  return md.trim();
}
