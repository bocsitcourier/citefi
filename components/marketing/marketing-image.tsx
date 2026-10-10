import type { ImgHTMLAttributes } from "react";
import { marketingPhotos, marketingImageSchema, type MarketingPhotoPath } from "@/lib/marketing/images";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "width" | "height"> & {
  src: MarketingPhotoPath;
  alt?: string;
  pagePath: string;
};

/** Public images: accessible descriptions, true dimensions and safely serialized source metadata. */
export function MarketingImage({ src, alt, pagePath, loading = "lazy", decoding = "async", ...props }: Props) {
  const schema = marketingImageSchema(src, pagePath);
  const photo = marketingPhotos[src];
  return <>
    <img {...props} src={src} alt={alt?.trim() || photo.description} width={photo.width} height={photo.height} loading={loading} decoding={decoding} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />
  </>;
}
