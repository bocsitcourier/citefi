"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";
import { BREADCRUMB_LABELS } from "./nav-config";

export function AppBreadcrumbs() {
  const pathname = usePathname();

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length <= 1) return null;

  const crumbs: { label: string; href: string }[] = [];
  let path = "";

  for (const segment of segments) {
    path += `/${segment}`;
    const label =
      BREADCRUMB_LABELS[segment] ||
      (segment.match(/^\d+$/) ? `#${segment}` : decodeURIComponent(segment).replace(/-/g, " "));
    crumbs.push({ label, href: path });
  }

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground" aria-label="breadcrumb">
      <Link href="/home" className="flex items-center hover:text-foreground transition-colors shrink-0">
        <Home className="w-3.5 h-3.5" />
      </Link>
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center gap-1">
          <ChevronRight className="w-3 h-3 shrink-0" />
          {i === crumbs.length - 1 ? (
            <span className="text-foreground font-medium capitalize truncate max-w-[200px]">{crumb.label}</span>
          ) : (
            <Link href={crumb.href} className="hover:text-foreground transition-colors capitalize whitespace-nowrap">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
