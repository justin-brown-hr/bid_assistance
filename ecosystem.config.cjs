module.exports = {
  apps: [
    {
      name: "freelancer-helper",
      script: "dist/index.js",
      cwd: "/home/user/work/Freelancer_Helper_t",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "800M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
