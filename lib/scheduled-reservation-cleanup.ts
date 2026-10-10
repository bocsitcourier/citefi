/** Cleanup only for proven pre-enqueue, provider-unambiguous failures.
 * Never reopen spending capacity when the associated credit release fails. */
export async function cleanupUnacceptedReservations(options: {
  releaseCredits?: () => Promise<unknown>;
  cancelCap?: () => Promise<unknown>;
}): Promise<{ uncertain: boolean; stage?: "credits" | "cap"; error?: unknown }> {
  try {
    await options.releaseCredits?.();
  } catch (error) {
    return { uncertain: true, stage: "credits", error };
  }
  try {
    await options.cancelCap?.();
  } catch (error) {
    return { uncertain: true, stage: "cap", error };
  }
  return { uncertain: false };
}
