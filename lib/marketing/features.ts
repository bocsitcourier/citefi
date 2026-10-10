import { CREDIT_MENU, type OperationType } from "@/lib/credit-menu-defaults";

type FeatureSeed = {
  slug: string; name: string; summary: string; pain: string; audience: string;
  inputs: string[]; outputs: string[]; process: string[];
  example: { business: string; goal: string; deliverables: string[] };
  boundary: string; related: string[]; evidence: string[]; creditOperation?: OperationType;
};
export type ProductFeature = FeatureSeed & {
  steps: { title: string; body: string }[];
  faqs: { question: string; answer: string }[];
};

function feature(seed: FeatureSeed): ProductFeature {
  const cost = seed.creditOperation ? `The current default ${seed.creditOperation.replaceAll("_", " ")} operation is ${CREDIT_MENU[seed.creditOperation]} credits. Team or administrator overrides can change defaults; additional operations use additional credits.` : "Credit use depends on the operations you run. Compare monthly credit allowances and check the current operation settings in Billing.";
  return {
    ...seed,
    steps: seed.process.map((body, index) => ({ title: ["Set the direction", "Prepare the work", "Review with care", "Choose the next action"][index]!, body })),
    faqs: [
      { question: `Who is ${seed.name.toLowerCase()} useful for?`, answer: `${seed.audience} ${seed.pain}` },
      { question: `What do I need to provide for ${seed.name.toLowerCase()}?`, answer: seed.inputs.join(" ") },
      { question: `What will I get from ${seed.name.toLowerCase()}?`, answer: seed.outputs.join(" ") },
      { question: "How does this connect to the rest of my marketing?", answer: `Use the same verified business context across related work: ${seed.related.map(slug => slug.replaceAll("-", " ")).join(", ")}. Choose formats that fit the customer's question and next step, rather than making every format for every topic.` },
      { question: "What should I budget and which plan should I compare?", answer: `${cost} Starter, Growth and Agency offer different credit allowances, seat counts and client-workspace limits. Recommendations are not a feature-unlock guarantee; compare the current catalog and any setup requirements before purchasing.` },
      { question: "Is this included in the free article offer?", answer: seed.slug === "articles" ? "The free offer creates one article. Preview an excerpt before signup, then read that same full article with a watermark after signup. Paid copy, download and export require an approved, signed-in account and a paid subscription." : "No. The free entry offer is one article, not free monthly credits or free multi-format generation. You can use that article to evaluate the starting workflow, then compare paid plans for ongoing work. Workspace access and checkout require account approval and sign-in." },
      { question: "What are the setup and review requirements?", answer: seed.boundary },
    ],
  };
}

export const productFeatures: ProductFeature[] = [
  feature({
    slug: "articles", name: "Articles & research", summary: "Answer the questions customers ask before they call, compare or buy.",
    pain: "You know your service, but writing a useful explanation from scratch takes time away from running it.", audience: "Owners building website content and agencies preparing client articles.",
    inputs: ["Your business, service and audience.", "A real customer question and the action you want readers to take.", "Verified policies, claims, links and service-area details."],
    outputs: ["Research-informed article drafts.", "Content you can review, revise and keep in a library.", "A starting point for related social, podcast and video work."],
    process: ["Choose a customer question and supply business context.", "Prepare the researched article through the content workflow.", "Check sources, local details, promises and calls to action.", "Revise, reuse or separately authorize supported publishing."],
    example: { business: "Home-service owner", goal: "Help homeowners understand what to ask before booking a repair.", deliverables: ["An estimate-preparation article.", "A visual checklist and three social answers.", "An article-derived audio recap and a short video script."] },
    boundary: "Generated research and drafts need human fact checking. Batch work and media use their own operations. No ranking or lead guarantee; generating an article does not publish it.",
    related: ["images", "social-media", "podcasts", "seo-geo"], evidence: ["app/content/[id]/page.tsx", "lib/worker.ts"], creditOperation: "article",
  }),
  feature({
    slug: "images", name: "Images & media", summary: "Give your message a visual counterpart and keep useful assets organized.",
    pain: "A good offer is easy to miss when the visual is missing, mismatched or lost in someone's downloads.", audience: "Businesses and agencies preparing visual marketing assets.",
    inputs: ["The purpose, subject and intended use of the image.", "Your brand context and any business imagery you have permission to use.", "An accurate image description and the facts reviewers must check."],
    outputs: ["Generated visual assets through supported image workflows.", "An organized media library with previews and reusable assets.", "Image regeneration and description controls in supported article/media screens."],
    process: ["Decide what the visual should explain and where it will be used.", "Generate or upload an asset and keep it connected to the work.", "Check visual accuracy, permissions, branding and accessibility text.", "Use the approved asset in related articles, social drafts or other deliverables."],
    example: { business: "Local retailer", goal: "Explain the difference between two product choices.", deliverables: ["A comparison-image brief.", "A website buying guide and matching social creative.", "A checked asset kept in the media library for reuse."] },
    boundary: "AI imagery needs review and does not establish exact likeness, exclusive rights or actual customer identity. Credit charges depend on the image/regeneration operation; the free article offer is not a separate free image plan.",
    related: ["articles", "social-media", "video", "brand-intelligence"], evidence: ["app/media/page.tsx", "app/content/[id]/page.tsx"],
  }),
  feature({
    slug: "podcasts", name: "Podcasts & audio", summary: "Let customers listen to an explanation you have already developed.",
    pain: "Some customers would rather listen than read, but producing an audio version creates another job on your list.", audience: "Owners and agencies repurposing owned articles into audio.",
    inputs: ["An article owned by your workspace.", "The tone and supported duration you want.", "Reviewed facts and pronunciation-sensitive names or details."],
    outputs: ["A podcast script and generated audio.", "Article-connected podcast controls and an audio asset.", "Another format for explaining your service without starting the topic again."],
    process: ["Choose the article and set tone and supported duration.", "Generate the script/audio through the podcast workflow.", "Listen for factual accuracy, tone, names and pronunciation.", "Reuse the approved audio in your own supported distribution workflow."],
    example: { business: "Professional adviser", goal: "Help prospects prepare for their first consultation.", deliverables: ["A written preparation checklist.", "An article-derived podcast script and audio recap.", "Social drafts pointing customers toward the preparation guide."] },
    boundary: "Podcast jobs require paid-workspace eligibility, credits and configured providers. Output needs review. Voice cloning and automatic podcast-directory distribution are not promised.",
    related: ["articles", "social-media", "campaigns"], evidence: ["app/api/podcast/generate/route.ts", "app/content/[id]/page.tsx"], creditOperation: "podcast",
  }),
  feature({
    slug: "social-media", name: "Social media content", summary: "Keep your channels useful without rewriting every message from scratch.",
    pain: "You need a steady reason to show up, but every platform and post feels like a separate writing assignment.", audience: "Small businesses maintaining social channels and agencies preparing client posts.",
    inputs: ["Your topic, audience, platforms and goal.", "Business context, approved offer details and links.", "Image/logo assets you are permitted to use."],
    outputs: ["Platform-shaped social drafts and multiple variants.", "Associated visual/media workflows where configured.", "Reviewable posts connected to a broader campaign."],
    process: ["Choose the customer question, channels and business context.", "Generate platform-shaped drafts and variants.", "Check facts, captions, links, imagery and platform fit.", "Use approved drafts in your posting workflow; generation is not publication."],
    example: { business: "Restaurant owner", goal: "Answer practical questions before a group visit.", deliverables: ["Social drafts about booking, menu and arrival.", "A linked visit-planning article and representative visual brief.", "A reviewed short-video outline for the same occasion."] },
    boundary: "Direct Facebook, LinkedIn and TikTok publishing connections are currently disabled in the product UI. Social content generation does not post to those networks; use your external posting workflow.",
    related: ["images", "video", "campaigns", "customer-journeys"], evidence: ["app/social/create/page.tsx", "app/api/social_posts/generate/route.ts"], creditOperation: "social_batch",
  }),
  feature({
    slug: "video", name: "Video & scripts", summary: "Turn an explanation into a short visual story customers can follow.",
    pain: "You have ideas worth explaining, but starting with a blank script and assembling media is a lot of work.", audience: "Owners and teams developing short marketing-video content.",
    inputs: ["An idea, audience and intended action.", "Business/brand context and permitted logos or imagery.", "Supported generation settings and a reviewed script direction."],
    outputs: ["Idea-to-video and social-video workflows.", "Video scripts, narration and generated media where configured.", "Reviewable video assets alongside related campaign content."],
    process: ["Choose one message and its intended customer action.", "Prepare the script and supported video/narration generation.", "Review the spoken claims, visuals, branding and final asset.", "Use the approved video in your external or supported delivery workflow."],
    example: { business: "Home-service business", goal: "Explain what a customer should have ready before a visit.", deliverables: ["A preparation-video script.", "Narration/media through supported video generation.", "An article and social drafts covering the same questions."] },
    boundary: "Available settings, durations and outputs depend on provider configuration and job limits. No instant completion or exact visual likeness is promised. The free article does not include free video generation.",
    related: ["images", "social-media", "articles"], evidence: ["app/social/idea-video/page.tsx", "app/api/social/video/generate/route.ts"], creditOperation: "video",
  }),
  feature({
    slug: "seo-geo", name: "SEO & AI-search preparation", summary: "Plan clear, useful answers for searchers and AI answer engines.",
    pain: "Publishing more content is not a strategy if customers' questions, site structure and evidence are missing.", audience: "Businesses improving website content and agencies planning search-oriented work.",
    inputs: ["Your site/content and the audience you serve.", "Questions, topics, local coverage and verified business evidence.", "Current pages and known gaps you want to investigate."],
    outputs: ["Content audits and structure recommendations.", "Topic and pillar/cluster planning.", "Schema-markup preparation and local/competitive research workflows."],
    process: ["Start from customer questions and the site evidence available.", "Audit content and plan useful structure or related topics.", "Verify recommendations, structured data and business claims.", "Create or improve the actual pages and monitor available signals."],
    example: { business: "Local professional practice", goal: "Explain services and preparation questions clearly.", deliverables: ["A service-page content audit.", "A related-question article cluster.", "Reviewed FAQ/schema preparation grounded in real business details."] },
    boundary: "SEO/GEO preparation cannot guarantee rankings, AI citations or inquiries. GEO means generative-engine visibility, not inventing geographic facts. Implement recommendations and measure real outcomes.",
    related: ["articles", "brand-intelligence", "learning-monitoring"], evidence: ["app/api/seo/content-audit/route.ts", "app/api/seo/pillar-cluster/route.ts"], creditOperation: "content_audit",
  }),
  feature({
    slug: "brand-intelligence", name: "Brand intelligence & personas", summary: "Keep the customer, offer and voice behind the content—not just a prompt.",
    pain: "Generic drafts miss why customers choose you and make every revision another explanation of the business.", audience: "Owners defining their message and agencies managing different client voices.",
    inputs: ["Business and brand information.", "The audience, offer, positioning and evidence you can verify.", "Research inputs and real customer observations where available."],
    outputs: ["Brand-intelligence research and context.", "Audience/persona planning aids.", "A clearer direction for campaign and content briefs."],
    process: ["Supply real business context and audience questions.", "Develop brand intelligence and persona planning inputs.", "Compare the suggestions with actual customers and evidence.", "Apply the reviewed context to campaigns and multi-format drafts."],
    example: { business: "Specialist local shop", goal: "Explain who its products are useful for.", deliverables: ["A reviewed audience/brand brief.", "A buying guide and social drafts in a consistent direction.", "Image/video briefs focused on the same customer question."] },
    boundary: "Personas and research are planning aids, not proof that actual customers were interviewed. Campaign brand snapshots and client boundaries must remain distinct from mutable team profiles.",
    related: ["campaigns", "articles", "images", "agency-reports"], evidence: ["app/intelligence/page.tsx", "app/personas/page.tsx"],
  }),
  feature({
    slug: "campaigns", name: "Campaign workspace", summary: "Make the article, social post, visual and next step part of the same plan.",
    pain: "Disconnected assets make it hard to see what the campaign is saying, what is missing and what should happen next.", audience: "Owners coordinating marketing work and teams assembling client deliverables.",
    inputs: ["A campaign goal and intended buyer action.", "The campaign's business/brand context and approved claims.", "The formats and reviewers relevant to the job."],
    outputs: ["An organized campaign workspace.", "Campaign-specific context and connected deliverables.", "A clearer view of drafts, review and related work."],
    process: ["Set the campaign goal and its verified brand context.", "Prepare the deliverables appropriate to the audience.", "Review consistency, evidence and the customer next step.", "Use approved work through separately authorized delivery workflows."],
    example: { business: "Retail shop", goal: "Help shoppers choose a product for an occasion.", deliverables: ["A buying-guide article.", "Visual assets, social drafts and an audio/video explanation.", "A clear collection, purchase or inquiry next step using real policies."] },
    boundary: "A campaign is not authorization to publish or spend ad budget. Availability and charges depend on the operations used; generating every format is not required for every campaign.",
    related: ["customer-journeys", "social-media", "podcasts", "ads-exports"], evidence: ["app/campaigns/page.tsx", "app/api/campaigns/route.ts"],
  }),
  feature({
    slug: "customer-journeys", name: "Customer journeys", summary: "Help the customer move from a question to a confident next step.",
    pain: "A one-off post rarely answers everything a buyer needs to understand, compare and act.", audience: "Businesses planning a sequence of helpful content and agencies coordinating campaigns.",
    inputs: ["Your goal, audience and buying stages.", "The questions or objections at each stage.", "Reviewed next steps, cadence and supported delivery settings."],
    outputs: ["Journey plans and templates.", "Staged content and next-step planning.", "Supported scheduled orchestration and reviewable progression."],
    process: ["Map what the buyer needs before taking action.", "Choose useful content and next steps for each stage.", "Review the sequence, consent and supported scheduling.", "Use the configured journey workflow and assess available feedback."],
    example: { business: "Real-estate agent", goal: "Help a seller prepare to choose an agent.", deliverables: ["An educational preparation article.", "Social questions and an audio/video recap for comparison.", "A real consultation-preparation next step and follow-up content plan."] },
    boundary: "Journeys are not an email CRM or automatic messages on every channel. Supported orchestration, consent, scheduling and data availability govern what runs; attribution is not guaranteed.",
    related: ["campaigns", "articles", "social-media", "learning-monitoring"], evidence: ["app/journeys/page.tsx", "app/api/journeys/templates/route.ts"],
  }),
  feature({
    slug: "publishing", name: "Publishing & schedules", summary: "Keep a deliberate path from approved content to your supported website.",
    pain: "Finished work still needs a controlled handoff, the right connection and a clear decision about what can go live.", audience: "Teams configuring supported website publication and content scheduling.",
    inputs: ["A supported website receiver connection.", "The reviewed content and exact publishing authorization.", "Required configuration and scheduling choices."],
    outputs: ["Website receiver publishing connections.", "Separately authorized publishing jobs.", "Supported schedule controls and job visibility."],
    process: ["Configure the supported receiver and permissions.", "Select reviewed content and the authorized destination.", "Confirm the exact scope and scheduling configuration.", "Run the authorized publishing workflow and inspect job status."],
    example: { business: "Local service business", goal: "Publish an approved service explainer to its connected website.", deliverables: ["A reviewed article.", "A configured website receiver connection.", "An explicitly authorized publishing job and inspected status."] },
    boundary: "Website receiver publishing requires setup and exact consent. Facebook, LinkedIn and TikTok connections are currently disabled. Draft creation alone never authorizes publication, and ads remain export-only.",
    related: ["articles", "campaigns", "customer-journeys"], evidence: ["app/settings/publishing/page.tsx", "app/api/publishing/jobs/route.ts"],
  }),
  feature({
    slug: "learning-monitoring", name: "Learning & monitoring", summary: "Use the feedback you actually have to make better content decisions.",
    pain: "It is easy to keep producing the same work without knowing which questions or formats deserve another look.", audience: "Owners reviewing their content and agencies improving recurring work.",
    inputs: ["Content and signals available in the workspace.", "Your review feedback and business objectives.", "Enough relevant observations for a useful comparison."],
    outputs: ["Monitoring and learning views.", "Available content signals and pattern-based decision support.", "Inputs for revising future briefs and experiments."],
    process: ["Choose the content and available signals you want to inspect.", "Review workspace monitoring and learning information.", "Distinguish real evidence from assumptions or sparse data.", "Adjust the next content brief and compare subsequent available signals."],
    example: { business: "Multi-service business", goal: "Decide which recurring customer questions need clearer answers.", deliverables: ["A review of available content signals.", "An updated article/social brief.", "A documented decision about the next useful experiment."] },
    boundary: "Learning depends on available, relevant data and does not guarantee improvement. Do not assume universal external analytics, closed-loop revenue attribution or access to every channel.",
    related: ["seo-geo", "customer-journeys", "campaigns"], evidence: ["app/learning/page.tsx", "app/monitoring/page.tsx"],
  }),
  feature({
    slug: "agency-reports", name: "Agency clients & reports", summary: "Serve more clients without mixing their context, work or review.",
    pain: "Each client needs a distinct voice, a clean approval path and an understandable view of the work.", audience: "Agencies and teams managing multiple client workspaces.",
    inputs: ["Separate client workspaces and each client's approved context.", "Reviewers, permissions and reporting periods.", "The client-safe work and evidence appropriate to share."],
    outputs: ["Client-workspace management.", "Content review and approved client-safe reports.", "Distinct client contexts and separate credit balances."],
    process: ["Set up the appropriate client workspace and permissions.", "Prepare client-specific multi-format work and reports.", "Get the relevant human review and approval.", "Deliver approved client-safe work without crossing client boundaries."],
    example: { business: "Local-business agency", goal: "Prepare a coherent monthly handoff for a client.", deliverables: ["A client-specific article and social drafts.", "Associated podcast/video/visual work where appropriate.", "A reviewed client-safe report and clear next-month content plan."] },
    boundary: "The Agency catalog includes up to 25 seats and 25 child client workspaces with separate balances. Citefi does not pool client credits or invoice the agency's customers. Reporting and delivery require the applicable permissions and approvals.",
    related: ["brand-intelligence", "campaigns", "learning-monitoring"], evidence: ["app/agency/page.tsx", "app/agency/reports/page.tsx", "app/client/review/page.tsx"],
  }),
  feature({
    slug: "ads-exports", name: "Ads briefs & exports", summary: "Prepare reviewable ad creative before your team decides to launch.",
    pain: "Ad copy and creative need to agree with the offer, landing page and evidence—not just fill a character limit.", audience: "Businesses and agencies preparing Google RSA and Meta creative exports.",
    inputs: ["Campaign context, verified claims and the landing destination.", "The requested creative/export scope.", "Applicable evidence and human approval."],
    outputs: ["Google RSA and Meta creative export packs where configured.", "Reviewable ad briefs and creative assets.", "Controlled finalized exports for an external ad-platform workflow."],
    process: ["Set the offer, audience, landing destination and evidence.", "Prepare the configured creative export pack.", "Review claims, destination, assets and required approvals.", "Export approved work and separately manage any external launch and budget."],
    example: { business: "Service-business marketing team", goal: "Prepare ad creative for a verified service offer.", deliverables: ["A reviewed landing/offer brief.", "RSA/Meta creative export work where configured.", "An approved export handed to the person managing the external account."] },
    boundary: "Ads Lab is export-only. Citefi does not autonomously place ads, launch campaigns or spend advertising budget. Landing/evidence checks, finalized export controls and human approval remain required.",
    related: ["campaigns", "images", "brand-intelligence"], evidence: ["app/api/campaigns/[id]/ads/route.ts", "lib/credit-menu.ts"], creditOperation: "ads_export_pack",
  }),
];

export function getProductFeature(slug: string): ProductFeature | undefined {
  return productFeatures.find(item => item.slug === slug);
}
