import Image from "next/image";

/** The compact first-letter mark from Citefi's supplied brand artwork. */
export function BrandMark({
  className = "h-10 w-6",
  decorative = false,
}: {
  className?: string;
  decorative?: boolean;
}) {
  return (
    <Image
      src="/brand/citefi-mark.png"
      alt={decorative ? "" : "Citefi letter mark"}
      aria-hidden={decorative || undefined}
      width={81}
      height={191}
      unoptimized
      className={`shrink-0 object-contain ${className}`}
    />
  );
}

/** The owner-supplied complete Citefi wordmark. */
export function BrandLogo({
  className = "h-8 w-auto",
  decorative = false,
}: {
  className?: string;
  decorative?: boolean;
}) {
  return (
    <Image
      src="/brand/citefi-logo.png"
      alt={decorative ? "" : "Citefi logo, black wordmark with orange dot"}
      aria-hidden={decorative || undefined}
      width={333}
      height={191}
      unoptimized
      className={`block max-w-full shrink-0 object-contain ${className}`}
    />
  );
}