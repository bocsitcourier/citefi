// Copied ONLY into the owned private Next fixture. Never imported by the app.
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
const ROOT = "/tmp/privatefixture/review-media-fixture";
function path(key: string) {
  if (!key.startsWith("private/") || key.includes("..") || key.includes("\\")) throw new Error("Invalid owned fixture key");
  return join(ROOT, key);
}
export function getStorageReadCandidates(key: string) {
  return [{
    getMetadata: async () => [{ size: (await stat(path(key))).size }],
    createReadStream: () => createReadStream(path(key)),
  }];
}
export async function saveImmutablePublishingMedia(key: string, bytes: Buffer) {
  const file = path(key);
  await mkdir(dirname(file), { recursive: true });
  try { await writeFile(file, bytes, { flag: "wx" }); }
  catch (error: any) { if (error.code !== "EEXIST") throw error; }
}
