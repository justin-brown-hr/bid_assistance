import path from "node:path";
import { cfg, assertStartupConfig } from "./config.js";
import { WsCollector } from "./collect/wsCollector.js";
import { fastDecision } from "./fastFilter.js";
import { SeenStore } from "./store/seenStore.js";
import { TelegramClient } from "./notify/telegram.js";
import { DashboardServer } from "./dashboardServer.js";
import type { Project } from "./types.js";

function esc(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatInstant(project: Project, _reasons: string[]) {
  const lines: string[] = [];

  // Line 1: (P) Title
  const prefix = project.recruiter ? "🅿" : "";
  lines.push(`${prefix} Title: <b>${esc(project.title)}</b>`);

  // Line 2: Client Name | Flag Country | Join Date
  const clientName = project.clientName ? esc(project.clientName) : "Unknown";
  const country = project.clientCountry ? ` | ${esc(project.clientCountry)}` : "";
  const joined = project.joinDate ? ` | ${esc(project.joinDate)}` : "";
  lines.push(`👤${clientName}${country}${joined}`);

  // Line 3: Verification — only verified items as names
  const verif = project.clientVerificationText ?? "None";
  lines.push(`✅ ${esc(verif)}`);

  // Line 4: URL (plain, no label)
  lines.push(`Bid: <code>${esc(project.url)}</code>`);

  // Line 5: Skills (max 5, with label)
  const skills = project.skills.slice(0, 5).join(", ") || "Unknown";
  lines.push(`Skills: ${esc(skills)}`);

  // Line 6: Budget | Rate | Analysis
  const budget = project.budgetText ? esc(project.budgetText) : "—";
  const rate = project.completionRateText ? esc(project.completionRateText) : "—";
  const analysis = project.scoreText ? esc(project.scoreText) : "—";
  lines.push(`${budget} | Rate: ${rate} | Analysis: ${analysis}`);

  return lines.join("\n");
}


function parseSearchUrl(input: string): { jobIds: number[]; languages: string[] } {
  try {
    const url = new URL(input);
    const skillsParam = url.searchParams.get("projectSkills");
    const jobIds = skillsParam
      ? skillsParam.split(",").map(Number).filter(Boolean)
      : [];
    const langsParam = url.searchParams.get("projectLanguages");
    const languages = langsParam
      ? langsParam.split(",").map(s => s.trim()).filter(Boolean)
      : [];
    return { jobIds, languages };
  } catch {
    return { jobIds: [], languages: [] };
  }
}

export async function startMonitor() {
  assertStartupConfig();

  const store = new SeenStore(path.join("data", "seen.json"));
  await store.load();
  store.pruneOlderThan(1000 * 60 * 60 * 24 * 7);
  await store.flush();

  const dashboard = cfg.dashboard.enabled
    ? new DashboardServer({ port: cfg.dashboard.port, maxItems: cfg.dashboard.maxItems })
    : null;
  dashboard?.start();

  const tg = cfg.telegram.enabled
    ? new TelegramClient({ token: cfg.telegram.token!, chatId: cfg.telegram.chatId! })
    : null;

  // Merge all jobIds and languages from all search URLs
  const allJobIds = new Set<number>();
  const allLanguages = new Set<string>();
  for (const url of cfg.searchUrls) {
    const { jobIds, languages } = parseSearchUrl(url);
    jobIds.forEach(id => allJobIds.add(id));
    languages.forEach(l => allLanguages.add(l));
  }

  const collector = new WsCollector({
    email: cfg.freelancer.email!,
    password: cfg.freelancer.password!,
    jobIds: [...allJobIds],
    languages: [...allLanguages],
  });

  async function handleNewProject(p: Project) {
    if (store.has(p.id)) return;
    store.mark(p.id, Date.now());
    await store.flush();

    const decision = fastDecision(p, cfg.rules);
    dashboard?.record({
      foundAt: Date.now(),
      project: p,
      decision,
      notified: false,
    });

    if (!decision.ok) {
      console.log(`[monitor] Filtered (UI only): ${p.title.slice(0, 40)} — ${decision.reasons.join(", ")}`);
    }
    if (!tg) return;

    // Send immediately
    const instantText = formatInstant(p, decision.reasons);
    try {
      await tg.sendMessage(instantText);
      dashboard?.markNotified(p.id);
    } catch (e) {
      console.error("[telegram] send failed", e);
      return;
    }
  }

  collector.onNewProject((p: Project) => { void handleNewProject(p); });

  collector.onWsDisconnect((code: number) => {
    const text = `⚠️ <b>WebSocket Disconnected</b>\nCode: ${code}\nReconnecting automatically...`;
    void tg?.sendMessage(text).catch(() => {});
  });
  await collector.init();
  console.log("[monitor] Real-time WebSocket monitor running. Waiting for new projects...");

  process.on("uncaughtException", (err) => {
    console.error("[error] Uncaught Exception:", err);
    void tg?.sendMessage(`🚨 <b>Bot Error</b>\n\n<b>Context:</b> Uncaught Exception\n<b>Error:</b> ${esc(String(err instanceof Error ? err.message : err))}`).catch(() => {});
    // Don't exit — let PM2 handle restarts only for truly fatal errors
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[error] Unhandled Rejection:", reason);
    void tg?.sendMessage(`🚨 <b>Bot Error</b>\n\n<b>Context:</b> Unhandled Rejection\n<b>Error:</b> ${esc(String(reason instanceof Error ? reason.message : reason))}`).catch(() => {});
    // Don't exit
  });

  const shutdown = async () => {
    try {
      await store.flush();
      await collector.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
