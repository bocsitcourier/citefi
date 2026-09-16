/**
 * Local-only alias resolver for the acceptance route suite.
 *
 * The production source has both lib/billing.ts and lib/billing/; Node's ESM
 * resolver refuses the extensionless alias before tsx gets a chance to prefer
 * the file. The shared scope-0 loader intentionally does not choose between
 * those two production paths, so this narrow test loader handles that one
 * existing ambiguity without changing the common QA harness.
 */
const root = new URL("../../", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@/lib/billing") {
    return nextResolve(
      new URL("tests/qa/content-acceptance-billing-fixture.mjs", root).href,
      context,
    );
  }
  if (specifier.startsWith("@/")) {
    return nextResolve(new URL(specifier.slice(2), root).href, context);
  }
  const aliasMarker = "/@/";
  const aliasIndex = specifier.indexOf(aliasMarker);
  if (aliasIndex >= 0) {
    const aliasPath = specifier.slice(aliasIndex + aliasMarker.length);
    if (aliasPath === "lib/billing") {
      return nextResolve(
        new URL("tests/qa/content-acceptance-billing-fixture.mjs", root).href,
        context,
      );
    }
    return nextResolve(new URL(aliasPath, root).href, context);
  }
  return nextResolve(specifier, context);
}
