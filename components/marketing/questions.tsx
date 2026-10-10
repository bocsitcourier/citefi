type Question = { question: string; answer: string };
export const productQuestions: Question[] = [
  { question: "Is Citefi only an article-writing tool?", answer: "No. Citefi supports articles and research, images/media, platform-shaped social drafts, article-derived podcasts, video workflows, SEO/GEO preparation, brand intelligence/personas, campaigns, customer journeys, learning/monitoring, supported website publishing, agency clients/reports and ads creative exports. One free article is the entry offer, not the scope of the paid workspace." },
  { question: "Can I turn an article into a podcast?", answer: "Yes. The podcast workflow uses an owned article to prepare a script and generated audio, with tone and supported-duration settings. Review the audio before using it. Credits, paid-workspace eligibility and configured providers are required; voice cloning and automatic podcast-directory distribution are not promised." },
  { question: "How do images, social posts and video work together?", answer: "Use a verified business brief and customer question to guide related visual assets, platform-shaped social drafts and video/script work. Review each format for accuracy and fit. These are separate supported workflows, not an unlimited free package or a guarantee of exact visual output." },
  { question: "How do I choose a plan for ongoing marketing?", answer: "Compare your intended cadence, monthly credits, review team size and client-workspace needs. Starter, Growth and Agency have different allowances and limits. Current catalog pricing and default operation costs are on Pricing; team/admin overrides can change operation costs. Account approval and ordinary sign-in are required before checkout." },
  { question: "Which publishing connections are actually available?", answer: "Supported website receiver publishing requires configuration and separate exact authorization. Direct Facebook, LinkedIn and TikTok publishing connections are currently disabled in the product UI. Social drafts can be used in your external posting workflow. Ads creative packs are export-only, with no autonomous ad launch or spending." },
  { question: "Can Citefi help customers move toward a booking or purchase?", answer: "Campaigns and customer journeys help plan useful content for discovery, comparison, action and follow-up. Bring your real booking, contact or buying process and review the next steps. Supported orchestration depends on configuration; Citefi is not an email CRM and does not guarantee leads, sales or attribution." },
];
export const offerQuestions: Question[] = [
  { question: "I'm already busy. What do I need to provide?",
    answer: "Start with your business name, the people you help and one question customers ask before buying. Add the details you know; mark anything uncertain for review. You can inspect the article draft before deciding what to do with it." },
  { question: "What can I see before and after signup?",
    answer: "You can create one article and read an excerpt before signup. Sign up to read that same article in full with a watermark. The normal workspace and paid checkout still require account approval and login. Copying and downloading require a paid subscription." },
  { question: "Will this guarantee search rankings, citations or inquiries?",
    answer: "No. Citefi helps organize and prepare useful content, but it does not guarantee rankings, AI citations, inquiries, sales or campaign performance." },
  { question: "Can Citefi write a real customer review for me?",
    answer: "No. Draft examples are not customer evidence. Use genuine customer feedback only with permission, and do not present generated scenarios as testimonials or results." },
];
export function MarketingQuestions({ questions = offerQuestions }: { questions?: Question[] }) {
  const combined = [...new Map([...questions, ...productQuestions].map(item => [item.question, item])).values()];
  const schema = { "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: combined.map(item => ({ "@type": "Question", name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer } })) };
  return <section className="marketing-questions">
    <div className="eyebrow">Practical answers</div><h2>Before you get started.</h2>
    <div className="faq-list">{combined.map(item => <details key={item.question}>
      <summary>{item.question}</summary><p>{item.answer}</p></details>)}</div>
    <script type="application/ld+json" dangerouslySetInnerHTML={{
      __html: JSON.stringify(schema).replace(/</g, "\\u003c"),
    }} />
  </section>;
}
export function cityQuestions(city: { name: string; state: string }): Question[] {
  return [
    { question: `I run a business serving ${city.name}. What can I start with?`,
      answer: `Choose one question people ask before they book or buy. An article can explain your actual service, process, options or preparation steps. Citefi prepares a draft; you check the facts and next step.` },
    { question: `How do I make content specific to ${city.name}?`,
      answer: `Begin with your real service area, hours, offer and business knowledge. This page does not infer neighborhoods, customer demand, local regulations or landmarks. Add place-specific facts only when you can verify them.` },
    { question: `Does this page represent a local Citefi office or customer?`,
      answer: `No. Citefi provides an online workspace. The city directory helps business owners start a locally relevant brief; it does not claim local offices, customers or reviews.` },
    ...offerQuestions.slice(1, 3),
  ];
}
