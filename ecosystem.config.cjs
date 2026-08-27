// PM2 process configuration for Digital Ocean deployment
//
// Two independent apps — PM2 monitors each one separately so the worker
// gets its own restart policy and memory cap, independent of Next.js.
//
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 save && pm2 startup
//
// DO_CURRENT_DIR is the atomically switched immutable-release symlink.
const cwd = process.env.DO_CURRENT_DIR || "/var/www/citefi/current";

// Next.js loads .env.local automatically.
// The worker uses --env-file so env vars are injected before any imports run.

module.exports = {
  apps: [
    // ── Next.js web server ─────────────────────────────────────────
    {
      name: "citefi-web",
      script: "scripts/process-bootstrap.ts",
      args: "--web",
      interpreter: "node",
      interpreter_args: "--import tsx/esm --env-file=.env.local",
      cwd,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: "5000",
        DEPLOYMENT_STATUS_FILE: "/var/www/citefi/.deploy/release-status.json",
        BOOTSTRAP_PROCESS_NAME: "citefi-web",
        PROCESS_DIAGNOSTIC_SPOOL: "/var/www/citefi/.deploy/diagnostics/process-exits.jsonl",
        TELEMETRY_SPOOL_PATH: "/var/www/citefi/.deploy/diagnostics/telemetry.jsonl",
      },
      max_memory_restart: "1200M",
      out_file: "/var/log/citefi/web-out.log",
      error_file: "/var/log/citefi/web-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      autorestart: true,
      watch: false,
      kill_timeout: 5000,
      listen_timeout: 30000,
      min_uptime: "30s",
      restart_delay: 10000,
      max_restarts: 5,
    },

    // ── pg-boss background worker ──────────────────────────────────
    // --env-file loads .env.local before any module-level code runs,
    // ensuring DATABASE_URL is set before lib/db.ts initialises the pool.
    // Requires Node 22 (Node 20.6+ also supports --env-file).
    {
      name: "citefi-worker",
      script: "scripts/process-bootstrap.ts",
      args: "--worker",
      interpreter: "node",
      interpreter_args: "--import tsx/esm --env-file=.env.local",
      cwd,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        WORKER_PROCESS: "true",
        DEPLOYMENT_STATUS_FILE: "/var/www/citefi/.deploy/release-status.json",
        BOOTSTRAP_PROCESS_NAME: "citefi-worker",
        PROCESS_DIAGNOSTIC_SPOOL: "/var/www/citefi/.deploy/diagnostics/process-exits.jsonl",
        TELEMETRY_SPOOL_PATH: "/var/www/citefi/.deploy/diagnostics/telemetry.jsonl",
      },
      max_memory_restart: "800M",
      out_file: "/var/log/citefi/worker-out.log",
      error_file: "/var/log/citefi/worker-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      autorestart: true,
      min_uptime: "30s",
      restart_delay: 10000,
      max_restarts: 5,
      watch: false,
      kill_timeout: 10000,
    },
  ],
};
