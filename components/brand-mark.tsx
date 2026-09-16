import Image from "next/image";
import favicon from "@/app/icon.png";

/** Use the favicon itself, rather than a separately drawn approximation. */
export function BrandMark({
  className = "h-10 w-6",
  decorative = false,
}: {
  className?: string;
  decorative?: boolean;
}) {
  return (
    <Image
      src={favicon}
      alt={decorative ? "" : "Citefi"}
      aria-hidden={decorative || undefined}
      width={24}
      height={40}
      unoptimized
      className={`shrink-0 object-contain ${className}`}
    />
  );
}