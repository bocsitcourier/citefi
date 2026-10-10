import { NextRequest } from "next/server";
import { paidTrialExport, trialError } from "@/lib/trial/server";
export async function POST(req: NextRequest) {
  try { return await paidTrialExport(req); } catch (error) { return trialError(error); }
}
