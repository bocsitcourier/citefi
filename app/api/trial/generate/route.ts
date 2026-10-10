import { NextRequest } from "next/server";
import { generateArticleTrial, trialError } from "@/lib/trial/server";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  try { return await generateArticleTrial(req); } catch (error) { return trialError(error); }
}
