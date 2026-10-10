# Citefi product scope and buyer-gap audit

The owner rejected article-only positioning. Citefi is a multi-format marketing
workspace for small businesses and agencies. One free article is the entry offer,
not the scope of the paid product.

## Verified capabilities for public marketing

| Capability | Product evidence | Buyer value and boundaries |
|---|---|---|
| Articles and research | `app/content/[id]/page.tsx`, article-generation worker in `lib/worker.ts`, `lib/credit-menu.ts` | Explain customer questions, prepare researched drafts, manage revisions and batches. Default article operation is 10 credits; defaults can be overridden. Human fact checking remains required. |
| Images and media | `app/media/page.tsx`, media/image regeneration controls in `app/content/[id]/page.tsx` | Generate and organize visual assets, upload business imagery, edit descriptions and reuse assets. No claim of exclusive rights, exact likeness, or stock people being customers. |
| Podcasts | `app/api/podcast/generate/route.ts`, article podcast controls in `app/content/[id]/page.tsx` | Turn an owned article into a podcast script and generated audio, with tone/duration controls. Default podcast operation is 8 credits. Do not promise voice cloning, podcast-directory distribution or a free podcast in the article trial. |
| Social media | `app/social/create/page.tsx`, `app/social/[id]/page.tsx`, `app/api/social_posts/generate/route.ts` | Platform-shaped posts and variants, associated visuals and review. Default social batch 4 credits; single post 1. Generating social content is not direct social-network publishing. |
| Video | `app/social/idea-video/page.tsx`, `app/api/social/video/generate/route.ts`, `app/api/social/video/idea/route.ts` | Idea-to-video and social-video workflows, scripts and narration/media generation. Default video operation is 15 credits for the menu's 60-second operation; output settings/provider availability affect jobs. Do not promise every requested duration, instant results or inclusion in the free trial. |
| SEO and AI-search preparation | `app/api/seo/content-audit/route.ts`, `app/api/seo/pillar-cluster/route.ts`, `app/api/seo/schema-markup/route.ts`, `app/api/seo/local-research/route.ts` | Audits, content structure, topic/cluster planning and schema preparation. No guaranteed rankings or AI citations. GEO means useful, understandable evidence for answer engines, not invented geographical image metadata. |
| Brand intelligence and personas | `app/intelligence/page.tsx`, `app/personas/page.tsx`, `app/api/intelligence/route.ts` | Business/brand context, research and audience personas to guide drafts. Persona outputs are planning aids, not evidence that actual buyers were interviewed. |
| Campaign workspace | `app/campaigns/page.tsx`, `app/api/campaigns/route.ts` | Keep goal, campaign brand snapshot and deliverables together. Campaigns do not autonomously authorize publication or ad spending. |
| Customer journeys | `app/journeys/page.tsx`, `app/api/journeys/route.ts`, `app/api/journeys/templates/route.ts` | Plan staged content, review next steps and use supported scheduled orchestration. No claim of an email CRM, automatic messages on every channel, or guaranteed attribution. |
| Publishing and schedules | `app/settings/publishing/page.tsx`, `app/api/publishing/jobs/route.ts`, `app/settings/schedules/page.tsx` | Website receiver connection and separately authorized publishing/scheduling workflows. Facebook, LinkedIn and TikTok connection options are currently disabled in the product UI: NEVER market direct publishing to those networks as live. Setup, consent and configuration are required. |
| Learning and monitoring | `app/learning/page.tsx`, `app/monitoring/page.tsx`, `lib/learning-integration.ts` | Inspect available content/learning signals and use feedback to improve decisions. Learning depends on available data; not guaranteed improvement or universal external analytics. |
| Agency clients and reports | `app/agency/page.tsx`, `app/agency/reports/page.tsx`, `app/client/review/page.tsx`, `app/client/reports/page.tsx` | Separate client workspaces, review, approved client-safe reports. Agency catalog: 25 seats / 25 client workspaces, separate balances. Do not imply pooled credits, invoicing clients or unrestricted cross-client access. |
| Ads briefs and exports | `app/api/campaigns/[id]/ads/route.ts` and approval/export subroutes, `lib/credit-menu.ts` | Google RSA/Meta creative export packs where configured. Default ads export pack 5 credits. Export-only: no autonomous ad launch or spend; evidence, approval and export controls remain required. |

## Commercial truth

Use `lib/billing/plans.ts` and `lib/credit-menu.ts`, never duplicated invented
prices. Starter $29/50 credits/3 seats; Growth $89/200/10; Agency $249/1000/25
and up to 25 client workspaces. Enterprise is sales-assisted. Catalog feature
lists describe plans; do not invent a feature-unlock matrix from recommendations.
Annual billing charges ten monthly prices up front for twelve service months;
credits refresh monthly. Admin/team operation overrides can change default costs.

Free preview → signup → same watermarked article. Approval and ordinary sign-in
are still required for workspace access and checkout. Paid reuse/export gates
must not be bypassed by marketing links. Do not promise instant approval.

## Buyer-gap questions used while building

For each product, core, industry and city page:
1. Does a busy owner understand the problem this solves?
2. Are the actual inputs and usable deliverables explained?
3. Does it show how articles, images, social, podcasts and video connect where relevant?
4. Is there a concrete, explicitly illustrative business example?
5. Can the buyer understand setup, review, availability, cost and plan selection?
6. Are free sampling and paid multi-format work clearly distinguished?
7. Is there a next step both for trying the article and comparing/buying a plan?
8. Are FAQ/schema, public links, images and metadata consistent with the visible page?
9. Have we avoided imaginary reviews, local offices, results, timings or integrations?

This is an iterative build audit and a repeatable automated check, not a promise
of a permanently running marketing agent. Private/admin tools remain private.
