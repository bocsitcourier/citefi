<!--
═══════════════════════════════════════════════════════════════════════
DRAFTING NOTES — DELETE THIS ENTIRE BLOCK BEFORE PUBLISHING
═══════════════════════════════════════════════════════════════════════
This is a DRAFT for attorney review — not finished legal advice. Citefi
processes third parties' personal data (reviews), holds clients'
publishing credentials, and routes data through third-party AI models, so
have a SaaS/privacy lawyer review before going live.

FILL IN THESE PLACEHOLDERS (search for [ ]):
  [LEGAL ENTITY NAME]   e.g., "Citefi, Inc." or "Citefi LLC"
  [STATE]               state of incorporation / governing law (Delaware is common for US SaaS)
  [MAILING ADDRESS]     registered business address
  [PRIVACY EMAIL]       e.g., privacy@citefi.us
  [SUPPORT EMAIL]       e.g., support@citefi.us
  [EFFECTIVE DATE]      launch date

KEY ASSUMPTIONS BAKED IN (confirm with counsel):
  • US entity, US-only launch, selling to BOTH agencies (white-label) and SMBs.
  • Citefi is a CONTROLLER for account/billing/usage data, and a
    PROCESSOR / "service provider" for Customer Content (reviews, connected-
    account data, and the personal data inside it).
  • Reviews arrive via BOTH client upload AND API pulls — both covered.
  • Stripe = payments; DigitalOcean = hosting; third-party LLMs = AI
    sub-processors. UPDATE the sub-processor list (Section 6) to match reality.
  • CCPA/CPRA + the US state-law patchwork addressed; GDPR kept light
    (US-only now) but the processor framing is GDPR-ready for later expansion.
  • TODO: publish a live sub-processor list page and a Data Processing
    Addendum (DPA) for business customers; this policy references both.
═══════════════════════════════════════════════════════════════════════
-->

# Citefi Privacy Policy

**Effective Date:** [EFFECTIVE DATE]
**Last Updated:** [EFFECTIVE DATE]

## 1. Introduction

This Privacy Policy explains how [LEGAL ENTITY NAME] ("**Citefi**," "**we**," "**us**," or "**our**") collects, uses, discloses, and protects information in connection with the Citefi platform, websites, and related services (collectively, the "**Services**"). Citefi provides an AI-assisted content generation, optimization, and publishing platform for businesses and marketing agencies.

By accessing or using the Services, you acknowledge that you have read and understood this Privacy Policy. If you do not agree, please do not use the Services.

This Policy works alongside our Terms of Use and, for business customers, any Data Processing Addendum ("**DPA**") we enter into with you.

## 2. Who This Policy Covers and Our Roles

The Services are designed for business use. We interact with two main categories of individuals, and our role differs for each:

- **Customers and their personnel** — the businesses and agencies that subscribe to the Services, and the individual users who access an account ("**Customers**" and "**Authorized Users**"). For information about these individuals and accounts (registration, billing, usage), **Citefi acts as a controller** (or, under U.S. state laws, a "business").

- **Data subjects within Customer Content** — individuals whose personal information appears in the content, reviews, datasets, or connected accounts that a Customer uploads, connects, or instructs us to process ("**End Data Subjects**"). For this information, **Citefi acts as a processor / "service provider,"** processing it only on the Customer's behalf and under the Customer's instructions. **The Customer is the controller of that information.** If you are an End Data Subject and wish to exercise rights over your personal information, please contact the relevant Customer (the business whose reviews or data are being processed); we will assist that Customer as required. See Section 11.

For agency Customers using the Services on behalf of their own clients, the agency (or its client) is the controller, and Citefi acts as a processor or sub-processor accordingly.

## 3. Information We Collect

**a) Account and Profile Information.** Name, business name, email address, username, password (hashed), role, and similar details you provide when registering or managing an account.

**b) Payment Information.** Subscription and billing details. **Payments are processed by Stripe, Inc.** We do not store full payment card numbers on our systems; Stripe collects and processes card data under its own privacy policy. We may receive limited billing metadata (e.g., plan, transaction status, last four digits, billing contact).

**c) Customer Content and Connected Data.** The materials you provide to or connect with the Services so we can perform them, including:
  - Content you upload (e.g., review files via CSV/JSON, documents, datasets, brand guidelines);
  - Data we retrieve on your instruction through connected third-party accounts and APIs (e.g., business review profiles, app-store reviews, analytics, CMS content);
  - Generated drafts, briefs, and other outputs created through the Services.

Customer Content may contain personal information about End Data Subjects (for example, the names or details of reviewers). We process this information **as a service provider/processor on your behalf**, solely to provide and improve the Services as instructed and as permitted by law and our agreement with you.

**d) Connected-Account Credentials and Tokens.** When you connect a third-party service for publishing or data retrieval (e.g., WordPress, other CMS platforms, email/newsletter providers, social or analytics accounts), we collect and store the credentials, access tokens, or API keys needed to perform the actions you authorize. These are **stored in encrypted form**, used only to perform the Services you direct (such as publishing content you approve), and never sold or used for unrelated purposes. You can disconnect an integration or revoke access at any time. See Section 8.

**e) Usage, Device, and Log Information.** Information about how you interact with the Services, including IP address, browser and device type, pages and features used, actions taken, timestamps, and diagnostic/error logs.

**f) Publicly Available Monitoring Data.** In providing competitor- and market-monitoring features, the Services access publicly available web pages, feeds, and APIs that you configure. We process only publicly accessible information and operate within applicable terms and law; we do not access login-protected, paywalled, or otherwise restricted sources, and we do not bypass technical access controls.

**g) Communications and Support.** Information you provide when you contact us, request support, respond to surveys, or sign up for communications.

**h) Cookies and Similar Technologies.** See Section 14.

## 4. How We Use Information

We use information to:
- Provide, operate, maintain, and secure the Services;
- Create and manage accounts and authenticate users;
- Process subscriptions, payments, usage metering, and billing;
- Generate, optimize, schedule, and publish content as you direct;
- Perform sentiment, review, competitor, and performance analysis as part of the Services;
- Provide customer support and respond to inquiries;
- Monitor, troubleshoot, improve, and develop the Services and new features;
- Detect, prevent, and address fraud, abuse, security incidents, and technical issues;
- Send service-related communications and, where permitted, marketing communications (which you can opt out of); and
- Comply with legal obligations and enforce our agreements.

We use **Customer Content and the personal information within it only to provide the Services to the relevant Customer** and as instructed by that Customer, except as required by law. We do not use one Customer's Customer Content to benefit another Customer, and we do not pool or share Customer Content across Customers, without the providing Customer's explicit instruction or consent.

## 5. Artificial Intelligence and Automated Content Generation

The Services use artificial intelligence and machine-learning models — including third-party large language models (LLMs) — to generate, analyze, and optimize content. As part of providing the Services:
- Customer Content and prompts may be transmitted to and processed by third-party AI providers acting as our **sub-processors** (see Section 6);
- We seek to use AI providers and configurations that **do not train their models on Customer Content**, and we configure available privacy settings accordingly. Where a Customer requires stronger guarantees, enterprise options with contractual no-training commitments may be available;
- **AI-generated output may be inaccurate, incomplete, or unsuitable.** Outputs should be reviewed by a human before use or publication. Citefi does not warrant the accuracy of AI-generated content. Your responsibilities regarding AI output, including any legally required disclosure that content is AI-generated, are addressed in our Terms of Use.

## 6. How We Share and Disclose Information

We do **not sell** your personal information, and we do not "share" it for cross-context behavioral advertising, as those terms are defined under U.S. state privacy laws. We disclose information only as follows:

**a) Service Providers and Sub-Processors.** We use trusted third parties to help operate the Services, bound by contractual confidentiality and data-protection obligations. Current categories include:
  - **Payment processing:** Stripe, Inc.
  - **Cloud hosting and infrastructure:** DigitalOcean, LLC.
  - **AI / large language model providers:** [LIST YOUR PROVIDERS — e.g., Google (Gemini), Groq, etc.].
  - **Analytics, email, and operational tools:** [LIST AS APPLICABLE].

  We maintain a current list of sub-processors at [LINK TO SUB-PROCESSOR PAGE]. *(Action: publish and link this page.)*

**b) At Your Direction.** When you connect or instruct us to publish to or retrieve from a third-party service, we share information with that service as needed to perform the action you authorized.

**c) Legal and Safety.** To comply with applicable law, regulation, legal process, or governmental request; to enforce our Terms; and to protect the rights, property, safety, or security of Citefi, our Customers, or others.

**d) Business Transfers.** In connection with a merger, acquisition, financing, reorganization, or sale of assets, information may be transferred as part of that transaction, subject to this Policy.

**e) With Consent.** For any other purpose disclosed to you with your consent.

## 7. Data Retention and Deletion

We retain personal information for as long as needed to provide the Services, comply with legal obligations, resolve disputes, and enforce our agreements. We retain Customer Content for the duration of the Customer's subscription and as instructed by the Customer.

Upon account termination, or upon a Customer's verified request, we will delete or de-identify Customer Content and revoke stored connected-account credentials within a commercially reasonable period, except where retention is required by law or for legitimate business purposes (such as backups, security, or dispute resolution). Customers may export their data before termination as described in our Terms.

## 8. Security

We implement administrative, technical, and physical safeguards designed to protect information, including:
- Encryption of data in transit (TLS) and at rest;
- Storage of connected-account credentials and tokens in a dedicated, encrypted secrets store, scoped per Customer;
- Logical tenant isolation and access controls to separate Customers' data;
- Role-based access, least-privilege principles, and audit logging;
- Monitoring, and credential revocation upon disconnection or termination.

No method of transmission or storage is completely secure. While we work to protect your information, we cannot guarantee absolute security. You are responsible for maintaining the confidentiality of your account credentials.

## 9. International Data Transfers

Citefi is based in the United States, and we currently operate and process data in the United States. The Services are presently intended for users in the United States. If you access the Services from outside the United States, you understand that your information will be processed in the United States, where data-protection laws may differ from those of your jurisdiction.

## 10. Your U.S. Privacy Rights

Depending on your state of residence (including California, Virginia, Colorado, Connecticut, Utah, Texas, and other states with comprehensive privacy laws), you may have rights regarding personal information that we process **as a controller/business**, including the right to:
- Know or access the personal information we hold about you;
- Correct inaccurate personal information;
- Delete personal information;
- Obtain a portable copy of your information;
- Opt out of the "sale" or "sharing" of personal information and certain profiling (note: **we do not sell or share personal information**); and
- Not receive discriminatory treatment for exercising your rights.

To exercise these rights, contact us at [PRIVACY EMAIL]. We will verify your request as required by law. You may use an authorized agent where permitted. If we deny a request, you may appeal by replying to our response; you may also have the right to contact your state attorney general.

**California "Do Not Sell or Share":** We do not sell or share personal information as defined under the CCPA/CPRA. We also do not knowingly process sensitive personal information for purposes requiring an opt-out beyond providing the Services.

**Note on Customer Content:** The rights above apply to information for which Citefi is the controller/business. For personal information contained in Customer Content (where Citefi is a service provider/processor), please see Section 11.

## 11. Customer Content and Customer Responsibilities

Where Citefi processes personal information **on behalf of a Customer** (including reviews and connected-account data), the Customer is responsible for:
- Having a valid legal basis and any required consents or notices to provide that information to us and to have us process it;
- Responding to requests from End Data Subjects to exercise their rights.

If you are an End Data Subject seeking to access, correct, or delete personal information contained in a Customer's content, please contact the relevant Customer directly. Upon a Customer's instruction, **we will assist the Customer** in fulfilling such requests as required by applicable law and our agreement. Business Customers should refer to our DPA for details on processing roles and obligations.

## 12. Children's Privacy

The Services are not directed to, and not intended for use by, individuals under the age of 18, and we do not knowingly collect personal information from children. If you believe a child has provided us personal information, contact us at [PRIVACY EMAIL] and we will take appropriate steps to delete it.

## 13. Third-Party Services and Links

The Services integrate with and may link to third-party services (e.g., Stripe, CMS platforms, AI providers, analytics tools). Those services are governed by their own privacy policies, and we are not responsible for their practices. We encourage you to review them.

## 14. Cookies and Similar Technologies

We and our providers use cookies and similar technologies to operate and secure the Services, remember preferences, authenticate users, and analyze usage. You can control cookies through your browser settings; disabling some cookies may affect functionality. [If you use analytics or non-essential cookies, describe them and any opt-out/consent banner here.]

## 15. Changes to This Privacy Policy

We may update this Privacy Policy from time to time. We will post the updated version with a revised "Last Updated" date and, for material changes, provide additional notice (such as by email or in-product notice) where required. Your continued use of the Services after the effective date constitutes acceptance of the updated Policy.

## 16. Contact Us

If you have questions about this Privacy Policy or our privacy practices, contact us at:

**[LEGAL ENTITY NAME]**
Attn: Privacy
[MAILING ADDRESS]
[PRIVACY EMAIL]
