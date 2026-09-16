const projectRoot = new URL("../", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return nextResolve(new URL(specifier.slice(2), projectRoot).href, context);
  }
  const aliasMarker = "/@/";
  const aliasIndex = specifier.indexOf(aliasMarker);
  if (aliasIndex >= 0) {
    return nextResolve(
      new URL(specifier.slice(aliasIndex + aliasMarker.length), projectRoot).href,
      context,
    );
  }
  return nextResolve(specifier, context);
}