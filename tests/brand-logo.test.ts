import assert from "node:assert/strict";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { BRAND, brandStructuredData } from "../lib/brand";
import { marketingMetadata } from "../lib/marketing/metadata";

async function run() {
  const logo = await sharp(`public${BRAND.logo.path}`).metadata();
  assert.equal(logo.width, BRAND.logo.width);
  assert.equal(logo.height, BRAND.logo.height);
  assert.equal(logo.hasAlpha, true);
  for (const path of ["app/icon.png", "public/icon.png"]) {
    const icon = await sharp(path).metadata();
    assert.equal(icon.width, 512);
    assert.equal(icon.height, 512);
  }
  const apple = await sharp("app/apple-icon.png").metadata();
  assert.equal(apple.width, 180);
  assert.equal(apple.height, 180);
  const social = await sharp("public/brand/citefi-social.png").metadata();
  assert.equal(social.width, BRAND.socialImage.width);
  assert.equal(social.height, BRAND.socialImage.height);
  const graph = JSON.parse(JSON.stringify(brandStructuredData))["@graph"];
  const org = graph.find((entry: { "@type": string }) => entry["@type"] === "Organization");
  assert.equal(org.logo.url, BRAND.logo.url);
  assert.equal(org.logo.caption, "Citefi logo");
  assert.equal(org.logo.width, logo.width);
  assert.equal(org.logo.height, logo.height);
  const website = graph.find((entry: { "@type": string }) => entry["@type"] === "WebSite");
  assert.equal(website.publisher["@id"], org["@id"]);
  assert.ok(!("aggregateRating" in org));
  assert.ok(!("address" in org));
  const metadata = marketingMetadata("Boston", "Business content.", "/cities/boston-massachusetts");
  assert.equal(metadata.alternates?.canonical, `${BRAND.url}/cities/boston-massachusetts`);
  const firstImage = (metadata.openGraph as { images: Array<{ url: string }> }).images[0];
  assert.ok(firstImage);
  assert.equal(firstImage.url, BRAND.socialImage.url);
  assert.ok(metadata.twitter && "card" in metadata.twitter);
  assert.equal(metadata.twitter.card, "summary_large_image");
  assert.match(readFileSync("app/layout.tsx", "utf8"), /brandStructuredData/);
  console.log("PASS: supplied logo dimensions, icons, social image, truthful entity/logo schema and page sharing metadata.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
