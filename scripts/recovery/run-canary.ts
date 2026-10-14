// Explicit recovery only: one real, accounted job on the normal worker.
import fs from "node:fs";
import { QueueEvents } from "bullmq";
import Redis from "ioredis";
import { CANARY_QUEUE, closeQueues, getQueue, getRedisClientConfig } from "../../lib/queue";
import { getLastCanaryResult } from "../../lib/canary-worker";

const sha=fs.readFileSync(".release-sha","utf8").trim();
if(!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid release identity");
const {url,options}=getRedisClientConfig();
const connection=new Redis(url,{...options,maxRetriesPerRequest:null});
connection.on("error",()=>{});
const events=new QueueEvents(CANARY_QUEUE,{connection});
try {
  await events.waitUntilReady();
  const job=await getQueue(CANARY_QUEUE).add(CANARY_QUEUE,{},{
    jobId:`health-recovery-${sha}`,attempts:1,removeOnComplete:false,removeOnFail:false,
  });
  await job.waitUntilFinished(events,300_000);
  const result=await getLastCanaryResult();
  if(result.status!=="pass" || !result.lastRunAt || Date.parse(result.lastRunAt)<job.timestamp) {
    throw new Error("Real recovery canary did not pass");
  }
  console.log("Real accounted recovery canary passed on the normal worker.");
} catch {
  console.error("Recovery canary failed; no health requirement was relaxed.");
  process.exitCode=1;
} finally {
  await events.close();
  await connection.quit();
  await closeQueues();
}
