/**
 * Operator-only recovery. Uses existing receipts, never a provider API.
 * Verify the database target before running; pass the owning team explicitly.
 */
import { reconcileProviderAttempt } from "../lib/provider-attempt-receipts";
import { runWithTenantContext } from "../lib/tenant-context";
import { closeDb } from "../lib/db";

async function main() {
  const [teamArgument, sourceEventId, ...extra] = process.argv.slice(2);
  const teamId = Number(teamArgument);
  if (!Number.isSafeInteger(teamId) || teamId <= 0 ||
      !sourceEventId?.startsWith("provider-attempt:") || extra.length) {
    throw new Error("Usage: reconcile-provider-attempt.ts TEAM_ID provider-attempt:ID");
  }
  const result = await runWithTenantContext(
    { actorType: "worker", userId: null, teamId, role: "admin" },
    () => reconcileProviderAttempt({ sourceEventId }),
  );
  console.log(JSON.stringify({
    sourceEventId: result.receipt.sourceEventId,
    status: result.receipt.status,
    teamId: result.receipt.teamId,
  }));
}

main().catch(() => {
  // Raw database/provider errors may contain connection or request details.
  console.error("Receipt reconciliation failed. Evidence is retained; do not resubmit the provider request.");
  process.exitCode = 1;
}).finally(closeDb);