import { installSelectedMediaNetworkGuard } from "./selected-media-network.mjs";
import { RECOVERY_LIMITS } from "./video-recovery-plan.mjs";

export function installVideoRecoveryNetworkGuard(getRun, getReceipt, options = {}) {
  return installSelectedMediaNetworkGuard(getRun, getReceipt, {
    ...options,
    recoveryLimits: RECOVERY_LIMITS,
    recoveryPolicy(run, kind, body, receipt) {
      if (run?.recovery !== true || kind !== "clip" || !run.frozenPrompts ||
          receipt.teamId !== run.ownedTeamId ||
          receipt.requestMetadata?.requestKey !== `veo-idea-video:scene-${run.manifest.limits[run.phase].scenes[run.entry.calls.length]}` ||
          body.instances[0].prompt !== run.frozenPrompts[run.manifest.limits[run.phase].scenes[run.entry.calls.length]]) {
        throw new Error("Recovery frozen scene/owned receipt mismatch; no auxiliary paid calls");
      }
    },
  });
}
