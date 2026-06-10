module.exports = {
  apps: [
    {
      name: "line-bridge",
      script: "./scripts/start-bridge.sh",
      cwd: __dirname,
      autorestart: true,
    },
    {
      name: "line-tunnel",
      script: "./scripts/start-tunnel-prod.sh",
      cwd: __dirname,
      autorestart: true,
    },
    {
      name: "line-dashboard",
      script: "pnpm",
      args: "start",
      cwd: __dirname + "/dashboard",
      interpreter: "none",
      autorestart: true,
    },
  ],
};
