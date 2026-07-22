// PM2 process configuration for Digital Ocean deployment
//
// Two independent apps — PM2 monitors each one separately so the worker
// gets its own restart policy and memory cap, independent of Next.js.
//
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 save && pm2 startup
//
// Next.js loads .env.local automatically.
// The worker uses --env-file so env vars are injected before any imports run.

module.exports = {
  apps: [
    // ── Next.js web server ─────────────────────────────────────────
    {
      name: "citefi-web",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 5000",
      cwd: "/var/www/citefi",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "1200M",
      out_file: "/var/log/citefi/web-out.log",
      error_file: "/var/log/citefi/web-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      autorestart: true,
      watch: false,
      kill_timeout: 5000,
      listen_timeout: 30000,
    },

    // ── pg-boss background worker ──────────────────────────────────
    // --env-file loads .env.local before any module-level code runs,
    // ensuring DATABASE_URL is set before lib/db.ts initialises the pool.
    // Requires Node 22 (Node 20.6+ also supports --env-file).
    {
      name: "citefi-worker",
      script: "server/worker-process.ts",
      interpreter: "node",
      interpreter_args: "--import tsx/esm --env-file=.env.local",
      cwd: "/var/www/citefi",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        WORKER_PROCESS: "true",
      },
      max_memory_restart: "800M",
      out_file: "/var/log/citefi/worker-out.log",
      error_file: "/var/log/citefi/worker-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      autorestart: true,
      watch: false,
      kill_timeout: 10000,
    },
  ],
};
