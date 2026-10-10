import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import cityData from "@/lib/marketing/cities.json";
import { articleBriefHref, businessSolutions } from "@/lib/marketing/solutions";
import { marketingMetadata } from "@/lib/marketing/metadata";
import { Breadcrumbs, MarketingFrame } from "@/components/marketing/site";
import { MarketingQuestions, cityQuestions } from "@/components/marketing/questions";
import { CustomerJourney } from "@/components/marketing/customer-journey";
import { MarketingImage } from "@/components/marketing/marketing-image";
import { ArrowRight, ArrowUpRight, MapPin } from "lucide-react";

type City = (typeof cityData.cities)[number];
const cities = [...new Map(cityData.cities.map((city) => [city.slug, city])).values()];

export function generateStaticParams() { return cities.map((city) => ({ slug: city.slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const city = cities.find((item) => item.slug === slug);
  if (!city) return { title: "City not found" };
  return marketingMetadata(`Marketing content for businesses in ${city.name}, ${city.state}`, `Plan articles, images, social content, podcasts and video for customers in ${city.name}, ${city.state}. Explore business use cases, review, buyer journeys and paid plans.`, `/cities/${city.slug}`);
}

export default async function CityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const city = cities.find((item) => item.slug === slug) as City | undefined;
  if (!city) notFound();
  return <MarketingFrame comprehensive={{ city: `${city.name}, ${city.state}` }}><main className="longform city-page">
    <Breadcrumbs items={[{ label: "Cities", href: "/cities" }, { label: `${city.name}, ${city.state}` }]} />
    <section className="city-detail-hero">
      <div><div className="eyebrow"><MapPin size={14} /> CONTENT FOR YOUR LOCAL BUSINESS</div><h1>Help {city.name}<br />customers <em>choose you.</em></h1><p className="city-state-label">{city.state}</p><p className="city-intro">You are busy doing the work. Your marketing still needs to explain why someone should call, book or buy from you. Turn the questions your customers ask into useful articles—starting with one free draft for your own business.</p><Link href={articleBriefHref({ city: `${city.name}, ${city.state}` })} className="button-primary">Create my free article <ArrowRight size={16} /></Link></div>
      <figure className="solution-image"><MarketingImage src={businessSolutions[0]!.image} alt={businessSolutions[0]!.imageAlt} pagePath={`/cities/${city.slug}`} fetchPriority="high" loading="eager" /><figcaption>Representative business photography · not a {city.name} business or Citefi customer</figcaption></figure>
    </section>
    <section className="city-detail-explainer"><div><div className="eyebrow">From “what do you do?” to “how do I book?”</div><h2>Show the expertise<br /><em>you use every day.</em></h2></div><div><p>People comparing businesses in {city.name} need more than a service list. What happens at the first visit? What should they prepare? How do they request an estimate? Those are useful starting points for your content.</p><p>Bring your real services, coverage and process. Citefi prepares the draft; you add your expertise and check it before use. The online workspace is available wherever you do your planning—no local office visit needed.</p></div></section>
    <section className="city-usecases"><div className="city-usecases-heading"><div className="eyebrow">Choose a customer question</div><h2>What does your customer<br />need to know first?</h2><p>These are illustrative article briefs for different types of local business. Select one to carry the city, topic and audience into the free article form.</p></div>
      <div className="city-usecase-list">{businessSolutions.map((solution, i) => <article key={solution.slug} className="city-usecase"><span className="usecase-no">0{i + 1}</span><div><small>{solution.name}</small><h3>{solution.topic}</h3><p>{solution.pain}</p></div><Link aria-label={`Start ${solution.name} article for ${city.name}`} href={articleBriefHref({ city: `${city.name}, ${city.state}`, topic: solution.topic, audience: solution.audience })}><ArrowUpRight size={18} /></Link></article>)}</div>
    </section>
    <CustomerJourney city={`${city.name}, ${city.state}`} />
    <section className="city-prompt-block"><div><div className="eyebrow">Put it to work for your business</div><h2>Your first article.<br />Your customer’s next question.</h2><p>Start with something customers in {city.name} ask before they choose you. Preview your draft first, create an account to read it in full with a watermark, and choose paid access when you want to copy or download it.</p><Link className="text-link" href={articleBriefHref({ city: `${city.name}, ${city.state}` })}>Start with my business <ArrowRight size={15} /></Link></div><aside><span>YOUR FIRST BRIEF</span><b><i>01</i> The people you serve</b><b><i>02</i> The question they ask</b><b><i>03</i> The next step you offer</b></aside></section>
    <section className="city-related"><Link href="/cities">Browse another city <ArrowRight size={15} /></Link><Link href="/solutions">Explore business use cases <ArrowRight size={15} /></Link></section>
    <MarketingQuestions questions={cityQuestions(city)} />
  </main></MarketingFrame>;
}
