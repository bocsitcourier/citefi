import { open, readFile } from "node:fs/promises";
import { Pool } from "pg";
import {
  inventoryPublishingReviewCopies, deletePublishingReviewCopy, publishingReviewStorageTarget,
} from "../lib/storage";
import {
  evidenceHash, planReviewRetention, executeReviewRetention, type RetentionPlan,
} from "../lib/publishing/review-retention";
import { withReviewRetentionInventory } from "../lib/publishing/review-retention-runtime";

// No scheduler, route, implicit env enablement, or automatic apply. Unknown
// arguments fail rather than accidentally turning a typo into a deletion run.
async function main() {
  const args = process.argv.slice(2);
  const mode = args.shift();
  const allowed = mode === "execute" ? ["--policy", "--plan", "--authorization", "--journal"] :
    mode === "dry-run" ? ["--policy", "--out"] : [];
  if (!allowed.length || args.length % 2 !== 0) throw new Error("Invalid retention command");
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]!, value = args[i + 1]!;
    if (!allowed.includes(name) || flags.has(name) || !value || value.startsWith("--")) throw new Error("Invalid retention arguments");
    flags.set(name, value);
  }
  if (allowed.some(name => !flags.has(name))) throw new Error("Missing retention arguments");
  const load = async (name: string) => JSON.parse(await readFile(flags.get(name)!, "utf8"));
  const policy = await load("--policy");
  const approved: RetentionPlan | undefined = mode === "execute" ? await load("--plan") : undefined;
  const authorization = mode === "execute" ? await load("--authorization") : undefined;
  const connectionString = process.env.DATABASE_POOLED_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Database configuration required");
  const pool = new Pool({
    connectionString, max: 1, connectionTimeoutMillis: 10_000,
    query_timeout: 60_000, statement_timeout: 60_000,
  });
  pool.on("error", () => { console.error("Retention database connection failed"); process.exitCode = 2; });
  // Exclusive-create: never replace evidence or silently resume an uncertain run.
  const file = await open(flags.get(mode === "execute" ? "--journal" : "--out")!, "wx", 0o600);
  try {
    await withReviewRetentionInventory(pool, mode === "execute", async ({ rows, databaseTarget }) => {
      const target = evidenceHash({ databaseTarget, storage: publishingReviewStorageTarget() });
      // A first dry run can use a zero target to discover the fingerprint.
      // It produces identity evidence only, never candidates or deletion.
      if (mode === "dry-run" && policy.target === "0".repeat(64)) {
        await file.writeFile(JSON.stringify({ version: 1, target, outcome: "target-discovery-only" }) + "\n");
        await file.sync();
        console.log("Target discovery saved. Bind the reviewed policy to this target and run dry-run again.");
        return;
      }
      const fresh = planReviewRetention(await inventoryPublishingReviewCopies(), rows, policy, target);
      if (mode === "dry-run") {
        await file.writeFile(JSON.stringify(fresh, null, 2) + "\n");
        await file.sync();
        console.log(JSON.stringify({ ...fresh.counts, planHash: evidenceHash(fresh), target }));
      } else {
        const record = async (event: { key?: string; outcome: string }) => {
          await file.write(JSON.stringify({
            at: new Date().toISOString(), target, planHash: evidenceHash(approved), policyHash: fresh.policyHash,
            authorizationRef: authorization.authorizationRef, ...event,
          }) + "\n");
          await file.sync();
        };
        await record({ outcome: "started" });
        await executeReviewRetention({
          approved: approved!, fresh, authorization, remove: deletePublishingReviewCopy, record,
        });
        await record({ outcome: "completed" });
        console.log("Retention run completed. Review the restricted journal for deleted and skipped copies.");
      }
    });
  } finally {
    await file.close();
    await pool.end();
  }
}

main().catch(() => {
  // Errors from database/storage SDKs may contain credentials or customer data.
  console.error("Retention stopped. Check policy, target, evidence, permissions and the restricted journal. No automatic retry.");
  process.exitCode = 2;
});
