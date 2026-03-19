import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    
    const geminiAvailable = !!process.env.GEMINI_API_KEY;
    const openaiAvailable = !!process.env.OPENAI_API_KEY;

    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      services: {
        database: "connected",
        queue: "pg-boss",
        gemini: geminiAvailable ? "configured" : "not_configured",
        openai: openaiAvailable ? "configured" : "not_configured",
      },
    });
  } catch (error) {
    console.error("Health check failed:", error);
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
