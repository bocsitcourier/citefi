/** Labels missing-alt images in rendered article HTML only; never rewrites stored content. */
export function labelUncaptionedArticleImages(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("[data-article-image-context]").forEach(scope => {
    const title = scope.getAttribute("data-article-image-context")?.trim();
    scope.querySelectorAll<HTMLImageElement>("img:not([alt])").forEach(image => {
      const decorative = image.getAttribute("aria-hidden") === "true"
        || ["presentation", "none"].includes(image.getAttribute("role") || "");
      image.setAttribute("alt", decorative ? "" : title ? `Illustration for article: ${title}` : "Article illustration");
    });
  });
}
