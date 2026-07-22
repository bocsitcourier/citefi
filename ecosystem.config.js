// PM2 process configuration for Digital Ocean deployment
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 save && pm2 startup

module.exports = {
  apps: [
    {
      name: "citefi",
      script: "tsx",
      args: "server/production.ts",
      cwd: "/var/www/citefi",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: "5000",
      },
      // Restart if the process uses more than 1.5 GB
      max_memory_restart: "1500M",
      // Log rotation
      out_file: "/var/log/citefi/out.log",
      error_file: "/var/log/citefi/error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      // Auto-restart on crash
      autorestart: true,
      watch: false,
      // Give the process time to shut down gracefully
      kill_timeout: 5000,
      listen_timeout: 10000,
    },
  ],
};
