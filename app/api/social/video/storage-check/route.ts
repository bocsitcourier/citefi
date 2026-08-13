import { NextResponse } from "next/server";
import { isStorageConfigured } from "@/lib/storage";

/**
 * Returns whether DO Spaces storage is fully configured.
 * Used by video generation UIs to show a configuration warning before the user
 * attempts generation (which would otherwise fail at the worker with STORAGE_NOT_CONFIGURED).
 */
export async function GET() {
  return NextResponse.json({ configured: isStorageConfigured });
}
