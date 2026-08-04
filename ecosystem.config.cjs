module.exports = {
  apps: [
    {
      name: "freelancer-helper",
      script: "dist/index.js",
      cwd: "/home/user/work/bid_assistance",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "800M",
      env: {
        NODE_ENV: "production",
        LOGIN_HEADLESS: "true",
      },
    },
  ],
};
