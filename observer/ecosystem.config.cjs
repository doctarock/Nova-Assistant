// PM2 process manager config — https://pm2.keymetrics.io/docs/usage/application-declaration/
//
// Usage:
//   pm2 start ecosystem.config.cjs --env production
//   pm2 stop openclaw-observer
//   pm2 logs openclaw-observer
//   pm2 save && pm2 startup   (persist across reboots)

module.exports = {
  apps: [
    {
      name: "openclaw-observer",
      script: "./server.js",
      cwd: __dirname,
      interpreter: "node",

      // Single process — observer is stateful and not horizontally scalable
      instances: 1,
      exec_mode: "fork",

      // Never watch for file changes in production
      watch: false,

      // Restart if memory exceeds 2 GB
      max_memory_restart: "2G",

      // Backoff restart strategy — avoids tight crash loops
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
      exp_backoff_restart_delay: 100,

      // Give the graceful shutdown handler 40s to drain tasks before PM2 force-kills
      kill_timeout: 40000,

      // Structured JSON logs — pipe through pino-pretty locally if needed
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./logs/pm2-err.log",
      out_file: "./logs/pm2-out.log",
      merge_logs: true,

      env_production: {
        NODE_ENV: "production",
        PORT: 3220,
        LOG_LEVEL: "info"
      },

      env_development: {
        NODE_ENV: "development",
        PORT: 3220,
        LOG_LEVEL: "debug"
      }
    }
  ]
};
