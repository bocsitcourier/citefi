import { NextRequest, NextResponse } from "next/server";
import { psychographicService } from "@/lib/psychographic-service";
import { requireTeamMember } from "@/lib/api/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { id } = await params;

    const persona = await psychographicService.getPersona(teamId, parseInt(id));

    if (!persona) {
      return NextResponse.json(
        { success: false, error: "Persona not found" },
        { status: 404 }
      );
    }

    const guidelines = await psychographicService.getContentGuidelines(teamId, parseInt(id));

    return NextResponse.json({
      success: true,
      persona,
      guidelines,
    });
  } catch (error: any) {
    console.error("Failed to get persona:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to get persona" },
      { status: error?.statusCode || 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { id } = await params;
    const body = await request.json();

    const persona = await psychographicService.updatePersona(teamId, parseInt(id), body);

    if (!persona) {
      return NextResponse.json(
        { success: false, error: "Persona not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      persona,
    });
  } catch (error: any) {
    console.error("Failed to update persona:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to update persona" },
      { status: error?.statusCode || 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { id } = await params;

    const deleted = await psychographicService.deletePersona(teamId, parseInt(id));

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Persona not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Persona deleted",
    });
  } catch (error: any) {
    console.error("Failed to delete persona:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to delete persona" },
      { status: error?.statusCode || 500 }
    );
  }
}
