import { readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
const root = "/var/www/citefi/ops-recovery/backups";
try {
  const files = (await readdir(root)).filter(x => /^citefi_[0-9]{8}_[0-9]{6}\.sql\.gz$/.test(x)).sort();
  if (!files.length) throw new Error("Missing backup");
  const file = files.at(-1);
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(`${root}/${file}`)) digest.update(chunk);
  console.log(JSON.stringify({
    backupObject: `db-backups/${file}`,
    sha256: digest.digest("hex"),
    bytes: (await stat(`${root}/${file}`)).size,
  }));
} catch {
  console.error("Backup metadata unavailable.");
  process.exitCode = 1;
}
