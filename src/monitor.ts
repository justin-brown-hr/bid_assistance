import path from "node:path";
import { cfg, assertStartupConfig } from "./config.js";
import { WsCollector } from "./collect/wsCollector.js";
import { fastDecision } from "./fastFilter.js";
import { SeenStore } from "./store/seenStore.js";
import { TelegramClient } from "./notify/telegram.js";
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

  const tg = new TelegramClient({
    token: cfg.telegram.token!,
    chatId: cfg.telegram.chatId!,
  });

  // Map project id → description for callback lookups
  const descriptionMap = new Map<string, string>();
  // Map project id → sent description message id (for toggle delete)
  const descMsgIdMap = new Map<string, number>();

  // Start polling for "📋 Description" / "🙈 Hide" button taps
  tg.startPolling(async (data, chatId, queryId, notifMsgId) => {
    await tg.answerCallbackQuery(queryId);

    if (data.startsWith("show:")) {
      const projectId = data.slice(5);
      const desc = descriptionMap.get(projectId);
      if (!desc) {
        await tg.sendToChat(chatId, "Description not available.");
        return;
      }
      // Send description message and track it
      const msgId = await tg.sendToChatWithId(chatId, `<code>${esc(desc)}</code>`);
      if (msgId) {
        descMsgIdMap.set(projectId, msgId);
        trackMessage(msgId);
      }
      // Swap button to "🙈 Hide"
      await tg.editMessageReplyMarkup(chatId, notifMsgId, [[
        { text: "🙈 Hide", callback_data: `hide:${projectId}` },
      ]]);

    } else if (data.startsWith("hide:")) {
      const projectId = data.slice(5);
      const descMsgId = descMsgIdMap.get(projectId);
      if (descMsgId) {
        await tg.deleteMessage(descMsgId, chatId);
        descMsgIdMap.delete(projectId);
        // Remove from tracking so it doesn't count toward the limit
        const idx = sentMessageIds.indexOf(descMsgId);
        if (idx !== -1) sentMessageIds.splice(idx, 1);
      }
      // Swap button back to "📋 Description"
      await tg.editMessageReplyMarkup(chatId, notifMsgId, [[
        { text: "📋 Description", callback_data: `show:${projectId}` },
      ]]);
    }
  });

  // Track sent message IDs in the primary chat — auto-delete oldest when count exceeds MAX_MESSAGES
  const MAX_MESSAGES = 50;
  const sentMessageIds: number[] = [];

  // Helper: push a message id and trim oldest if over limit
  function trackMessage(msgId: number): void {
    sentMessageIds.push(msgId);
    if (sentMessageIds.length > MAX_MESSAGES) {
      const oldId = sentMessageIds.shift()!;
      void tg.deleteMessage(oldId).catch(() => {});
      console.log(`[monitor] Auto-deleted old message ${oldId} (limit: ${MAX_MESSAGES})`);
    }
  }

  // Daily counters
  let dailyTotal = 0;
  let dailyCool = 0;
  let dailyRecruiter = 0;

  // Schedule daily report at 1:00 PM PST = 21:00 UTC
  function scheduleDailyReport() {
    const now = new Date();
    const next = new Date();
    // Set to next 21:00 UTC
    next.setUTCHours(21, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    const msUntil = next.getTime() - now.getTime();
    console.log(`[monitor] Daily report scheduled in ${Math.round(msUntil / 60000)} minutes (1:00 PM PST).`);
    setTimeout(async () => {
      const report = [
        `🌗 <b>Daily Report</b>`,
        ``,
        `📁 Total projects: <b>${dailyTotal}</b>`,
        `🎅 Cool projects: <b>${dailyCool}</b>`,
        `(P) Recruiter projects: <b>${dailyRecruiter}</b>`,
        ``,
        `It was a great day, Let's go to Bed! 😴😴😴`,
      ].join("\n");
      try {
        await tg.sendMessage(report);
        console.log(`[monitor] Daily report sent: total=${dailyTotal} cool=${dailyCool} recruiter=${dailyRecruiter}`);
      } catch (e) {
        console.error("[monitor] Daily report failed:", e);
      }
      dailyTotal = 0;
      dailyCool = 0;
      dailyRecruiter = 0;
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
    if (p.recruiter) dailyRecruiter++;

    // Send immediately — WebSocket already includes full client data
    const instantText = formatInstant(p, decision.reasons);
    let messageId: number | undefined;
    try {
      // Store description for button callback (keyed by project id)
      if (p.description) {
        descriptionMap.set(p.id, p.description);
        // Keep map from growing unbounded — drop oldest entries beyond 200
        if (descriptionMap.size > 200) {
          const firstKey = descriptionMap.keys().next().value;
          if (firstKey !== undefined) descriptionMap.delete(firstKey);
        }
      }

      messageId = p.description
        ? await tg.sendMessageWithButton(instantText, p.id)
        : await tg.sendMessage(instantText);
      trackMessage(messageId);
    } catch (e) {
      console.error("[telegram] send failed", e);
      return;
    }
  }

  collector.onNewProject((p: Project) => { void handleNewProject(p); });

  collector.onWsDisconnect((code: number) => {
    const text = `⚠️ <b>WebSocket Disconnected</b>\nCode: ${code}\nReconnecting automatically...`;
    void tg.sendMessage(text).catch(() => {});
  });
  await collector.init();
  console.log("[monitor] Real-time WebSocket monitor running. Waiting for new projects...");

  process.on("uncaughtException", (err) => {
    console.error("[error] Uncaught Exception:", err);
    void tg.sendMessage(`🚨 <b>Bot Error</b>\n\n<b>Context:</b> Uncaught Exception\n<b>Error:</b> ${esc(String(err instanceof Error ? err.message : err))}`).catch(() => {});
    // Don't exit — let PM2 handle restarts only for truly fatal errors
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[error] Unhandled Rejection:", reason);
    void tg.sendMessage(`🚨 <b>Bot Error</b>\n\n<b>Context:</b> Unhandled Rejection\n<b>Error:</b> ${esc(String(reason instanceof Error ? reason.message : reason))}`).catch(() => {});
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
