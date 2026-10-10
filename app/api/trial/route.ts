import { NextRequest } from "next/server";
import { readTrial, trialError } from "@/lib/trial/server";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try { return await readTrial(req); } catch (error) { return trialError(error); }
}
