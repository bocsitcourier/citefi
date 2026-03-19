"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SocialRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/social/dashboard");
  }, [router]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-lg text-muted-foreground">Redirecting to dashboard...</div>
    </div>
  );
}
