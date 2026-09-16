// The route acceptance loader maps "@/lib/billing" here. The test module
// replaces these exports with stateful deterministic functions before importing
// any route; these fallbacks exist only to keep the fixture module well formed.
export async function reserveCredits() {
  return { ok: true, requiredCredits: 10, totalRemaining: 90 };
}
export async function releaseReservation() {
  return { ok: true };
}
export async function debitReservation() {
  return { ok: true };
}
export async function markReservationForReconciliation() {}
