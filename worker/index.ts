import { Bot } from "grammy";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getEnv } from "../lib/env.js";
import { loadSettings, loadProfile } from "../lib/config.js";
import { ensureDirs, MASTER_RESUME, DB_PATH } from "../lib/paths.js";
import { openDb, migrate } from "../lib/db.js";
import { buildBot } from "./bot.js";
import { runDailyPipeline } from "./pipeline.js";
import { scheduleDaily } from "./scheduler.js";
import { launchSession, fetchHtml as realFetchHtml } from "./session.js";
import { parseSearchHtml } from "./parseSearch.js";
import { rank } from "../lib/rank.js";
import { tailor } from "../lib/tailor.js";
import { compilePdf } from "../lib/compile.js";
import * as tracker from "../lib/tracker.js";

async function main() {
  ensureDirs();
  const settings = loadSettings();
  const profile = loadProfile();
  const resumeText = readFileSync(MASTER_RESUME, "utf8");
  const db = openDb(DB_PATH);
  migrate(db);

  const bot = new Bot(getEnv("TELEGRAM_BOT_TOKEN"));
  const send = async (chatId: number, text: string) => {
    await bot.api.sendMessage(chatId, text);
  };

  const handlers = buildBot({
    db,
    settings,
    profile,
    resumeText,
    deps: {
      sendMessage: send,
      tailorFn: tailor,
      compileFn: compilePdf,
      writeFile: async (path, contents) => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, contents, "utf8");
      },
      startApply: async (appId) => {
        const app = db.prepare(
          `SELECT a.*, j.url, j.title, j.company FROM applications a
             JOIN jobs j ON j.id = a.job_id WHERE a.id = ?`,
        ).get(appId) as any;
        await send(
          settings.telegram.chatId,
          [
            `📝 Manual apply mode (apply agent disabled).`,
            `Resume: ${app?.resume_path}`,
            `Cover letter: ${app?.cover_letter_path}`,
            `Apply here: ${app?.url}`,
            ``,
            `When done, reply: /done ${appId}`,
          ].join("\n"),
        );
      },
    },
  });

  bot.on("callback_query:data", async (ctx) => {
    const chatId = ctx.chat?.id ?? settings.telegram.chatId;
    await handlers.onCallback(chatId, ctx.callbackQuery.data);
    await ctx.answerCallbackQuery();
  });
  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;
    const doneMatch = text.match(/^\/done\s+(\d+)$/i);
    if (doneMatch) {
      const appId = Number(doneMatch[1]);
      const app = tracker.getApplication(db, appId);
      if (!app) { await send(chatId, `No app #${appId}.`); return; }
      tracker.setStatus(db, appId, "applied");
      await send(chatId, `✅ Marked app #${appId} as applied.`);
      return;
    }
    await handlers.onText(chatId, text);
  });

  scheduleDaily(settings.schedule.time, async () => {
    const context = await launchSession();
    try {
      await runDailyPipeline({
        db,
        settings,
        profile,
        resumeText,
        deps: {
          fetchHtml: (url) => realFetchHtml(context, url, "body"),
          parseHtml: parseSearchHtml,
          rankFn: (postings, opts) => rank(postings, opts),
          sendMessage: send,
        },
      });
    } finally {
      await context.close();
    }
  });

  await bot.start();
  console.log(`[worker] started — daily run at ${settings.schedule.time}`);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
