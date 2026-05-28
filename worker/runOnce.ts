import { readFileSync } from "node:fs";
import { Bot } from "grammy";
import { getEnvOptional } from "../lib/env.js";
import { loadSettings, loadProfile } from "../lib/config.js";
import { ensureDirs, MASTER_RESUME, DB_PATH } from "../lib/paths.js";
import { openDb, migrate } from "../lib/db.js";
import { runDailyPipeline } from "./pipeline.js";
import { launchSession, fetchHtml as realFetchHtml, ensureLoggedIn } from "./session.js";
import { parseSearchHtml } from "./parseSearch.js";
import { rank } from "../lib/rank.js";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  ensureDirs();
  const settings = loadSettings();
  const profile = loadProfile();
  const resumeText = readFileSync(MASTER_RESUME, "utf8");
  const db = openDb(DB_PATH);
  migrate(db);

  const token = getEnvOptional("TELEGRAM_BOT_TOKEN");
  const bot = token ? new Bot(token) : null;
  const send = async (chatId: number, text: string) => {
    if (!bot) {
      console.log(`[dry-send chat=${chatId}]\n${text}`);
      return;
    }
    await bot.api.sendMessage(chatId, text);
  };

  const context = await launchSession();
  try {
    const ok = await ensureLoggedIn(context);
    if (!ok) {
      console.error("[runOnce] LinkedIn session is not logged in — aborting before scrape.");
      console.error("  Set LI_AT (cookie) or LINKEDIN_EMAIL+LINKEDIN_PASSWORD in .env.");
      process.exit(2);
    }
    const result = await runDailyPipeline({
      db,
      settings,
      profile,
      resumeText,
      dryRun,
      deps: {
        fetchHtml: (url) => realFetchHtml(context, url, "body"),
        parseHtml: parseSearchHtml,
        rankFn: (postings, opts) => rank(postings, opts),
        sendMessage: send,
      },
    });
    console.log(
      `[runOnce] status=${result.status} foundNew=${result.foundNew} suggested=${result.suggested}`,
    );
  } finally {
    await context.close();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
