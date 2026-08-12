/**
 * lib/run-context.ts — implicit run attribution for cost telemetry.
 *
 * Workers call enterRunContext(runId) at the top of their processor; every
 * telemetry call made anywhere in that async execution automatically carries
 * the runId (cost_telemetry.jobId) without threading it through dozens of
 * function signatures. This is what makes getRunSpend()/assertRunBudget()
 * actually see per-run spend.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const als = new AsyncLocalStorage<{ runId: string }>();

/** Set the run ID for the remainder of the current async execution. */
export function enterRunContext(runId: string): void {
  als.enterWith({ runId });
}

/** The run ID for the current async execution, if inside a worker run. */
export function currentRunId(): string | undefined {
  return als.getStore()?.runId;
}
