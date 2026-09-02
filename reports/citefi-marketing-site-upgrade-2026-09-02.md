# Citefi Marketing Site Upgrade

**Date:** September 2, 2026  
**Status:** Implemented in development; production launch remains subject to the existing certification gates.

## Objective

Develop the supplied marketing concept into a production-quality Citefi landing page without carrying forward unsupported performance claims, fabricated social proof, or capabilities that conflict with locked product policy.

## Architect roadmap

1. **Truth and capability inventory**
   - Treat the repository, billing catalog, decision register, and launch certification as authoritative.
   - Remove unsupported customer counts, testimonials, rankings, ROI figures, cost multipliers, and GEO outcomes.
   - Keep Ads export-only and require human review and manual platform upload.

2. **Positioning and content**
   - Position Citefi as a local marketing campaign engine.
   - Emphasize business context, separate client workspaces, review, approvals, and export controls.
   - Describe evidence states honestly rather than promising rankings or citations.

3. **Visual implementation**
   - Preserve the concept's warm, editorial character and concrete campaign-work visuals.
   - Use the existing Next.js font and component systems.
   - Derive public plan prices, credits, and limits from the runtime billing catalog.

4. **Accessibility and responsive behavior**
   - Provide working desktop and mobile navigation.
   - Use semantic FAQ controls with expanded-state metadata.
   - Preserve visible focus, reduced-motion behavior, large touch targets, and narrow-screen reflow.

5. **Metadata and verification**
   - Replace unsupported metadata claims with the same truthful campaign-engine positioning.
   - Verify policy language, runtime pricing, startup behavior, and desktop rendering.

## Competitive analysis

| Competitor | Public strength | Table-stakes lesson |
|---|---|---|
| BrightLocal | Local rank, listings, reviews, citations, and agency reporting | Local data and client reporting are expected, not unique |
| Semrush | Broad SEO intelligence, agency tools, and AI visibility | Generic visibility and competitive-intelligence claims need real measurements |
| Vendasta | Agency CRM, billing, fulfillment, marketplace, and automation | “All in one” and “scale without headcount” are crowded claims |
| Jasper | Brand-aware AI content, governance, agents, and GEO positioning | AI writing and brand voice alone are not differentiation |
| HighLevel | Agency subaccounts, CRM automation, integrations, and approvals | Multi-client workspaces and automation are category basics |

### Defensible Citefi position

Citefi's strongest current position is not “more AI.” It is a locally informed campaign workspace that keeps business context, generated work, client boundaries, review, and consequential external action under human control.

Safe proof points:

- Separate client workspaces and balances on the Agency plan.
- Articles, social content, video-script, podcast, and batch-generation capabilities based on plan.
- Brand and Campaign context foundations for locally informed generation.
- Human review before external action.
- Export-only Ads posture with no autonomous platform spend.
- Pricing and credit limits sourced from the live catalog.

Roadmap-only or certification-dependent claims remain omitted:

- Guaranteed rankings, citations, leads, or return on spend.
- Proven GEO/AEO visibility outcomes.
- Direct Google or Meta ad publishing and spend.
- Complete immutable provenance across every derivative.
- One URL producing a complete governed campaign.
- Fabricated customer proof or performance statistics.

## Implemented upgrade

- Rebuilt the public homepage with a distinct editorial visual direction.
- Added clear approach, workflow, agency/local-team, trust, pricing, FAQ, and conversion content.
- Added accessible desktop and mobile navigation.
- Added semantic FAQ expansion controls.
- Added a clear Ads export/manual-upload boundary.
- Added Free, Starter, Growth, Agency, and sales-assisted Enterprise pricing using the billing catalog.
- Updated title, description, keywords, Open Graph, and Twitter metadata.
- Scoped the marketing palette and body type treatment to the landing page so authenticated product screens retain their existing theme.
- Preserved authenticated-user redirect behavior and working login/signup routes.

## Acceptance status

- Development workflow starts and serves the new homepage.
- Desktop preview renders successfully.
- No modified-file TypeScript errors were found in the repository-wide check.
- Repository-wide TypeScript validation still reports unrelated pre-existing errors outside the homepage files.
- Production status remains unchanged: this page does not bypass or alter launch certification.