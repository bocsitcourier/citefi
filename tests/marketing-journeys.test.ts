import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { businessSolutions, articleBriefHref, articleBriefPrefill } from "../lib/marketing/solutions";
import { marketingMetadata } from "../lib/marketing/metadata";
import sitemap from "../app/sitemap";

assert.equal(businessSolutions.length, 6);
assert.equal(new Set(businessSolutions.map(item => item.slug)).size, 6);
for (const solution of businessSolutions) {
  assert.equal(solution.journey.length, 4);
  assert.ok(existsSync(`public${solution.image}`), `${solution.slug} needs real imagery`);
  assert.ok(solution.pain.length > 80);
  const href = articleBriefHref({ city: "Boston, Massachusetts", topic: solution.topic, audience: solution.audience });
  const context = articleBriefPrefill(new URL(href, "https://citefi.co").search);
  assert.deepEqual(context, { city: "Boston, Massachusetts", topic: solution.topic, audience: solution.audience });
  assert.ok(solution.topic.length >= 8 && solution.topic.length <= 180);
  assert.ok(solution.audience.length >= 2 && solution.audience.length <= 160);
}
assert.deepEqual(articleBriefPrefill("?city=Boston&businessName=Not%20allowed&access=paid"), { city: "Boston" });
assert.deepEqual(articleBriefPrefill("?city=%0ABoston%0D%0A&topic="), { city: "Boston" });
assert.equal(articleBriefPrefill(`?city=${"x".repeat(400)}`).city?.length, 100);
assert.equal(articleBriefHref({}), "/free-article");
assert.ok(!articleBriefHref({ city: "Boston", access: "paid" } as { city: string }).includes("access"));

const citySource = readFileSync("app/cities/[slug]/page.tsx", "utf8");
assert.doesNotMatch(citySource, /Estimated population|Census vintage|Open Census source|population-card/);
assert.match(citySource, /CustomerJourney/);
assert.match(citySource, /Representative business photography/);
assert.match(citySource, /businessSolutions\.map/);
assert.match(readFileSync("app/solutions/[slug]/page.tsx", "utf8"), /separately authorized publishing workflows/);
assert.match(readFileSync("app/globals.css", "utf8"), /overflow-x: clip;\s+overflow-y: visible;/);
for (const source of ["app/signup/page.tsx", "app/login/page.tsx"]) {
  assert.doesNotMatch(readFileSync(source, "utf8"), /50\+ Articles in Minutes|50\+ articles in minutes|Zero guesswork/);
}
const metadata = marketingMetadata("Boston business content", "A customer-first brief.", "/cities/boston-massachusetts");
assert.equal(metadata.alternates?.canonical, "https://citefi.co/cities/boston-massachusetts");
assert.equal((metadata.openGraph as { url?: string })?.url, metadata.alternates?.canonical);
const urls = sitemap().map(item => item.url);
assert.equal(new Set(urls).size, urls.length);
assert.equal(urls.filter(url => url.includes("/cities/")).length, 272);
assert.equal(urls.filter(url => url.includes("/solutions/")).length, 6);
assert.ok(!urls.includes("https://citefi.co/signup"));
assert.match(readFileSync("components/navigation/nav-config.ts", "utf8"), /"\/solutions"/);
console.log("PASS: six industry journeys, safe editable prefill, real image assets, city content, metadata and sitemap.");
