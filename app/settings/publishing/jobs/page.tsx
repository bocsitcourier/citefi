"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PublishingJobsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings/publishing");
  }, [router]);
  return null;
}
