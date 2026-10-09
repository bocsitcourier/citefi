// Minimal S3 adapter for the existing backup script; no package/root install.
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";

const args = process.argv.slice(2);
const endpointIndex = args.indexOf("--endpoint-url");
const endpoint = endpointIndex < 0 ? process.env.DO_SPACES_ENDPOINT : args[endpointIndex + 1];
const client = new S3Client({
  region: "us-east-1", endpoint,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? process.env.DO_SPACES_SECRET,
  },
});
function object(uri) {
  const match = /^s3:\/\/([a-z0-9.-]+)\/([a-zA-Z0-9/_-]+(?:\.sql\.gz)?)$/.exec(uri);
  if (!match) throw new Error("Invalid backup object");
  return { Bucket: match[1], Key: match[2] };
}
async function hash(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}
try {
  if (args[0] !== "s3") throw new Error("Unsupported operation");
  if (args[1] === "cp" && !args[2].startsWith("s3://")) {
    const path = args[2];
    await client.send(new PutObjectCommand({
      ...object(args[3]), Body: createReadStream(path), ContentLength: (await stat(path)).size,
      Metadata: { sha256: await hash(path) }, ContentType: "application/gzip",
    }));
  } else if (args[1] === "cp") {
    const response = await client.send(new GetObjectCommand(object(args[2])));
    if (args[3] === "-") {
      await pipeline(response.Body, process.stdout);
    } else {
      await pipeline(response.Body, createWriteStream(args[3], { mode: 0o600, flags: "wx" }));
      if (!response.Metadata?.sha256 || await hash(args[3]) !== response.Metadata.sha256) {
        throw new Error("Downloaded backup checksum mismatch");
      }
    }
  } else if (args[1] === "ls") {
    const { Bucket, Key: Prefix } = object(args[2]);
    let ContinuationToken;
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }));
      for (const item of page.Contents ?? []) {
        const name = item.Key.slice(Prefix.length);
        if (/^citefi_[0-9]{8}_[0-9]{6}\.sql\.gz$/.test(name)) {
          console.log(`${item.LastModified.toISOString().slice(0,10)} 00:00:00 ${item.Size} ${name}`);
        }
      }
      ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (ContinuationToken);
  } else throw new Error("Unsupported operation");
} catch {
  console.error("Backup storage operation failed (details withheld).");
  process.exitCode = 1;
} finally {
  client.destroy();
}
