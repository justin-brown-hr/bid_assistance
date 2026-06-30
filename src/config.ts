import path from "node:path";
import { statSync } from "node:fs";
import { config as loadEnv } from "dotenv";

// Ensure .env is loaded even if this module is imported before the entrypoint runs.
const envPath = path.resolve(process.cwd(), ".env");
try {
  const st = statSync(envPath);
  if (st.size === 0) {
    console.error(
      `[env] ${envPath} exists but is empty (0 bytes). Save your .env file content to disk and restart.`,
    );
  }
} catch {
  // ignore
}
const envRes = loadEnv({ path: envPath, override: true });
if (envRes.error) {
  console.error(`[env] failed to load ${envPath}: ${envRes.error.message}`);
}

function getEnvOptional(name: string): string | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

function parseCsv(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse a list of URLs separated by | (pipe).
 * We use pipe instead of comma because search URLs contain commas in query params.
 */
function parseUrls(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const cfg = {
  telegram: {
    enabled: (getEnvOptional("TELEGRAM_ENABLED") ?? "true").toLowerCase() !== "false",
    token: getEnvOptional("TELEGRAM_BOT_TOKEN"),
    chatId: getEnvOptional("TELEGRAM_CHAT_ID"),
  },
  freelancer: {
    oauthToken: getEnvOptional("FREELANCER_OAUTH_TOKEN"),
    email: getEnvOptional("FREELANCER_EMAIL"),
    password: getEnvOptional("FREELANCER_PASSWORD"),
  },
  searchUrls: parseUrls(getEnvOptional("FREELANCER_SEARCH_URLS")),
  rules: {
    requiredSkills: parseCsv(getEnvOptional("REQUIRED_SKILLS")).map((s) =>
      s.toLowerCase(),
    ),
    minBudgetUsd: Number(getEnvOptional("MIN_BUDGET_USD") ?? "0"),
    scamKeywords: parseCsv(getEnvOptional("SCAM_KEYWORDS")).map((s) =>
      s.toLowerCase(),
    ),
  },
  pollIntervalMs: Number(getEnvOptional("POLL_INTERVAL_MS") ?? "5000"),
  dashboard: {
    enabled: (getEnvOptional("DASHBOARD_ENABLED") ?? "true").toLowerCase() !== "false",
    port: Number(getEnvOptional("DASHBOARD_PORT") ?? "3030"),
    bindInfo: getEnvOptional("DASHBOARD_BIND_INFO"),
    maxItems: Number(getEnvOptional("DASHBOARD_MAX_ITEMS") ?? "50"),
    sqlitePath: getEnvOptional("DASHBOARD_SQLITE_PATH") ?? path.join("data", "dashboard.sqlite"),
    authSecret: getEnvOptional("DASHBOARD_AUTH_SECRET") ?? "dev-secret-change-me",
  },
  ai: {
    openrouterBaseUrl: getEnvOptional("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1",
    openrouterModel: getEnvOptional("OPENROUTER_MODEL") ?? "openai/gpt-4.1-mini",
    openaiApiKey: getEnvOptional("OPENAI_API_KEY"),
    model: getEnvOptional("OPENAI_MODEL") ?? "gpt-4.1-mini",
  },
  slack: {
    enabled: (getEnvOptional("SLACK_ENABLED") ?? "true").toLowerCase() !== "false",
    clientId: getEnvOptional("SLACK_CLIENT_ID"),
    clientSecret: getEnvOptional("SLACK_CLIENT_SECRET"),
    channelId: getEnvOptional("SLACK_CHANNEL_ID"),
    botToken: getEnvOptional("SLACK_BOT_TOKEN"),
    webhookUrl: getEnvOptional("SLACK_WEBHOOK_URL"),
  },
};

export function assertStartupConfig() {
  if (cfg.searchUrls.length === 0) {
    throw new Error(
      "FREELANCER_SEARCH_URLS must be set (comma-separated URLs).",
    );
  }
  if (cfg.telegram.enabled && (!cfg.telegram.token || !cfg.telegram.chatId)) {
    throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set.");
  }
  if (!cfg.freelancer.email || !cfg.freelancer.password) {
    throw new Error("FREELANCER_EMAIL and FREELANCER_PASSWORD must be set.");
  }
}

