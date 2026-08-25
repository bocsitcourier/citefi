const cwd = process.env.DO_APP_DIR || "/var/www/citefi-staging";
const port = process.env.STAGING_PORT || "5100";
const logDir = process.env.STAGING_LOG_DIR || "/var/log/citefi-staging";

module.exports = {
  apps: [
    {
      namespace: "citefi-staging",
      name: "citefi-staging-web",
      script: "node_modules/next/dist/bin/next",
      args: `start -p ${port}`,
      cwd,
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production", DEPLOY_ENVIRONMENT: "staging" },
      max_memory_restart: "1200M",
      out_file: `${logDir}/web-out.log`,
      error_file: `${logDir}/web-error.log`,
      autorestart: true,
      watch: false,
    },
    {
      namespace: "citefi-staging",
      name: "citefi-staging-worker",
      script: "server/worker-process.ts",
      interpreter: "node",
      interpreter_args: "--import tsx/esm --env-file=.env.local",
      cwd,
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production", WORKER_PROCESS: "true", DEPLOY_ENVIRONMENT: "staging" },
      max_memory_restart: "800M",
      out_file: `${logDir}/worker-out.log`,
      error_file: `${logDir}/worker-error.log`,
      autorestart: true,
      watch: false,
    },
  ],
};