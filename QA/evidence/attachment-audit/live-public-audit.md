# Citefi live public browser audit

**Audit date:** 2026-10-08 (UTC)  
**Primary target:** `https://citefi.co`  
**Comparison target:** `https://contentualyzai.replit.app` (checked separately; not assumed to be the same build)  
**Scope:** Read-only public visitor journey in fresh browser contexts. No sign-in, credentials, recovery submission, signup, billing, campaign, generation, publishing, integration, database, or cleanup actions.

## Primary live site: observed results

| Step | Observation |
|---|---|
| Homepage | `GET https://citefi.co/` returned **200** at `2026-10-08T20:31:53.104Z`; title: `Local SEO Content Platform for Agencies \| Citefi`. Hero and public navigation rendered. |
| Login navigation | The visible Log in link opened `/login`. A later direct `GET https://citefi.co/login` returned **200** at `2026-10-08T20:33:19.909Z`; required email/password inputs were blank. |
| Forgot password | The visible Forgot Password link opened `https://citefi.co/forgot-password`. The email input was blank. **Send Reset Code was not clicked.** The immediate Playwright log raced and showed the prior `/login` URL; the subsequent page observation confirmed `/forgot-password`. |
| Signed-out dashboard | Direct navigation requested `https://citefi.co/dashboard` at `2026-10-08T20:32:10.138Z` and received **200**. The rendered signed-out page was the login form at `/login`; dashboard content was not exposed. The immediate URL log raced during the client-side redirect, so the captured page state is the basis for the final route observation. |
| Empty login validation | With both required fields confirmed empty, clicking Login displayed native browser validation, `Please fill out this field.`; the URL stayed `/login`, and the captured non-navigation request list was empty. No credentials were entered or sent. |
| Pricing | The visible Pricing navigation link brought the pricing section into view. The captured URL remained `/` without a `#pricing` fragment. The visible plans were Starter **$29/mo**, Growth **$89/mo**, and Agency **$249/mo**. Plan/signup CTAs were not activated. |
| Privacy and Terms | Actual footer links opened readable public pages at `/privacy` and `/terms`. Both documents showed June 23, 2026 effective/updated dates and long-form numbered policy/terms content. The immediate SPA logs printed the prior route during both clicks; captured page observations confirmed the destination routes. |
| Mobile | At 390×844, the Terms document and landing hero were readable in a single-column layout. On the landing page, `scrollWidth` and `clientWidth` were both 375px; no horizontal overflow was observed. The mobile menu remained closed. |
| Browser errors | A final reload of `/login` returned **200** and captured **`GET https://citefi.co/api/auth/me` → 401** at `2026-10-08T20:33:36.432Z`. No uncaught page errors were captured in that reload. The 401 did not produce a visible user-facing error on the login screen. Chromium also reported a non-blocking password `autocomplete` advisory. |

## Separate Replit deployment

In a separate fresh browser context:

- `GET https://contentualyzai.replit.app/` returned **200** at `2026-10-08T20:33:05.627Z`; title: `Local SEO Content Engine for Agencies | Citefi`.
- `GET https://contentualyzai.replit.app/login` returned **200** at `2026-10-08T20:33:14.578Z`; the required email/password controls were blank.
- A generic 401 resource-load console error was observed on the Replit homepage; its request URL was not captured. No user-facing error appeared.
- The different hostname and page title are recorded as separate-deployment evidence only. Feature parity was not inferred or certified.

## Screenshots

Browser-captured evidence IDs (available with the audit response; screenshot files could not be exported from the browser tool into this workspace):

- `bme9jp` — primary production desktop homepage.
- `emvivc` — primary production login.
- `wyql0c` — primary production forgot-password form, blank and not submitted.
- `58xiel` — signed-out dashboard attempt rendered the login page.
- `bsf5bh` — native empty-login validation.
- `l7j5tr` — primary production pricing section.
- `rw1399` — primary production Privacy Policy.
- `tgb7x6` — primary production Terms of Use.
- `qer4h4` — Terms of Use at 390×844.
- `kh7sf9` — primary production mobile homepage.
- `poowyq` — separate Replit homepage.
- `2wmxwz` — separate Replit login with blank required fields.
- `k2oktg` — primary production login at 390×844.
- `04cc6s` — primary production login reload and network-error capture.

## Result and limits

The requested public, signed-out visitor journey completed without production writes. Public pages and route rendering were observed; the native empty-form guard blocked submission. The `/api/auth/me` 401 and SPA URL-log timing discrepancies are recorded above.

Authenticated campaign creation, AI/media generation, editing, credit usage, QA approval, scheduling, integrations, publication, analytics, persistence across an authorized workspace, spend controls, and cleanup remain **BLOCKED / NOT TESTED**. The supplied test workspace, authorized test account/role, destinations, credit budget, and spend ceiling are unconfigured placeholders; no account or production scope was invented. No application code or workflow was changed or restarted. No cleanup inventory was created because no artifacts were created.
