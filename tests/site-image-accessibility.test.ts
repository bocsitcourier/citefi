import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import ts from "typescript";
import { marketingPhotos, marketingImageSchema, type MarketingPhotoPath } from "../lib/marketing/images";
import { labelUncaptionedArticleImages } from "../lib/article-image-accessibility";
import { BRAND } from "../lib/brand";
import { generateSEOAltText, generateImageSchema } from "../lib/image-utils";
import sitemap from "../app/sitemap";

async function run() {
  for (const [src, photo] of Object.entries(marketingPhotos)) {
    const dimensions = await sharp(`public${src}`).metadata();
    assert.equal(photo.width, dimensions.width);
    assert.equal(photo.height, dimensions.height);
    const schema = marketingImageSchema(src as MarketingPhotoPath, "/cities/boston-massachusetts");
    assert.equal(schema.contentUrl, `${BRAND.url}${src}`);
    assert.equal(schema.publisher["@id"], BRAND.organizationId);
    assert.ok(schema.description.includes("not a Citefi customer"));
    assert.equal(schema.license, "https://www.pexels.com/license/");
    assert.ok(schema.acquireLicensePage.startsWith("https://www.pexels.com/photo/"));
    assert.ok(!("contentLocation" in schema));
    assert.ok(!("creator" in schema));
    assert.ok(!("aggregateRating" in schema));
  }
  assert.throws(() => marketingImageSchema("/api/private/image" as MarketingPhotoPath, "/"), /verified public/);
  assert.throws(() => marketingImageSchema("/marketing/photos/home-services.jpg", "/settings"), /public marketing page/);
  assert.throws(() => marketingImageSchema("/marketing/photos/home-services.jpg", "/cities/boston?token=private"), /public marketing page/);
  assert.equal(generateSEOAltText("A barista preparing coffee", "Boston", ["best local cafe"]), "A barista preparing coffee");
  assert.equal(generateSEOAltText("", "Boston", ["marketing"]), "");
  assert.equal(generateSEOAltText("A".repeat(200)), "A".repeat(200));
  assert.ok(!("contentLocation" in generateImageSchema({ alt: "A barista", geoLocation: "Boston" }, "/photo.jpg")));
  const verified = generateImageSchema({ alt: "A known landmark", geoLocation: "Boston", geoLocationVerified: true }, "/photo.jpg");
  assert.deepEqual(verified.contentLocation, { "@type": "Place", name: "Boston" });
  const publicImages = sitemap().flatMap(page => page.images || []);
  for (const src of Object.keys(marketingPhotos)) assert.ok(publicImages.includes(`${BRAND.url}${src}`));
  assert.ok(publicImages.includes(BRAND.logo.url));
  assert.ok(publicImages.every(url => url === BRAND.logo.url || url.startsWith(`${BRAND.url}/marketing/photos/`)));

  // DOM-shaped fixtures test missing-alt behavior without browser sessions or private data.
  function image(attributes: Record<string, string>) {
    return {
      getAttribute: (key: string) => attributes[key] ?? null,
      setAttribute: (key: string, value: string) => { attributes[key] = value; },
      attributes,
    };
  }
  const missing = image({});
  const hidden = image({ "aria-hidden": "true" });
  const presentation = image({ role: "presentation" });
  const specified = image({ alt: "A blue bicycle beside a shop" });
  const decorative = image({ alt: "" });
  const images = [missing, hidden, presentation, specified, decorative];
  const scope = {
    getAttribute: () => "Choosing a bicycle",
    querySelectorAll: () => images.filter(img => img.getAttribute("alt") === null),
  };
  const root = { querySelectorAll: () => [scope] } as unknown as ParentNode;
  labelUncaptionedArticleImages(root);
  assert.equal(missing.attributes.alt, "Illustration for article: Choosing a bicycle");
  assert.equal(hidden.attributes.alt, "");
  assert.equal(presentation.attributes.alt, "");
  assert.equal(specified.attributes.alt, "A blue bicycle beside a shop");
  assert.equal(decorative.attributes.alt, "");
  labelUncaptionedArticleImages(root);
  assert.equal(missing.attributes.alt, "Illustration for article: Choosing a bicycle");

  // Audit JSX, distinguishing actual Next images from Lucide Image icons.
  let checked = 0;
  function audit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) { audit(filename); continue; }
      if (!filename.endsWith(".tsx")) continue;
      const tree = ts.createSourceFile(filename, readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const nextNames = new Set<string>();
      for (const statement of tree.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
          && statement.moduleSpecifier.text === "next/image" && statement.importClause?.name) {
          nextNames.add(statement.importClause.name.text);
        }
      }
      function visit(node: ts.Node) {
        if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
          const tag = node.tagName.getText(tree);
          if (tag === "img" || tag === "AvatarImage" || nextNames.has(tag)) {
            const hasAlt = node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === "alt");
            assert.ok(hasAlt, `${filename}: ${tag} has no explicit alt attribute`);
            checked++;
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(tree);
    }
  }
  audit("app");
  audit("components");
  const optimized = readFileSync("components/OptimizedImage.tsx", "utf8");
  assert.doesNotMatch(optimized, /`\$\{alt\} - \$\{geoLocation\}`/);
  assert.match(optimized, /JSON\.stringify\(schema\)\.replace/);
  console.log(`PASS: ${checked} image render sites have alt attributes; verified public schema, private URL rejection, and legacy article fallback.`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
