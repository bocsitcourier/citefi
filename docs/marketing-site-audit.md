# Citefi marketing and conversion audit

## Full-product buyer-gap pass

The acquisition site now positions one free article as the entry offer rather
than the whole platform. Dedicated `/features` pages cover articles, images,
podcasts, social media, video, SEO/GEO, brand intelligence, campaigns, customer
journeys, publishing, learning/monitoring, agency clients/reports and ads exports.
Each has buyer context, inputs, deliverables, workflow, an explicitly illustrative
business application, review/setup boundaries, plan guidance, adjacent features
and matching visible FAQ/schema. The catalog also has page/breadcrumb/item-list
metadata linked to the truthful Citefi organization entity.

| Public page family | Buyer gap addressed |
|---|---|
| Homepage | Explicit multi-format proposition, paired free-sample/paid-plan entry, complete format directory and inspectable illustrative campaign |
| Approach/workflow/teams | Business brief → appropriate formats → campaign/journey → human review/delivery; workload, seats and client-workspace selection |
| Features index/details | Full scope and standalone, internally linked explanations instead of burying podcasts/images/social/video behind articles |
| Six industry pages | Audience-specific business question, pain, journey and multi-format planning example plus a paid-plan path |
| 272 city pages | Local-service-area framing, selectable industry journeys/examples, relevant format links and plan budgets; no Census-led sales pitch or invented local customer evidence |
| Pricing | Actual catalog/operation defaults, explicit monthly/annual choice, upfront annual amount and matching checkout interval |
| FAQ | Full-format/product questions, costs, configuration, review, free sampling versus paid work |
| Signup/login/MFA | Allowlisted plan and interval continuation, including a validated non-auth browser preference with 14-day expiry; no approval/payment bypass |
| Privacy/terms | Existing factual policies retained; not repurposed into sales copy |

Repeat the bounded gap check with `npm run audit:marketing`. It verifies product
coverage and minimum buyer-information contracts, source-evidence paths,
related destinations, metadata/sitemap/public registration, safe return paths
and preference expiry. Public defaults are separated from database-backed
credit overrides; the browser may not import the runtime billing database.

The architect review found annual checkout mismatch, dropped plan intent and
an existing unsafe scheme-relative login return. These were corrected before
browser verification. Monthly/annual signup → approval message → login/MFA →
plan return → checkout payload were browser-checked with synthetic intercepted
responses. No real accounts, emails, database writes, charges or media generation
were used; this is not proof of live payment/provider operation.

Remaining evidence gaps: no genuine customer testimonials/results supplied,
and no verified product-output showcase supplied. Illustrative briefs/outlines
are explicitly not generated output or customer proof. Website publishing still
depends on configured consent/receiver support; direct social publishing options
are disabled, and ads remain export-only. No search/citation/revenue guarantees.

Reviewed 2026-10-09. Scope: public acquisition pages, free-article conversion,
signup/login messaging, legal-page metadata, and a route inventory separating
workspace/admin tools from public marketing. This is not a claim that private
authenticated screens were browser-tested or redesigned.

## Diagnosis and positioning

The previous city pages sold population context instead of business value.
Other pages explained safeguards without enough evidence of what the buyer
could do next. Signup/login claimed unverified throughput and “zero guesswork.”
The offer had technical gates but too little explanation of the buyer journey.

Citefi's useful proposition is: turn the questions people ask before they call,
book or buy into reviewable marketing content, without requiring a busy owner
to become a full-time content team. Agencies also need separate client context
and understandable review decisions. One free article demonstrates the work;
it is not proof of leads, ranking improvements or campaign performance.

## Competitor benchmark — live official pages

Sources reviewed, not independently verified competitor performance:

- https://www.jasper.ai/ — product, role and use-case destinations; business
  context and governed workflows; attributed customer evidence.
- https://www.surferseo.com/ — buyer discovery proposition, clear next action,
  product demonstrations and attributed customer stories.
- https://www.copy.ai/ — workflows described against specific go-to-market jobs,
  not just AI model names; named customer quotations.
- https://www.hubspot.com/ — outcome-led language, distinct free and paid paths,
  product explanations and an explicit small-business offer.

We use these as structural benchmarks, not copy sources. Their customer quotes,
logos, adoption counts, certifications and performance statistics are not ours.

## Page-by-page public review

| Destination | Buyer job / previous gap | Implemented response |
| --- | --- | --- |
| `/` | Understand why to care; generic local-marketing language | Busy-owner problem, concrete sample brief and illustrative draft, customer journey, six business use cases, actual free-offer CTA |
| `/approach` | Understand why this rather than a blank general-AI prompt | Business context, useful buyer questions and human review; examples rather than model-name claims |
| `/workflow` | Understand what happens after a first draft | Brief, review and article-to-buyer-journey explanation; free sample vs ongoing work boundaries |
| `/for-teams` | Decide whether it fits owner, agency or reviewer | Distinct owner and agency/client paths; actual workspace boundaries |
| `/pricing` | Choose based on workload and budget | Existing billing catalog remains source of prices, credits, seats and plan features; free is one article, not monthly credits; existing real checkout kept |
| `/faq` | Resolve offer, accuracy, usage and payment objections | Practical answers matching visible FAQ structured data; approval/payment limitations explained |
| `/cities` | Find support for a service area | Searchable directory, useful business context and industry pathways; no population proposition |
| `/cities/[slug]` (272 routes) | Decide how content helps a local business | Business pain-led hero, representative business photo, six example questions, selectable four-stage industry journeys, city-preserving article links and FAQs |
| `/solutions` | Recognize the buyer's own type of business | Six substantive business-use-case destinations, representative licensed imagery |
| `/solutions/[slug]` (6 routes) | Connect content to real buying decisions | Specific pain, audience, first-article question and four stages with content/next-step suggestions; scenarios clearly illustrative |
| `/free-article` | Move from interest to actual sample | Editable city/topic/audience prefill, explicit preview/signup/paid progression, no automatic generation on arrival; existing ownership/access/spend gates unchanged |
| `/signup` | Understand what registration unlocks | Same full watermarked article after signup, approval still separate; unsupported speed/accuracy claims removed |
| `/login` | Continue existing work with clear expectations | Workspace-oriented language instead of a “dual-AI factory”; exaggerated throughput claims removed |
| `/privacy` | Evaluate information handling | Original legal substance preserved; distinct canonical/share metadata |
| `/terms` | Understand paid usage and free-offer limitations | Distinct metadata plus explicit one-article, watermarked-reading, approval and paid-reuse boundaries; no screenshot guarantee |
| `/home` (protected) | Orient after login | Removed unsupported “enterprise-grade dual-AI factory” positioning; workspace description follows the customer-first language |

Public destinations have crawlable links and relevant FAQs; detail pages have
their own canonical and share URLs. Login/signup are noindex rather than public
SEO landing pages. Free-article output remains private/noindex. The sitemap
retains all city destinations and includes industry destinations.

## Customer journeys

Two different journeys must not be confused:

1. **A small business's customer journey:** identify a problem, compare options,
   take an actual contact/booking/buying step, then get useful follow-up. Each
   industry has a concrete illustrative four-stage example. These are planning
   tools, not automated customer outreach or proven case studies.
2. **The Citefi purchase journey:** page/use case → editable brief → anonymous
   excerpt → signup for the same watermarked article → account approval →
   normal sign-in → paid subscription → application copy/download/export.

URL prefill carries context only. It cannot change ownership, paid access,
permissions, article identity or generation admission; it never submits itself.

## Private-route inventory / boundary

The following are product or administrative tools, not acquisition pages. Do
not turn them into crawlable landing pages, add marketing testimonials to them,
or bypass sign-in in the name of SEO:

- Workspace: `/dashboard`, `/home`, `/onboarding`, `/wizard`, `/content`,
  `/content/[id]`, `/batches/[id]`, `/batches/[id]/select`, `/campaigns`,
  `/campaigns/new`, `/campaigns/[id]`, `/monitoring`, `/intelligence`,
  `/personas`, `/learning`, `/journeys`, `/seo-tools`, `/media`, `/site-map`.
- Social: `/social`, `/social/create`, `/social/dashboard`,
  `/social/idea-video`, `/social/[id]`.
- Agency/client: `/agency`, `/agency/reports`, `/client-dashboard`, `/client`,
  `/client/billing`, `/client/content`, `/client/reports`, `/client/review`,
  `/client/team`, `/client/usage`.
- Settings: `/settings`, `/settings/billing`, `/settings/brief`,
  `/settings/publishing`, `/settings/publishing/job`,
  `/settings/publishing/jobs`, `/settings/schedules`.
- Admin: `/admin`, `/admin/activity-logs`, `/admin/analytics`, `/admin/briefs`,
  `/admin/cleanup`, `/admin/content`, `/admin/cost-telemetry`, `/admin/credits`,
  `/admin/error-logs`, `/admin/error-logs/[id]`, `/admin/feedback`,
  `/admin/health`, `/admin/login-history`, `/admin/quotas`, `/admin/sessions`,
  `/admin/settings`, `/admin/users`, `/admin/users/[id]`.
- Utility/capability routes: `/forgot-password`, `/reset-password/[token]`,
  `/verify-2fa`, `/accept-invite/[token]`, `/embed/[id]`,
  `/examples/optimized-media`. These have their own access or capability
  semantics and are not to be repurposed as acquisition content.

## Evidence gaps — do not mask them with design

- No verified Citefi customer testimonials or approved customer portraits were
  found in this audit. Web search returned similarly named unrelated companies;
  none is Citefi proof. Existing users/feedback are not marketing consent.
- Photographs are small licensed Pexels stock assets, visibly representative,
  never identified as a local customer or a specified city scene. Provenance
  is in `public/marketing/photos/README.md`.
- City pages describe remotely available content support. They do not establish
  local offices, named customers or original neighborhood research. Their
  shared structure is deliberate, not independent evidence about every city.
- The external Stripe sandbox purchase/webhook still needs its separate end-to-end
  verification. This marketing pass does not establish production checkout health.
- No promise of rankings, AI citations, leads, conversions or screenshot blocking.
- No production deployment is performed as part of this audit/rebuild.

## Acceptance checks

- Industry data and editable URL-context round trip tested locally, including
  field allowlist and length bounds.
- All public static destinations and all six industry destinations checked for
  successful rendering, correct canonical/share URL, visible FAQs where applicable,
  and working internal destinations. All 272 city destinations responded successfully;
  Boston, New York and Honolulu also received metadata/visible-schema checks.
- Type check and representative desktop/mobile visual checks.
- No paid model generation, new live accounts or real payment used for this pass.

Architect review identified two corrections: distinguish drafting from separately
authorized connected publishing, and use horizontal clipping rather than a
vertical clipping container so the marketing header can remain sticky. Both
were corrected without modifying any publishing authorization or paid-access code.
