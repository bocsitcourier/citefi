import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/auth";
import { getOpenAIStats } from "@/lib/openai-client";

export async function GET(request: NextRequest) {
  try {
    // CRITICAL: Admin-only access - let auth errors propagate with correct status codes
    await requireAdmin(request);

    const stats = getOpenAIStats();
    
    // Calculate error rate
    const errorRate = stats.totalCalls > 0 
      ? (stats.totalFailures / stats.totalCalls) * 100 
      : 0;
    
    // Calculate retry rate
    const retryRate = stats.totalCalls > 0
      ? (stats.totalRetries / stats.totalCalls) * 100
      : 0;
    
    // Calculate success rate
    const successRate = stats.totalCalls > 0
      ? ((stats.totalCalls - stats.totalFailures) / stats.totalCalls) * 100
      : 100;

    return NextResponse.json({
      openai: {
        totalCalls: stats.totalCalls,
        totalRetries: stats.totalRetries,
        totalFailures: stats.totalFailures,
        queueSize: stats.queueSize,
        activeRequests: stats.activeCount,
        errorRate: parseFloat(errorRate.toFixed(2)),
        retryRate: parseFloat(retryRate.toFixed(2)),
        successRate: parseFloat(successRate.toFixed(2)),
      },
      health: {
        status: errorRate < 2 ? "healthy" : errorRate < 10 ? "warning" : "critical",
        message: errorRate < 2 
          ? "OpenAI integration performing well"
          : errorRate < 10
          ? "Elevated error rate detected"
          : "Critical error rate - investigate immediately",
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    // CRITICAL SECURITY FIX: Re-throw auth errors with correct status codes (401/403)
    // Only catch unexpected errors that occur AFTER successful authentication
    if (error?.statusCode) {
      return NextResponse.json(
        { error: error.message || "Unauthorized" },
        { status: error.statusCode }
      );
    }
    
    // Log and return 500 only for unexpected errors
    console.error("Error fetching OpenAI stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch OpenAI stats" },
      { status: error?.statusCode || 500 }
    );
  }
}
