const cwd = process.env.DO_CURRENT_DIR || "/var/www/citefi-staging/current";
const port = process.env.STAGING_PORT || "5100";
const logDir = process.env.STAGING_LOG_DIR || "/var/log/citefi-staging";

module.exports = {
  apps: [
    {
      namespace: "citefi-staging",
      name: "citefi-staging-web",
      script: "scripts/process-bootstrap.ts",
      args: "--web",
      interpreter: "node",
      interpreter_args: "--import tsx/esm --env-file=.env.local",
      cwd,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production", DEPLOY_ENVIRONMENT: "staging",
        PORT: port,
        BACKUP_STATUS_FILE: "/var/www/citefi-staging/.backup/status.json",
        DEPLOYMENT_STATUS_FILE: "/var/www/citefi-staging/.deploy/release-status.json",
        BOOTSTRAP_PROCESS_NAME: "citefi-staging-web",
        PROCESS_DIAGNOSTIC_SPOOL: "/var/www/citefi-staging/.deploy/diagnostics/process-exits.jsonl",
        TELEMETRY_SPOOL_PATH: "/var/www/citefi-staging/.deploy/diagnostics/telemetry.jsonl",
      },
      max_memory_restart: "1200M",
      out_file: `${logDir}/web-out.log`,
      error_file: `${logDir}/web-error.log`,
      autorestart: true,
      min_uptime: "30s", restart_delay: 10000, max_restarts: 5,
      watch: false,
    },
    {
      namespace: "citefi-staging",
      name: "citefi-staging-worker",
      script: "scripts/process-bootstrap.ts",
      args: "--worker",
      interpreter: "node",
      interpreter_args: "--import tsx/esm --env-file=.env.local",
      cwd,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production", WORKER_PROCESS: "true", DEPLOY_ENVIRONMENT: "staging",
        BACKUP_STATUS_FILE: "/var/www/citefi-staging/.backup/status.json",
        DEPLOYMENT_STATUS_FILE: "/var/www/citefi-staging/.deploy/release-status.json",
        BOOTSTRAP_PROCESS_NAME: "citefi-staging-worker",
        PROCESS_DIAGNOSTIC_SPOOL: "/var/www/citefi-staging/.deploy/diagnostics/process-exits.jsonl",
        TELEMETRY_SPOOL_PATH: "/var/www/citefi-staging/.deploy/diagnostics/telemetry.jsonl",
      },
      max_memory_restart: "800M",
      out_file: `${logDir}/worker-out.log`,
      error_file: `${logDir}/worker-error.log`,
      autorestart: true,
      min_uptime: "30s", restart_delay: 10000, max_restarts: 5,
      watch: false,
    },
  ],
};