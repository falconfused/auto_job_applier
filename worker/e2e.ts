/**
 * End-to-end smoke (no-apply): ingest → rank → fetch JD → tailor → compile PDFs.
 * Stops before any submit. Optionally posts the tailored package to Telegram if
 * the bot has at least one chat to reply to.
 *
 * Usage: npm run e2e
 */
import "dotenv/config";
delete process.env.AWS_PROFILE; // ensure .env Bedrock creds win

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import * as cheerio from "cheerio";

import { openDb, migrate } from "../lib/db.js";
import { loadProfile } from "../lib/config.js";
import { rank } from "../lib/rank.js";
import { tailor } from "../lib/tailor.js";
import { compilePdf, CompileError } from "../lib/compile.js";
import { MASTER_RESUME, JOBS_DIR } from "../lib/paths.js";
import { launchSession, fetchHtml } from "./session.js";
import { ingest } from "./ingest.js";

// ---- helpers ----
const slug = (s: string) =>
  s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40);

async function fetchJdText(url: string): Promise<string> {
  const context = await launchSession();
  try {
    const html = await fetchHtml(context, url, "body");
    const $ = cheerio.load(html);
    // LinkedIn's job-description class names are randomized. Anchor on the stable
    // "About the job" heading and walk up to the smallest substantial ancestor.
    const $h = $("main h2, main h3").filter(
      (_: any, el: any) => /about the job/i.test($(el).text()),
    ).first();
    if ($h.length) {
      let $p = $h.parent();
      for (let i = 0; i < 6; i++) {
        const t = $p.text().replace(/\s+/g, " ").trim();
        if (t.length > 1000 && t.length < 12000) return t;
        $p = $p.parent();
        if (!$p.length) break;
      }
    }
    // Fallback: any div under main whose text begins with "About the job".
    let best = "";
    $("main div").each((_: any, el: any) => {
      const t = $(el).text().replace(/\s+/g, " ").trim();
      if (/^about the job/i.test(t) && t.length > best.length && t.length < 12000) best = t;
    });
    if (best) return best;
    // Last resort: main text (page chrome + JD), trimmed.
    return $("main").text().replace(/\s+/g, " ").trim().slice(0, 8000);
  } finally {
    await context.close();
  }
}

async function trySendTelegram(
  token: string,
  message: string,
  files: { path: string; caption: string }[],
): Promise<{ chatId: number | null; reason?: string }> {
  try {
    const { Bot, InputFile } = await import("grammy");
    const bot = new Bot(token);
    const updates = await bot.api.getUpdates({ limit: 5, timeout: 0 });
    const chatId = updates.find((u) => u.message?.chat?.id)?.message?.chat?.id ?? null;
    if (!chatId) return { chatId: null, reason: "no recent chat — DM the bot once to start" };
    await bot.api.sendMessage(chatId, message);
    for (const f of files) {
      if (existsSync(f.path)) {
        await bot.api.sendDocument(chatId, new InputFile(f.path), { caption: f.caption });
      }
    }
    return { chatId };
  } catch (err) {
    return { chatId: null, reason: (err as Error).message };
  }
}

// ---- main ----
async function main() {
  const profile = loadProfile() as Record<string, any>;
  const resumeText = readFileSync(MASTER_RESUME, "utf8");
  const db = openDb(":memory:");
  migrate(db);

  console.log("\n[1/5] Ingesting LinkedIn search results...");
  const filters = [
    { keywords: "Software Engineer", location: "India", experienceLevel: "", datePosted: "" },
    { keywords: "Backend Engineer", location: "India", experienceLevel: "", datePosted: "" },
    { keywords: "Full Stack Developer", location: "India", experienceLevel: "", datePosted: "" },
  ];
  const postings = await ingest(db, filters, true);
  console.log(`  → ${postings.length} postings`);

  console.log("\n[2/5] Ranking with Claude on Bedrock...");
  const ranked = (await rank(postings, { resumeText, profile, topN: 10 })).slice(0, 10);
  console.log(`  → top ${ranked.length}:`);
  for (const [i, s] of ranked.entries()) {
    console.log(`     ${i + 1}. [fit ${s.fitScore}] ${s.posting.title} · ${s.posting.company} · ${s.posting.location}`);
  }
  if (!ranked.length) { console.log("\nnothing to tailor — exiting."); process.exit(0); }

  const pick = ranked[0];
  console.log(`\n[3/5] Fetching JD for #1 (${pick.posting.title} · ${pick.posting.company})...`);
  const jdText = (await fetchJdText(pick.posting.url)).slice(0, 8000);
  console.log(`  → ${jdText.length} chars`);
  console.log(`  preview: ${jdText.slice(0, 220)}${jdText.length > 220 ? "…" : ""}`);

  console.log(`\n[4/5] Tailoring resume + cover letter via Claude on Bedrock...`);
  const docs = await tailor({ masterTex: resumeText, jdText, profile });
  console.log(`  → resume.tex ${docs.resumeTex.length} chars, cover_letter.tex ${docs.coverLetterTex.length} chars`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jobDir = join(JOBS_DIR, `${stamp}_${slug(pick.posting.company + "-" + pick.posting.title)}`);
  mkdirSync(jobDir, { recursive: true });
  const resumeTexPath = join(jobDir, "resume.tex");
  const coverTexPath = join(jobDir, "cover_letter.tex");
  writeFileSync(resumeTexPath, docs.resumeTex, "utf8");
  writeFileSync(coverTexPath, docs.coverLetterTex, "utf8");
  writeFileSync(join(jobDir, "jd.txt"), jdText, "utf8");
  writeFileSync(
    join(jobDir, "job.json"),
    JSON.stringify({ ...pick.posting, fitScore: pick.fitScore, fitReason: pick.fitReason }, null, 2),
    "utf8",
  );
  console.log(`  artifacts in: ${jobDir}`);

  console.log(`\n[5/5] Compiling PDFs via tectonic...`);
  let resumePdf: string | null = null;
  let coverPdf: string | null = null;
  try {
    resumePdf = await compilePdf(resumeTexPath, jobDir);
    console.log(`  ✓ resume.pdf  (${statSync(resumePdf).size} bytes)`);
  } catch (e) {
    console.error(`  ✗ resume compile: ${(e as CompileError).message.slice(0, 400)}`);
  }
  try {
    coverPdf = await compilePdf(coverTexPath, jobDir);
    console.log(`  ✓ cover_letter.pdf  (${statSync(coverPdf).size} bytes)`);
  } catch (e) {
    console.error(`  ✗ cover_letter compile: ${(e as CompileError).message.slice(0, 400)}`);
  }

  // Optional: telegram delivery if a chat exists.
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (token) {
    console.log(`\n[bonus] Telegram delivery...`);
    const tg = await trySendTelegram(
      token,
      `🧪 e2e: #1 of ${ranked.length}\n${pick.posting.title} · ${pick.posting.company} · ${pick.posting.location}\nfit ${pick.fitScore} — ${pick.fitReason}\n${pick.posting.url}`,
      [
        ...(resumePdf ? [{ path: resumePdf, caption: "Tailored resume" }] : []),
        ...(coverPdf ? [{ path: coverPdf, caption: "Tailored cover letter" }] : []),
      ],
    );
    if (tg.chatId) console.log(`  ✓ delivered to chat ${tg.chatId}`);
    else console.log(`  – skipped: ${tg.reason}`);
  }

  console.log(`\nWould submit at:  ${pick.posting.url}`);
  console.log(`STOPPING before submit — end-to-end verified (no apply per policy).\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("\nE2E failed:", err);
  process.exit(1);
});
