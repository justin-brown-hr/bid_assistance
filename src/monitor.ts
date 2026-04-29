import path from "node:path";
import { cfg, assertStartupConfig } from "./config.js";
import { WsCollector } from "./collect/wsCollector.js";
import { fastDecision } from "./fastFilter.js";
import { SeenStore } from "./store/seenStore.js";
import { TelegramClient } from "./notify/telegram.js";
import { enrichProject } from "./ai/enrich.js";
import { DashboardStore } from "./dashboard.js";
import type { Project } from "./types.js";

function esc(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function parseVerification(raw: string | undefined): string {
  return raw ?? "—";
}

function formatInstant(project: Project, reasons: string[]) {
  const lines: string[] = [];
  lines.push(`🆕 <b>${esc(project.title)}</b>`);
  lines.push("");

  const clientName = project.clientName ? esc(project.clientName) : "Unknown";
  const clientCountry = project.clientCountry ? ` ${esc(project.clientCountry)}` : "";
  lines.push(`👤 <b>${clientName}</b>${clientCountry}`);
  lines.push(`<b>Verification</b>: ${parseVerification(project.clientVerificationText)}`);
  lines.push(`<b>Completion(%)</b>: ${esc(project.completionRateText ?? "✅ 0 / ❌ 0 (∞)")}`);

  lines.push("");
  if (project.budgetText) lines.push(`💰 <b>Budget</b>: ${esc(project.budgetText)}`);
  lines.push("");
  lines.push(`🔗 <b>Bid now</b>: <code>${esc(project.url)}</code>`);
  lines.push(`<b>Analysis</b>: ${project.scoreText ?? "checking..."}`);
  return lines.join("\n");
}

function formatWithAI(base: string, ai: Awaited<ReturnType<typeof enrichProject>>) {
  const lines = base.split("\n");
  const idx = lines.findIndex((l) => l.startsWith(`🤖 <b>AI checker</b>:`));
  // Preserve the score emoji from the existing line
  const existingLine = idx >= 0 ? lines[idx] : "";
  const scoreEmoji = existingLine.includes("😃") ? "😃" : existingLine.includes("😑") ? "😑" : "";
  const scorePart = scoreEmoji ? existingLine.replace("🤖 <b>AI checker</b>:", "").trim() : "";
  const aiLines = [
    `🤖 <b>AI checker</b>: ${scorePart}`,
    `  📝 <b>Summary</b>: ${esc(ai.summary)}`,
    `  🎯 <b>Match</b>: ${ai.matchScore}/100`,
    `  ⚠️ <b>Risk</b>: ${esc(ai.scamRisk)}`,
    `  💡 <b>Bid angle</b>: ${esc(ai.bidAngle)}`,
    `  💵 <b>Suggested price</b>: ${esc(ai.suggestedPrice)}`,
  ];
  if (idx >= 0) {
    lines.splice(idx, 1, ...aiLines);
  } else {
    lines.push("", ...aiLines);
  }
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

  const dashboard = new DashboardStore(path.join("data", "dashboard.json"));
  const tg = new TelegramClient({
    token: cfg.telegram.token!,
    chatId: cfg.telegram.chatId!,
  });

  // Track sent message IDs — auto-delete oldest when count exceeds MAX_MESSAGES
  const MAX_MESSAGES = 100;
  const sentMessageIds: number[] = [];

  // Daily counters
  let dailyTotal = 0;
  let dailyCool = 0;

  // Schedule daily report at 13:00 local time
  function scheduleDailyReport() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(13, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1); // already past 1pm today
    const msUntil = next.getTime() - now.getTime();
    console.log(`[monitor] Daily report scheduled in ${Math.round(msUntil / 60000)} minutes.`);
    setTimeout(async () => {
      const report = [
        `🌗 <b>Daily Report</b>`,
        ``,
        `📁 Total projects: <b>${dailyTotal}</b>`,
        `🎅 Cool projects: <b>${dailyCool}</b>`,
        ``,
        `It was a great day, Let's go to Bed! 😴😴😴`,
      ].join("\n");
      try {
        await tg.sendMessage(report);
        console.log(`[monitor] Daily report sent: total=${dailyTotal} cool=${dailyCool}`);
      } catch (e) {
        console.error("[monitor] Daily report failed:", e);
      }
      // Reset counters and schedule next day
      dailyTotal = 0;
      dailyCool = 0;
      scheduleDailyReport();
    }, msUntil);
  }

  scheduleDailyReport();

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
    if (!decision.ok) {
      console.log(`[monitor] Filtered: ${p.title.slice(0, 40)} — ${decision.reasons.join(", ")}`);
      return;
    }

    // Count for daily report
    dailyTotal++;
    if (p.scoreText?.includes("🎅")) dailyCool++;

    // Send immediately — WebSocket already includes full client data
    const instantText = formatInstant(p, decision.reasons);
    let messageId: number | undefined;
    try {
      messageId = await tg.sendMessage(instantText);
      // Track message ID and auto-delete oldest if over limit
      sentMessageIds.push(messageId);
      if (sentMessageIds.length > MAX_MESSAGES) {
        const oldId = sentMessageIds.shift()!;
        void tg.deleteMessage(oldId).catch(() => {});
        console.log(`[monitor] Auto-deleted old message ${oldId} (limit: ${MAX_MESSAGES})`);
      }
      dashboard.recordFast(p);
      await dashboard.flush();
    } catch (e) {
      console.error("[telegram] send failed", e);
      return;
    }

    // AI enrichment async (edits the message after)
    if (cfg.ai.openaiApiKey) {
      void (async () => {
        try {
          const ai = await enrichProject({
            apiKey: cfg.ai.openaiApiKey!,
            model: cfg.ai.model,
            requiredSkills: cfg.rules.requiredSkills,
            project: p,
          });
          await tg.editMessage(messageId!, formatWithAI(instantText, ai));
          dashboard.recordAI(p.id, ai);
          await dashboard.flush();
        } catch (e) {
          console.error("[ai] enrichment failed", e);
        }
      })();
    } else {
      void tg.editMessage(
        messageId!,
        instantText.replace("🤖 <b>AI checker</b>: checking...", "🤖 <b>AI checker</b>: disabled (no key)"),
      ).catch(() => {});
    }
  }

  collector.onNewProject((p: Project) => { void handleNewProject(p); });

  collector.onWsDisconnect((code: number) => {
    const text = `⚠️ <b>WebSocket Disconnected</b>\nCode: ${code}\nReconnecting automatically...`;
    void tg.sendMessage(text).catch(() => {});
  });
  await collector.init();
  console.log("[monitor] Real-time WebSocket monitor running. Waiting for new projects...");

  // Global error handlers — send critical errors to Telegram
  const sendError = (context: string, err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? err.stack.slice(0, 300) : "";
    const text = `🚨 <b>Bot Error</b>\n\n<b>Context:</b> ${esc(context)}\n<b>Error:</b> ${esc(msg)}${stack ? `\n<b>Stack:</b> <code>${esc(stack)}</code>` : ""}`;
    void tg.sendMessage(text).catch(() => {});
    console.error(`[error] ${context}:`, err);
  };

  process.on("uncaughtException", (err) => {
    sendError("Uncaught Exception", err);
  });

  process.on("unhandledRejection", (reason) => {
    sendError("Unhandled Promise Rejection", reason);
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
