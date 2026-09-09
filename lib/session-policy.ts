export const STANDARD_SESSION_SECONDS = 24 * 60 * 60;
export const REMEMBERED_SESSION_SECONDS = 90 * 24 * 60 * 60;

export function sessionLifetimeSeconds(rememberMe: unknown): number {
  return rememberMe === true
    ? REMEMBERED_SESSION_SECONDS
    : STANDARD_SESSION_SECONDS;
}

export function sessionExpiry(rememberMe: unknown, now = Date.now()): Date {
  return new Date(now + sessionLifetimeSeconds(rememberMe) * 1000);
}