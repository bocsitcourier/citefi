"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function BriefSkeleton() {
  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <Skeleton className="h-8 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-10 w-32" />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {[...Array(5)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="py-4">
              <Skeleton className="h-6 w-40" />
            </CardHeader>
            <CardContent className="pb-4">
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-4 w-[90%]" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
