import Link from "next/link";
import { FileQuestion, Home, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center max-w-md mx-auto px-6">
        <div className="flex justify-center mb-6">
          <div className="rounded-full bg-muted p-4">
            <FileQuestion className="h-10 w-10 text-muted-foreground" />
          </div>
        </div>
        <h1 className="text-4xl font-bold tracking-tight mb-2">404</h1>
        <h2 className="text-xl font-semibold mb-3">Page not found</h2>
        <p className="text-muted-foreground mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="flex gap-3 justify-center">
          <Button asChild variant="outline">
            <Link href="javascript:history.back()">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Go back
            </Link>
          </Button>
          <Button asChild>
            <Link href="/home">
              <Home className="h-4 w-4 mr-2" />
              Home
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
