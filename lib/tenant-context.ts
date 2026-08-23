import { AsyncLocalStorage } from "node:async_hooks";

export type TenantActorType = "web" | "worker";

export interface TenantExecutionContext {
  scope: "tenant";
  actorType: TenantActorType;
  userId: number | null;
  teamId: number;
  role: string;
}

export interface SystemExecutionContext {
  scope: "system";
  reason: string;
}

export interface BlockedExecutionContext {
  scope: "blocked";
  reason: string;
}

export type DatabaseExecutionContext =
  | TenantExecutionContext
  | SystemExecutionContext
  | BlockedExecutionContext;

const storage = new AsyncLocalStorage<DatabaseExecutionContext>();

export function getDatabaseExecutionContext(): DatabaseExecutionContext | undefined {
  return storage.getStore();
}

export function enterTenantContext(context: Omit<TenantExecutionContext, "scope">): void {
  if (!Number.isInteger(context.teamId) || context.teamId <= 0) {
    throw new Error("Tenant database context requires a positive teamId");
  }
  if (
    context.actorType === "web" &&
    (!Number.isInteger(context.userId) || (context.userId ?? 0) <= 0)
  ) {
    throw new Error("Web tenant database context requires a positive userId");
  }
  storage.enterWith({ scope: "tenant", ...context });
}

export function enterSystemContext(reason: string): void {
  if (!reason.trim()) {
    throw new Error("System database context requires an audit reason");
  }
  storage.enterWith({ scope: "system", reason });
}

export function enterBlockedDatabaseContext(reason: string): void {
  if (!reason.trim()) {
    throw new Error("Blocked database context requires an audit reason");
  }
  storage.enterWith({ scope: "blocked", reason });
}

export function runWithTenantContext<T>(
  context: Omit<TenantExecutionContext, "scope">,
  fn: () => T
): T {
  if (!Number.isInteger(context.teamId) || context.teamId <= 0) {
    throw new Error("Tenant database context requires a positive teamId");
  }
  return storage.run({ scope: "tenant", ...context }, fn);
}

export function runWithSystemContext<T>(reason: string, fn: () => T): T {
  if (!reason.trim()) {
    throw new Error("System database context requires an audit reason");
  }
  return storage.run({ scope: "system", reason }, fn);
}

export function runWithBlockedDatabaseContext<T>(
  reason: string,
  fn: () => T
): T {
  if (!reason.trim()) {
    throw new Error("Blocked database context requires an audit reason");
  }
  return storage.run({ scope: "blocked", reason }, fn);
}
