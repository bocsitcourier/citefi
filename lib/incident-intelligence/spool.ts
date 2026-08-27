import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { sanitizeTelemetryEvent, type TelemetryEvent } from "./core";

const DEFAULT_PATH = process.env.TELEMETRY_SPOOL_PATH ?? "/tmp/citefi/telemetry-spool.jsonl";
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_RECORDS = 1_000;
let operation = Promise.resolve();

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = operation.then(fn, fn);
  operation = next.then(() => undefined, () => undefined);
  return next;
}

export async function spoolEvent(event: TelemetryEvent, path = DEFAULT_PATH): Promise<void> {
  return serialized(async () => {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const line = `${JSON.stringify(sanitizeTelemetryEvent(event))}\n`;
    const current = await readFile(path, "utf8").catch(() => "");
    const lines = current.split("\n").filter(Boolean);
    lines.push(line.trim());
    while (lines.length > MAX_RECORDS || Buffer.byteLength(lines.join("\n")) > MAX_BYTES) lines.shift();
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, `${lines.join("\n")}\n`, { mode: 0o600 });
    await rename(temp, path);
  });
}

export async function replaySpool(
  persist: (event: TelemetryEvent) => Promise<unknown>,
  path = DEFAULT_PATH,
): Promise<{ replayed: number; remaining: number }> {
  return serialized(async () => {
    const contents = await readFile(path, "utf8").catch(() => "");
    if (!contents) return { replayed: 0, remaining: 0 };
    const remaining: string[] = [];
    let replayed = 0;
    for (const line of contents.split("\n").filter(Boolean)) {
      let safeEvent: TelemetryEvent | null = null;
      try {
        safeEvent = sanitizeTelemetryEvent(JSON.parse(line) as TelemetryEvent);
        await persist(safeEvent);
        replayed++;
      } catch {
        // Never rewrite a legacy/raw record back to the owner-only spool.
        if (safeEvent) remaining.push(JSON.stringify(safeEvent));
      }
    }
    if (remaining.length) await writeFile(path, `${remaining.join("\n")}\n`, { mode: 0o600 });
    else await unlink(path).catch(() => {});
    return { replayed, remaining: remaining.length };
  });
}

export async function getSpoolSize(path = DEFAULT_PATH): Promise<number> {
  return (await stat(path).catch(() => ({ size: 0 }))).size;
}