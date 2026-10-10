"use client";

import { useEffect } from "react";
import { labelUncaptionedArticleImages } from "@/lib/article-image-accessibility";

/** Generated HTML arrives asynchronously; preserve supplied alt text, including intentional empty alt. */
export function ArticleImageAccessibility() {
  useEffect(() => {
    const labelImages = () => labelUncaptionedArticleImages(document);
    labelImages();
    const selector = "[data-article-image-context]";
    const observer = new MutationObserver(records => {
      // Ignore unrelated dashboard/UI changes; only article HTML needs this fallback.
      const relevant = records.some(record =>
        (record.target instanceof Element && !!record.target.closest(selector))
        || Array.from(record.addedNodes).some(node =>
          node instanceof Element && (node.matches(selector) || !!node.querySelector(selector))
        )
      );
      if (relevant) labelImages();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["alt", "data-article-image-context"],
    });
    return () => observer.disconnect();
  }, []);
  return null;
}
