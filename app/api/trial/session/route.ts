import { NextRequest } from "next/server";
import { createTrialSession, trialError } from "@/lib/trial/server";
export async function POST(req: NextRequest) {
  try { return await createTrialSession(req); } catch (error) { return trialError(error); }
}
