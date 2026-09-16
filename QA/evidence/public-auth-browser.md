# Public authentication browser verification

Evidence mode: native browser, unauthenticated public UI only.

Targeted follow-up completed; no code or workflow changes made.

- Used one existing browser context and a fresh page, hard-loaded `/login` once, then clicked Forgot Password and waited up to 20 seconds. Navigation succeeded to `/forgot-password` after the app had warmed/compiled. The prior click blocker was not reproduced; this is recorded as a temporary cold/HMR observation, not a code fix.
- No failed RSC/chunk/navigation GET was observed. Captured GET aborts were `/icon.png` and `/api/auth/me` with `net::ERR_ABORTED` from the test harness's non-GET/HEAD safety interception context. Browser logs showed the expected anonymous `/api/auth/me` 401s, plus HMR/React messages; no hydration/page errors. A smooth-scroll warning and autocomplete warnings were non-blocking.
- `/forgot-password` rendered as a hydrated reset-entry page with `Forgot Password`, Email address field, `Send Reset Code`, and `Back to login`. No reset value was entered and no reset request was sent.
- Back to login succeeded.
- Sign up navigation succeeded to `/signup`; the hydrated `Create Account` page rendered with empty controls and disabled `Create Account`. No signup data was entered or submitted. Sign in returned successfully to `/login`.
- Mobile check at 390x844 succeeded on `/login`: `scrollWidth=390`, `scrollHeight=844`; no horizontal overflow or extra page height. Email/password fields, visibility toggle, remember checkbox, Forgot Password, Login, and Sign up remained visible and usable. Labels wrap naturally but are not clipped or overlapped.
- Explicit direct same-app GET to `/forgot-password` also succeeded and confirmed the hydrated reset UI (`input-email` count 1, `button-send-code` count 1), shown at the final 390x844 viewport.

Previously verified items were not rerun: password toggle, remember checkbox, empty required validation, and invalid-email validation. No valid email/password, auth attempt, signup/reset submission, external publication/payment, provider call, email send, DB write, source edit, or workflow restart occurred. No successful sign-in/MFA/backend reset is claimed.

The earlier cold/HMR navigation observation is superseded by this successful targeted follow-up. No source fix was made for it. Backend authentication, MFA, signup, and reset submission remain outside this browser evidence.
