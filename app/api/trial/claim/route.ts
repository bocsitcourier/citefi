import { NextRequest } from "next/server";
import { claimExistingTrial, trialError } from "@/lib/trial/server";
export async function POST(req: NextRequest) {
  try { return await claimExistingTrial(req); } catch (error) { return trialError(error); }
}
