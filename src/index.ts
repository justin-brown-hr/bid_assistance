import { config as loadEnv } from "dotenv";

loadEnv();

// ESM import order matters: load .env before importing modules that read process.env.
const { startMonitor } = await import("./monitor.js");
await startMonitor();

