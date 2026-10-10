import type { MarketingPhotoPath } from "@/lib/marketing/images";

/** Editorial examples, not customer testimonials or evidence of performance. */
export type JourneyStep = {
  stage: string;
  question: string;
  content: string;
  nextStep: string;
};
export type BusinessSolution = {
  slug: string;
  name: string;
  audience: string;
  pain: string;
  promise: string;
  topic: string;
  image: MarketingPhotoPath;
  imageAlt: string;
  journey: JourneyStep[];
};

export const businessSolutions: BusinessSolution[] = [
  {
    slug: "home-services", name: "Home services",
    audience: "Homeowners comparing repair, maintenance and installation services",
    pain: "You cannot answer the phone, finish the job and write next week's marketing at the same time. Meanwhile, customers need to know whether you handle their problem before they call.",
    promise: "Turn the questions you hear on the job into clear answers that help homeowners decide what to do next.",
    topic: "What should homeowners ask before booking a plumbing repair?",
    image: "/marketing/photos/home-services.jpg",
    imageAlt: "A tradesperson installing pipework; representative stock photography, not a Citefi customer.",
    journey: [
      { stage: "Recognize the problem", question: "Can this wait, or do I need professional help?", content: "A practical warning-sign article that explains when to seek help, without diagnosing from a screen.", nextStep: "Read the service overview." },
      { stage: "Compare providers", question: "What does the visit include, and how will you price it?", content: "A service FAQ explaining your actual coverage, estimate process and what customers should prepare.", nextStep: "Check whether you cover their address." },
      { stage: "Make contact", question: "How do I request a visit?", content: "A booking-focused page with your real hours, contact method and availability policy.", nextStep: "Request an estimate or appointment." },
      { stage: "Stay connected", question: "How do I prevent the same problem?", content: "A maintenance checklist you can share after the job, with consent for any follow-up.", nextStep: "Save the checklist or arrange maintenance." },
    ],
  },
  {
    slug: "professional-services", name: "Professional services",
    audience: "Small business owners comparing accountants, consultants and professional advisers",
    pain: "Your expertise is valuable, but a prospect cannot see it from a list of services. Repeating the same explanation in every introductory call takes time you need for clients.",
    promise: "Make your expertise easier to understand before the first consultation.",
    topic: "What should a small business prepare before meeting an accountant?",
    image: "/marketing/photos/professional.jpg",
    imageAlt: "A professional working at a laptop; representative stock photography, not a Citefi customer.",
    journey: [
      { stage: "Understand the need", question: "Do I need an adviser, or can I do this myself?", content: "An educational article explaining the decision and where individual professional advice is needed.", nextStep: "Review the services you actually offer." },
      { stage: "Evaluate fit", question: "Do you work with a business like mine?", content: "A specialism page supported by your real qualifications, experience and permissioned examples.", nextStep: "Read how your engagement works." },
      { stage: "Book a conversation", question: "What should I bring, and what happens first?", content: "A consultation-preparation FAQ with your scope, contact details and genuine fee policy.", nextStep: "Request an introductory conversation." },
      { stage: "Build the relationship", question: "What do I need to do before our next meeting?", content: "A clear preparation checklist with no personalized legal, tax or financial advice invented by AI.", nextStep: "Prepare the requested documents." },
    ],
  },
  {
    slug: "restaurants-and-cafes", name: "Restaurants & cafés",
    audience: "Local diners deciding where to eat, meet or order",
    pain: "The service rush comes first. But people still need a reason to choose your place—and accurate answers about the menu, opening hours and how to visit.",
    promise: "Give people a clearer picture of the experience before they walk through the door.",
    topic: "How to plan a group visit to a neighborhood cafe",
    image: "/marketing/photos/hospitality.jpg",
    imageAlt: "A barista preparing coffee in a café; representative stock photography, not a Citefi customer.",
    journey: [
      { stage: "Discover a reason to visit", question: "Where can we meet for coffee or a meal?", content: "A useful occasion-led article using your real atmosphere, menu and location details.", nextStep: "View the current menu." },
      { stage: "Plan the visit", question: "Will this work for our group or dietary needs?", content: "A visit-planning FAQ with verified accessibility, group-size and dietary policies—not assumed claims.", nextStep: "Confirm the details with your team." },
      { stage: "Choose the next step", question: "Should we book, walk in or order ahead?", content: "A clear service page linking to the business's actual booking or ordering channel.", nextStep: "Book, order or get directions." },
      { stage: "Return for another occasion", question: "What is coming up next?", content: "An owner-reviewed update about real events, seasonal items or opening-hour changes.", nextStep: "Follow the business or opt into updates." },
    ],
  },
  {
    slug: "retail-and-local-shops", name: "Retail & local shops",
    audience: "Shoppers comparing local products, gifts and pickup options",
    pain: "Customers cannot buy the product they do not know you carry. Keeping useful product information current is hard when you are managing stock, staff and the shop floor.",
    promise: "Help shoppers understand what to choose and how to buy from your shop.",
    topic: "What to consider when choosing flowers for a special occasion",
    image: "/marketing/photos/retail.jpg",
    imageAlt: "A florist handing a bouquet to a shopper; representative stock photography, not Citefi customers.",
    journey: [
      { stage: "Find an idea", question: "What would make a thoughtful choice?", content: "A buying guide based on products you actually offer, not invented inventory.", nextStep: "Explore the relevant collection." },
      { stage: "Compare options", question: "Which size, style or option is right?", content: "An explanation of the differences, with verified prices and availability checked by the owner.", nextStep: "Ask about the right option." },
      { stage: "Complete the purchase", question: "Can I collect it or have it delivered?", content: "A practical FAQ with your real collection, delivery and returns policies.", nextStep: "Use your store's actual checkout or contact channel." },
      { stage: "Get more from the purchase", question: "How do I care for or use this?", content: "A helpful care guide relevant to the purchased product.", nextStep: "Keep the guide or contact the shop for help." },
    ],
  },
  {
    slug: "real-estate", name: "Real estate",
    audience: "Buyers and sellers preparing to speak with a local real estate professional",
    pain: "Buyers and sellers arrive with questions long before they are ready to book a call. Generic neighborhood copy does not demonstrate your knowledge or explain how you help.",
    promise: "Answer preparation and process questions with content grounded in your own expertise.",
    topic: "What questions should a seller ask before choosing a real estate agent?",
    image: "/marketing/photos/professional.jpg",
    imageAlt: "A professional preparing information at a laptop; representative stock photography.",
    journey: [
      { stage: "Prepare for a decision", question: "What should I do before listing or buying?", content: "A preparation article with practical steps, not invented prices, neighborhood safety claims or market forecasts.", nextStep: "Read the process overview." },
      { stage: "Compare expertise", question: "How would you help with my situation?", content: "A service page using your verified credentials, actual coverage and permissioned experience.", nextStep: "Review the questions to ask an agent." },
      { stage: "Start a conversation", question: "What will the first meeting cover?", content: "A consultation FAQ explaining the real process and contact route.", nextStep: "Request a conversation with the licensed professional." },
      { stage: "Stay prepared", question: "What comes next in the process?", content: "A reviewable checklist with professional and fair-housing compliance review where applicable.", nextStep: "Confirm the next step with the agent." },
    ],
  },
  {
    slug: "agencies", name: "Agencies & marketing teams",
    audience: "Agency teams preparing content for separate small business clients",
    pain: "Every client has different services, claims and feedback. Switching between briefs and chasing approvals makes even a good content plan difficult to deliver consistently.",
    promise: "Keep client context, drafts and review decisions together without mixing client workspaces.",
    topic: "How to choose an article topic that answers a client's most common sales question",
    image: "/marketing/photos/professional.jpg",
    imageAlt: "A professional preparing client work; representative stock photography, not a Citefi team member.",
    journey: [
      { stage: "Understand the client", question: "Who are we trying to reach, and what do they need?", content: "An approved business brief with actual services, audience and campaign objectives.", nextStep: "Choose one customer question to answer." },
      { stage: "Prepare the work", question: "What should the client review?", content: "A draft tied to that brief, with facts and brand language ready for inspection.", nextStep: "Send it through the existing review workflow." },
      { stage: "Get a decision", question: "What is approved, and what needs changing?", content: "A reviewable handoff that keeps client ownership and feedback clear.", nextStep: "Confirm approval before external use." },
      { stage: "Improve the next brief", question: "What did we learn from the work?", content: "Review observed results and client feedback rather than promising future performance.", nextStep: "Use the findings to choose the next topic." },
    ],
  },
];

export function articleBriefHref(input: { city?: string; topic?: string; audience?: string }) {
  const params = new URLSearchParams();
  for (const key of ["city", "topic", "audience"] as const) {
    const value = input[key];
    if (value) params.set(key, value.slice(0, key === "topic" ? 180 : key === "audience" ? 160 : 100));
  }
  return `/free-article${params.size ? `?${params}` : ""}`;
}

/** Navigation context only; never submit or generate on arrival. */
export function articleBriefPrefill(search: string) {
  const params = new URLSearchParams(search);
  return Object.fromEntries((["city", "topic", "audience"] as const).flatMap(key => {
    const value = params.get(key)?.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    return value ? [[key, value.slice(0, key === "topic" ? 180 : key === "audience" ? 160 : 100)]] : [];
  })) as Partial<{ city: string; topic: string; audience: string }>;
}
