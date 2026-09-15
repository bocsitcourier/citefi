import { NextRequest, NextResponse } from "next/server";
import {
  generateSchemaMarkup,
  SchemaMarkupValidationError,
  validateSchemaMarkupData,
  type SchemaContentType,
} from "@/lib/seo-intelligence";
import { withAuthenticatedTeamContext } from "@/lib/api/auth";

export async function POST(req: NextRequest) {
  try {
    return await withAuthenticatedTeamContext(req, async ({ userId, teamId }) => {
    const body = await req.json();
    const { content_type, data } = body;

    if (!content_type || !data) {
      return NextResponse.json(
        { error: "content_type and data are required" },
        { status: 400 }
      );
    }

    if (!["Article", "HowTo", "FAQPage", "LocalBusiness"].includes(content_type)) {
      return NextResponse.json(
        { error: "Invalid content_type. Must be: Article, HowTo, FAQPage, or LocalBusiness" },
        { status: 400 }
      );
    }

    const schemaContentType = content_type as SchemaContentType;
    let validatedData: Record<string, unknown>;
    try {
      // Validate and normalize before invoking the deterministic builder. This
      // prevents empty FAQ/HowTo placeholders from being returned as success.
      validatedData = validateSchemaMarkupData(schemaContentType, data);
    } catch (error) {
      if (error instanceof SchemaMarkupValidationError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    const schema = await generateSchemaMarkup({
      content_type: schemaContentType,
      data: validatedData,
    });

    return NextResponse.json(schema);
    });
  } catch (error: any) {
    console.error("Schema markup generation error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate schema markup" },
      { status: error?.statusCode || 500 }
    );
  }
}
