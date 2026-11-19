/** Extracts the opaque support identifier included by the trial service. */
export function supportReferenceFromMessage(message: string): string | null {
  return message.match(/\bSupport reference:\s*([a-z0-9_-]{6,100})\b/i)?.[1] ?? null;
}
