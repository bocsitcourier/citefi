// Staging ingress/evidence wrapper around the unmocked receiver implementation.
// No customer receiver, provider mocks or production routes are used here.
import fs from 'node:fs';
import express from 'express';
import { createApp } from '../../packages/apex-receiver/src/index';

const root = '/var/www/citefi-staging/publishing-qa';
if (process.env.BASE_URL !== 'https://citefi.co:8444' ||
    process.env.APEX_ENGINE_URL !== 'https://citefi.co:8443' ||
    process.env.STORAGE_PATH !== `${root}/receiver/uploads`) {
  throw new Error('Receiver is not configured for the fixed isolated staging targets');
}
const app = express();
app.use((req, res, next) => {
  if (req.method !== 'POST' || !req.path.startsWith('/api/v1/')) return next();
  const started = Date.now();
  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    const jobId = req.body?.jobId;
    if (typeof jobId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(jobId)) return originalJson(body);
    const record = {
      jobId, intendedStatus: res.statusCode, durationMs: Date.now() - started,
      mediaUrls: body?.data?.mediaUrls || {},
    };
    fs.appendFileSync(`${root}/receiver-events.jsonl`, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    const ambiguous: string[] = JSON.parse(fs.readFileSync(`${root}/ambiguous-jobs.json`, 'utf8'));
    if (ambiguous.includes(jobId)) {
      // Lose only this synthetic job's HTTP response after the real receiver
      // has completed its downloads and publication, never repeat the POST.
      res.socket?.destroy();
      return res;
    }
    return originalJson(body);
  };
  // Real deployed receiver still performs and verifies every download. This
  // staging-only ingress delay exercises download availability after dispatch.
  setTimeout(next, 1500);
});
app.use(createApp({ enableCors: false, trustProxy: false }));
app.listen(5110, '127.0.0.1', () => console.log('Isolated real staging receiver ready'));
