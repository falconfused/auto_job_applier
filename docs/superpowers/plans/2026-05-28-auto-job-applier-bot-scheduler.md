# Auto Job Applier — Telegram Bot + Scheduler Implementation Plan (Node/TypeScript)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Plan 1 + 2 units (`ingest`, `rank`, `tailor`, `compile`, `tracker`) into a daily 8 PM pipeline, deliver the top-N digest to Telegram with Apply/Deny buttons, and run the per-job approval flow (Submit / Edit / Cancel + free-text edit loop) — without yet driving the Easy-Apply browser submit (that's Plan 4).

**Architecture:** A standalone long-running Node process (`worker/index.ts`) starts both a `node-cron` scheduler and a `grammy` Telegram bot. The pipeline (`worker/pipeline.ts`) is a pure async function that takes `{ db, settings, profile, deps }` and runs ingest → rank → record suggestions → notify, with every external dependency (LLMs, browser fetch, Telegram, time) injected so it's unit-testable offline. Telegram callbacks are idempotent: each tap maps to exactly one tracker status transition; double-taps are no-ops. The submit step in Plan 3 stops at `awaiting_submit` and announces "submit handler not yet wired (Plan 4)" — leaving room for Plan 4 to drop in the Claude Agent SDK applier without touching the bot wiring.

**Tech Stack:** adds `grammy` (Telegram bot), `node-cron` (scheduler), `dotenv` (env loader). Builds on Plan 1 (`lib/`) and Plan 2 (`worker/ingest.ts`, `worker/searchUrl.ts`, `worker/parseSearch.ts`).

This is Plan 3 of 5 for LinkedIn v1. It depends on Plans 1 + 2 (merged). Plans 4–5 (apply agent, dashboard) follow.

---

## File Structure

```
auto_job_applier/
  worker/
    index.ts              # boot: load env, start scheduler + bot
    scheduler.ts          # node-cron — fires runDailyPipeline at settings.schedule.time
    pipeline.ts           # runDailyPipeline({db, settings, profile, deps}) — pure orchestrator
    bot.ts                # buildBot({db, settings, deps}) — grammy bot with all handlers
    formatters.ts         # pure: digest message, gate messages
    runOnce.ts            # CLI: `npm run pipeline:once` — run pipeline immediately (supports --dry-run)
  lib/
    env.ts                # dotenv-backed getEnv("KEY") with friendly errors
  tests/
    formatters.test.ts
    pipeline.test.ts
    bot.test.ts
```

`.env` (already gitignored) needs: `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`. `config/settings.yaml` needs `telegram.chatId`.

---

## Task 1: Add deps + env loader

**Files:**
- Modify: `package.json`
- Create: `lib/env.ts`
- Create: `.env.example`

- [ ] **Step 1: Add deps**

```bash
npm install grammy node-cron dotenv
npm install -D @types/node-cron
```
Expected: installs without error.

- [ ] **Step 2: Add scripts to `package.json`**

In the `"scripts"` block, add:
```json
    "worker": "tsx worker/index.ts",
    "pipeline:once": "tsx worker/runOnce.ts"
```

- [ ] **Step 3: Write `.env.example`**

```env
# Anthropic API key for ranking + tailoring
ANTHROPIC_API_KEY=sk-ant-...

# Telegram bot token from @BotFather
TELEGRAM_BOT_TOKEN=123456:ABC-...
```

- [ ] **Step 4: Write `lib/env.ts`**

```typescript
import "dotenv/config";

export class MissingEnvError extends Error {}

export function getEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new MissingEnvError(`Missing required env var ${key}. Add it to .env`);
  return v;
}

export function getEnvOptional(key: string): string | undefined {
  return process.env[key]?.trim() || undefined;
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/env.ts .env.example
git commit -m "chore: add grammy + node-cron + dotenv"
```

---

## Task 2: Pure formatters

**Files:**
- Create: `worker/formatters.ts`
- Create: `tests/formatters.test.ts`

- [ ] **Step 1: Write the failing test `tests/formatters.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { formatDigest, formatGate2Message, formatExternalMessage } from "../worker/formatters.js";
import type { ScoredPosting } from "../lib/types.js";

function scored(id: string, applyType: "easy_apply" | "external", score: number): ScoredPosting {
  return {
    posting: {
      linkedinJobId: id,
      title: `Title ${id}`,
      company: `Co ${id}`,
      location: "Remote",
      url: `https://linkedin.com/jobs/view/${id}`,
      applyType,
      jdText: "",
    },
    fitScore: score,
    fitReason: `reason ${id}`,
  };
}

describe("formatDigest", () => {
  it("renders one card per posting with fit score and reason", () => {
    const msg = formatDigest([scored("1", "easy_apply", 80), scored("2", "external", 60)]);
    expect(msg).toContain("Title 1");
    expect(msg).toContain("Co 1");
    expect(msg).toContain("80");
    expect(msg).toContain("reason 1");
    expect(msg).toContain("Title 2");
    expect(msg).toContain("external"); // tag for external jobs
  });

  it("returns a 'no matches' message for empty input", () => {
    expect(formatDigest([])).toMatch(/no.*matches/i);
  });
});

describe("formatExternalMessage", () => {
  it("includes the job url", () => {
    const msg = formatExternalMessage(scored("9", "external", 70));
    expect(msg).toContain("https://linkedin.com/jobs/view/9");
  });
});

describe("formatGate2Message", () => {
  it("describes what will be submitted", () => {
    const msg = formatGate2Message(scored("3", "easy_apply", 90), { resumePath: "/r.pdf", coverLetterPath: "/c.pdf" });
    expect(msg).toContain("Title 3");
    expect(msg).toContain("Co 3");
    expect(msg).toContain("Submit");
    expect(msg).toContain("Edit");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/formatters.test.ts`
Expected: FAIL — `../worker/formatters.js` missing.

- [ ] **Step 3: Write `worker/formatters.ts`**

```typescript
import type { ScoredPosting } from "../lib/types.js";

export function formatDigest(scored: ScoredPosting[]): string {
  if (scored.length === 0) return "No matches found in tonight's run.";
  const lines = scored.map((s, i) => {
    const tag = s.posting.applyType === "external" ? " 🔗 external" : "";
    return [
      `${i + 1}. ${s.posting.title} — ${s.posting.company}${tag}`,
      `   📍 ${s.posting.location}   •   fit: ${s.fitScore}/100`,
      `   ${s.fitReason}`,
    ].join("\n");
  });
  return ["Tonight's top matches:", "", ...lines].join("\n");
}

export function formatExternalMessage(s: ScoredPosting): string {
  return [
    `🔗 External job — apply manually:`,
    `${s.posting.title} — ${s.posting.company}`,
    s.posting.url,
  ].join("\n");
}

export function formatGate2Message(
  s: ScoredPosting,
  paths: { resumePath: string; coverLetterPath: string },
): string {
  return [
    `Tailored for: ${s.posting.title} — ${s.posting.company}`,
    `Resume: ${paths.resumePath}`,
    `Cover letter: ${paths.coverLetterPath}`,
    "",
    "Reply with:",
    "  ✅ Submit  — go ahead and apply",
    "  ✏️ Edit    — reply with what to change",
    "  ❌ Cancel  — drop this one",
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/formatters.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/formatters.ts tests/formatters.test.ts
git commit -m "feat: telegram digest + gate message formatters"
```

---

## Task 3: Pipeline orchestrator (runDailyPipeline)

**Files:**
- Create: `worker/pipeline.ts`
- Create: `tests/pipeline.test.ts`

The pipeline is a pure async function. Every external surface — LLM, browser fetch, Telegram send — is injected so the test drives it with stubs and asserts on what got persisted.

- [ ] **Step 1: Write the failing test `tests/pipeline.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { openDb, migrate, type DB } from "../lib/db.js";
import * as tracker from "../lib/tracker.js";
import { runDailyPipeline } from "../worker/pipeline.js";
import type { Posting, ScoredPosting } from "../lib/types.js";

function posting(id: string, applyType: "easy_apply" | "external" = "easy_apply"): Posting {
  return { linkedinJobId: id, title: `T${id}`, company: "Acme", location: "Remote", url: `https://x/${id}`, applyType, jdText: "" };
}

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
});

const settings = {
  schedule: { time: "20:00" },
  ranking: { topN: 2 },
  search: { filters: [{ keywords: "SDE", location: "India", experienceLevel: "", datePosted: "" }] },
  apply: { dailyCap: 8, easyApplyOnly: true },
  llm: { model: "claude-sonnet-4-6" },
  telegram: { chatId: 42 },
} as const;

const profile = { name: "Vivek" };

describe("runDailyPipeline", () => {
  it("ingests, ranks, records suggestions, and notifies", async () => {
    const sent: string[] = [];
    const result = await runDailyPipeline({
      db,
      settings,
      profile,
      resumeText: "MASTER",
      deps: {
        fetchHtml: async () => "<html></html>",
        parseHtml: () => [posting("1"), posting("2"), posting("3")],
        rankFn: async (postings, _opts) =>
          postings.slice(0, 2).map((p, i) => ({ posting: p, fitScore: 90 - i * 10, fitReason: `r${i}` })) as ScoredPosting[],
        sendMessage: async (_chatId, text) => { sent.push(text); },
      },
    });

    expect(result.foundNew).toBe(3);
    expect(result.suggested).toBe(2);
    expect(result.status).toBe("ok");
    // run row recorded
    expect(tracker.getRun(db, result.runId)?.status).toBe("ok");
    // applications created in 'suggested' status
    expect(tracker.getJobByLinkedinId(db, "1")).toBeTruthy();
    // a digest message was sent
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent[0]).toContain("T1");
  });

  it("records failed run when ingest throws and sends an alert", async () => {
    const sent: string[] = [];
    const result = await runDailyPipeline({
      db,
      settings,
      profile,
      resumeText: "MASTER",
      deps: {
        fetchHtml: async () => { throw new Error("boom"); },
        parseHtml: () => [],
        rankFn: async () => [],
        sendMessage: async (_id, t) => { sent.push(t); },
      },
    });

    expect(result.status).toBe("failed");
    expect(tracker.getRun(db, result.runId)?.status).toBe("failed");
    expect(sent.join("\n")).toMatch(/failed|error/i);
  });

  it("dryRun true does NOT create applications or send messages", async () => {
    const sent: string[] = [];
    const result = await runDailyPipeline({
      db,
      settings,
      profile,
      resumeText: "MASTER",
      dryRun: true,
      deps: {
        fetchHtml: async () => "<html></html>",
        parseHtml: () => [posting("1")],
        rankFn: async (postings) => postings.map((p) => ({ posting: p, fitScore: 50, fitReason: "" })) as ScoredPosting[],
        sendMessage: async (_id, t) => { sent.push(t); },
      },
    });

    expect(result.suggested).toBe(1);
    expect(sent).toEqual([]); // dry-run stays silent
    // job is still recorded (so the next non-dry run dedupes correctly)
    expect(tracker.getJobByLinkedinId(db, "1")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline.test.ts`
Expected: FAIL — `../worker/pipeline.js` missing.

- [ ] **Step 3: Write `worker/pipeline.ts`**

```typescript
import type { DB } from "../lib/db.js";
import type { Posting, ScoredPosting } from "../lib/types.js";
import type { Settings } from "../lib/config.js";
import * as tracker from "../lib/tracker.js";
import { ingestWith } from "./ingest.js";
import { formatDigest, formatExternalMessage } from "./formatters.js";

export interface PipelineDeps {
  fetchHtml: (url: string) => Promise<string>;
  parseHtml?: (html: string) => Posting[];
  rankFn: (
    postings: Posting[],
    opts: { resumeText: string; profile: Record<string, unknown>; topN: number; model?: string },
  ) => Promise<ScoredPosting[]>;
  sendMessage: (chatId: number, text: string) => Promise<void>;
}

export interface PipelineArgs {
  db: DB;
  settings: Settings;
  profile: Record<string, unknown>;
  resumeText: string;
  deps: PipelineDeps;
  dryRun?: boolean;
}

export interface PipelineResult {
  runId: number;
  searched: number;
  foundNew: number;
  suggested: number;
  status: "ok" | "failed";
  error?: string;
}

export async function runDailyPipeline(args: PipelineArgs): Promise<PipelineResult> {
  const { db, settings, profile, resumeText, deps, dryRun } = args;
  let foundNew = 0;
  let scored: ScoredPosting[] = [];

  try {
    const newPostings = await ingestWith({
      db,
      filters: settings.search.filters,
      easyApplyOnly: settings.apply.easyApplyOnly,
      fetchHtml: deps.fetchHtml,
      parse: deps.parseHtml,
    });
    foundNew = newPostings.length;

    if (newPostings.length > 0) {
      scored = await deps.rankFn(newPostings, {
        resumeText,
        profile,
        topN: settings.ranking.topN,
        model: settings.llm.model,
      });
    }

    if (!dryRun) {
      const runDate = new Date().toISOString();
      for (let i = 0; i < scored.length; i++) {
        const s = scored[i];
        const job = tracker.getJobByLinkedinId(db, s.posting.linkedinJobId);
        if (!job) continue;
        tracker.addSuggestion(db, job.id, runDate, i + 1, s.fitScore, s.fitReason);
        tracker.createApplication(db, job.id);
      }
    }
  } catch (err) {
    const runId = tracker.recordRun(db, {
      searched: settings.search.filters.length,
      foundNew,
      suggested: 0,
      status: "failed",
      error: (err as Error).message,
    });
    if (!dryRun) {
      await deps.sendMessage(settings.telegram.chatId, `Pipeline FAILED: ${(err as Error).message}`).catch(() => {});
    }
    return { runId, searched: settings.search.filters.length, foundNew, suggested: 0, status: "failed", error: (err as Error).message };
  }

  const runId = tracker.recordRun(db, {
    searched: settings.search.filters.length,
    foundNew,
    suggested: scored.length,
    status: "ok",
  });

  if (!dryRun && scored.length > 0) {
    await deps.sendMessage(settings.telegram.chatId, formatDigest(scored));
    for (const s of scored) {
      if (s.posting.applyType === "external") {
        await deps.sendMessage(settings.telegram.chatId, formatExternalMessage(s));
      }
    }
  }

  return { runId, searched: settings.search.filters.length, foundNew, suggested: scored.length, status: "ok" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/pipeline.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/pipeline.ts tests/pipeline.test.ts
git commit -m "feat: daily pipeline orchestrator with dry-run + failure handling"
```

---

## Task 4: Telegram bot (handlers, idempotent transitions)

**Files:**
- Create: `worker/bot.ts`
- Create: `tests/bot.test.ts`

The bot exposes one factory `buildBot({ db, settings, deps })` that takes a chat-send function (`deps.sendMessage`) and three injected handlers (`deps.startApply`, `deps.compileFn`, `deps.tailorFn`). The factory returns a plain object with `onCallback(chatId, data)` and `onText(chatId, text, replyToAppId?)` so tests can drive it with simulated grammy events. The actual grammy bot is wired in `worker/index.ts` and forwards to these handlers.

- [ ] **Step 1: Write the failing test `tests/bot.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { openDb, migrate, type DB } from "../lib/db.js";
import * as tracker from "../lib/tracker.js";
import { buildBot } from "../worker/bot.js";
import type { Posting } from "../lib/types.js";

const sample: Posting = {
  linkedinJobId: "100",
  title: "Backend Engineer",
  company: "Acme",
  location: "Bangalore",
  url: "https://linkedin.com/jobs/view/100",
  applyType: "easy_apply",
  jdText: "Build APIs.",
};

let db: DB;
let appId: number;
let sent: { chatId: number; text: string }[];

beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
  const jobId = tracker.addJob(db, sample);
  appId = tracker.createApplication(db, jobId);
  sent = [];
});

const settings = {
  schedule: { time: "20:00" },
  ranking: { topN: 10 },
  search: { filters: [] },
  apply: { dailyCap: 8, easyApplyOnly: true },
  llm: { model: "claude-sonnet-4-6" },
  telegram: { chatId: 42 },
} as const;

function mkBot(overrides: Partial<Parameters<typeof buildBot>[0]["deps"]> = {}) {
  return buildBot({
    db,
    settings,
    profile: { name: "V" },
    resumeText: "MASTER",
    deps: {
      sendMessage: async (chatId, text) => { sent.push({ chatId, text }); },
      tailorFn: async () => ({ resumeTex: "\\doc r", coverLetterTex: "\\doc c" }),
      compileFn: async (_tex, outDir) => `${outDir}/out.pdf`,
      writeFile: async () => {}, // no-op for tex artifacts
      startApply: async (_appId) => { /* Plan 4 will wire this */ },
      ...overrides,
    },
  });
}

describe("bot — Apply/Deny gate (Gate 1)", () => {
  it("Deny → dismissed", async () => {
    const bot = mkBot();
    await bot.onCallback(42, `deny:${appId}`);
    expect(tracker.getApplication(db, appId)?.status).toBe("dismissed");
  });

  it("Deny is idempotent (double-tap = single transition)", async () => {
    const bot = mkBot();
    await bot.onCallback(42, `deny:${appId}`);
    await bot.onCallback(42, `deny:${appId}`);
    expect(tracker.getApplication(db, appId)?.status).toBe("dismissed");
    // only one dismissal message sent
    expect(sent.filter((m) => /dismissed|denied/i.test(m.text)).length).toBe(1);
  });

  it("Apply on external job → external_sent + link reply", async () => {
    const job = tracker.getJobByLinkedinId(db, "100")!;
    db.prepare("UPDATE jobs SET apply_type = 'external' WHERE id = ?").run(job.id);
    const bot = mkBot();
    await bot.onCallback(42, `apply:${appId}`);
    expect(tracker.getApplication(db, appId)?.status).toBe("external_sent");
    expect(sent.some((m) => m.text.includes("https://linkedin.com/jobs/view/100"))).toBe(true);
  });

  it("Apply on easy-apply → tailor → awaiting_submit + Gate 2 prompt", async () => {
    const bot = mkBot();
    await bot.onCallback(42, `apply:${appId}`);
    expect(tracker.getApplication(db, appId)?.status).toBe("awaiting_submit");
    expect(tracker.getApplication(db, appId)?.resume_path).toBeTruthy();
    expect(sent.some((m) => /Submit/i.test(m.text) && /Edit/i.test(m.text))).toBe(true);
  });
});

describe("bot — Submit/Edit/Cancel gate (Gate 2)", () => {
  beforeEach(async () => {
    // get the app to awaiting_submit via Gate 1
    const bot = mkBot();
    await bot.onCallback(42, `apply:${appId}`);
    sent.length = 0;
  });

  it("Cancel → cancelled", async () => {
    const bot = mkBot();
    await bot.onCallback(42, `cancel:${appId}`);
    expect(tracker.getApplication(db, appId)?.status).toBe("cancelled");
  });

  it("Edit + free-text → re-tailor + new Gate 2 prompt + edit_notes recorded", async () => {
    const bot = mkBot();
    await bot.onCallback(42, `edit:${appId}`);
    await bot.onText(42, "drop project X, emphasize python", appId);
    const app = tracker.getApplication(db, appId);
    expect(app?.edit_notes).toContain("drop project X");
    expect(app?.status).toBe("awaiting_submit"); // back to gate 2 after re-tailor
    expect(sent.some((m) => /Submit/i.test(m.text))).toBe(true);
  });

  it("Submit calls startApply with the appId", async () => {
    let started = -1;
    const bot = mkBot({ startApply: async (id) => { started = id; } });
    await bot.onCallback(42, `submit:${appId}`);
    expect(started).toBe(appId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bot.test.ts`
Expected: FAIL — `../worker/bot.js` missing.

- [ ] **Step 3: Write `worker/bot.ts`**

```typescript
import { join } from "node:path";
import type { DB } from "../lib/db.js";
import type { Settings } from "../lib/config.js";
import type { TailoredDocs } from "../lib/types.js";
import * as tracker from "../lib/tracker.js";
import { JOBS_DIR } from "../lib/paths.js";
import { formatExternalMessage, formatGate2Message } from "./formatters.js";

export interface BotDeps {
  sendMessage: (chatId: number, text: string) => Promise<void>;
  tailorFn: (args: {
    masterTex: string;
    jdText: string;
    profile: Record<string, unknown>;
    editNotes?: string;
    model?: string;
  }) => Promise<TailoredDocs>;
  compileFn: (texPath: string, outDir: string) => Promise<string>;
  writeFile: (path: string, contents: string) => Promise<void>;
  startApply: (appId: number) => Promise<void>;
}

export interface BotArgs {
  db: DB;
  settings: Settings;
  profile: Record<string, unknown>;
  resumeText: string;
  deps: BotDeps;
}

interface PendingEdit {
  appId: number;
}
const pendingEditByChat = new Map<number, PendingEdit>();

function slugFor(jobId: number): string {
  return `job-${jobId}`;
}

export function buildBot(args: BotArgs) {
  const { db, settings, profile, resumeText, deps } = args;

  async function tailorAndCompile(appId: number, jobId: number, editNotes: string) {
    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as any;
    const docs = await deps.tailorFn({
      masterTex: resumeText,
      jdText: job.jd_text || "",
      profile,
      editNotes,
      model: settings.llm.model,
    });
    const slug = slugFor(jobId);
    const outDir = join(JOBS_DIR, slug);
    const resumeTex = join(outDir, "resume.tex");
    const coverTex = join(outDir, "cover_letter.tex");
    await deps.writeFile(resumeTex, docs.resumeTex);
    await deps.writeFile(coverTex, docs.coverLetterTex);
    const resumePdf = await deps.compileFn(resumeTex, outDir);
    const coverPdf = await deps.compileFn(coverTex, outDir);
    tracker.setResumePaths(db, appId, resumePdf, coverPdf);
    tracker.setStatus(db, appId, "awaiting_submit");
    return { resumePath: resumePdf, coverLetterPath: coverPdf };
  }

  async function handleApply(chatId: number, appId: number) {
    const app = tracker.getApplication(db, appId);
    if (!app) return;
    if (app.status !== "suggested") return; // idempotent
    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(app.job_id) as any;
    if (job.apply_type === "external") {
      tracker.setStatus(db, appId, "external_sent");
      await deps.sendMessage(
        chatId,
        formatExternalMessage({
          posting: {
            linkedinJobId: job.linkedin_job_id,
            title: job.title,
            company: job.company,
            location: job.location,
            url: job.url,
            applyType: "external",
            jdText: job.jd_text || "",
          },
          fitScore: 0,
          fitReason: "",
        }),
      );
      return;
    }
    tracker.setStatus(db, appId, "tailoring");
    const paths = await tailorAndCompile(appId, app.job_id, "");
    await deps.sendMessage(
      chatId,
      formatGate2Message(
        {
          posting: {
            linkedinJobId: job.linkedin_job_id,
            title: job.title,
            company: job.company,
            location: job.location,
            url: job.url,
            applyType: "easy_apply",
            jdText: job.jd_text || "",
          },
          fitScore: 0,
          fitReason: "",
        },
        paths,
      ),
    );
  }

  async function handleDeny(chatId: number, appId: number) {
    const app = tracker.getApplication(db, appId);
    if (!app) return;
    if (app.status !== "suggested") return; // idempotent
    tracker.setStatus(db, appId, "dismissed");
    await deps.sendMessage(chatId, `Dismissed application #${appId}.`);
  }

  async function handleCancel(chatId: number, appId: number) {
    const app = tracker.getApplication(db, appId);
    if (!app) return;
    if (app.status === "cancelled" || app.status === "applied") return;
    tracker.setStatus(db, appId, "cancelled");
    await deps.sendMessage(chatId, `Cancelled application #${appId}.`);
  }

  async function handleEditPrompt(chatId: number, appId: number) {
    pendingEditByChat.set(chatId, { appId });
    await deps.sendMessage(chatId, `Reply with edit instructions for app #${appId} (e.g. "emphasize Python").`);
  }

  async function handleSubmit(chatId: number, appId: number) {
    const app = tracker.getApplication(db, appId);
    if (!app) return;
    if (app.status !== "awaiting_submit") return; // idempotent
    await deps.sendMessage(chatId, `Submitting application #${appId}…`);
    await deps.startApply(appId);
  }

  return {
    async onCallback(chatId: number, data: string) {
      const [action, idStr] = data.split(":");
      const appId = Number(idStr);
      if (!Number.isFinite(appId)) return;
      switch (action) {
        case "apply": return handleApply(chatId, appId);
        case "deny": return handleDeny(chatId, appId);
        case "submit": return handleSubmit(chatId, appId);
        case "edit": return handleEditPrompt(chatId, appId);
        case "cancel": return handleCancel(chatId, appId);
      }
    },

    async onText(chatId: number, text: string, replyToAppId?: number) {
      const pending = replyToAppId !== undefined ? { appId: replyToAppId } : pendingEditByChat.get(chatId);
      if (!pending) return; // free-text outside an edit context is ignored
      const app = tracker.getApplication(db, pending.appId);
      if (!app || app.status === "cancelled" || app.status === "applied") return;
      pendingEditByChat.delete(chatId);
      tracker.appendEditNote(db, pending.appId, text);
      tracker.setStatus(db, pending.appId, "tailoring");
      const updated = tracker.getApplication(db, pending.appId)!;
      const paths = await tailorAndCompile(pending.appId, updated.job_id, updated.edit_notes ?? "");
      const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(updated.job_id) as any;
      await deps.sendMessage(
        chatId,
        formatGate2Message(
          {
            posting: {
              linkedinJobId: job.linkedin_job_id,
              title: job.title,
              company: job.company,
              location: job.location,
              url: job.url,
              applyType: "easy_apply",
              jdText: job.jd_text || "",
            },
            fitScore: 0,
            fitReason: "",
          },
          paths,
        ),
      );
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bot.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/bot.ts tests/bot.test.ts
git commit -m "feat: telegram bot handlers (Gate 1/Gate 2 + edit loop, idempotent)"
```

---

## Task 5: Scheduler

**Files:**
- Create: `worker/scheduler.ts`

No standalone test (a thin wrapper over `node-cron` + a clock); covered by Task 7's smoke run.

- [ ] **Step 1: Write `worker/scheduler.ts`**

```typescript
import cron from "node-cron";

/**
 * Schedule a daily task at HH:MM (24h, local). Returns a cancel function.
 * Callers handle their own error logging; cron will keep firing on failure.
 */
export function scheduleDaily(time: string, task: () => Promise<void>): () => void {
  const [hStr, mStr] = time.split(":");
  const expr = `${Number(mStr)} ${Number(hStr)} * * *`;
  const job = cron.schedule(expr, () => {
    task().catch((err) => console.error("[scheduler] task failed:", err));
  });
  return () => job.stop();
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add worker/scheduler.ts
git commit -m "feat: node-cron daily scheduler"
```

---

## Task 6: Worker boot + grammy wiring

**Files:**
- Create: `worker/index.ts`

`index.ts` is the thin glue layer. Tests cover the components; this file just wires them.

- [ ] **Step 1: Write `worker/index.ts`**

```typescript
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
        // Plan 4 will replace this with the Claude Agent SDK applier.
        await send(settings.telegram.chatId, `[Plan 4 not yet wired] Submit handler stub for app #${appId}.`);
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
    await handlers.onText(chatId, ctx.message.text);
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
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add worker/index.ts
git commit -m "feat: worker boot wires grammy + scheduler + pipeline"
```

---

## Task 7: One-shot CLI (pipeline:once + dry-run)

**Files:**
- Create: `worker/runOnce.ts`

- [ ] **Step 1: Write `worker/runOnce.ts`**

```typescript
import { readFileSync } from "node:fs";
import { Bot } from "grammy";
import { getEnv, getEnvOptional } from "../lib/env.js";
import { loadSettings, loadProfile } from "../lib/config.js";
import { ensureDirs, MASTER_RESUME, DB_PATH } from "../lib/paths.js";
import { openDb, migrate } from "../lib/db.js";
import { runDailyPipeline } from "./pipeline.js";
import { launchSession, fetchHtml as realFetchHtml } from "./session.js";
import { parseSearchHtml } from "./parseSearch.js";
import { rank } from "../lib/rank.js";

/**
 * Run the daily pipeline once, immediately. `--dry-run` skips DB suggestion writes
 * and Telegram sends, but still ingests and ranks (for end-to-end smoke testing).
 */
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
    if (!bot) { console.log(`[dry-send chat=${chatId}]\n${text}`); return; }
    await bot.api.sendMessage(chatId, text);
  };

  const context = await launchSession();
  try {
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
    console.log(`[runOnce] status=${result.status} foundNew=${result.foundNew} suggested=${result.suggested}`);
  } finally {
    await context.close();
  }
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Run full suite**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck clean; all tests pass (skipped tests stay skipped).

- [ ] **Step 4: Commit**

```bash
git add worker/runOnce.ts
git commit -m "feat: pipeline:once CLI with --dry-run"
```

---

## Done criteria for Plan 3

- `npm run typecheck && npx vitest run` is green (28 + 14 = 42 tests passing).
- `npm run worker` starts the long-running process: scheduler at `settings.schedule.time` + grammy bot listening for callbacks/text.
- `npm run pipeline:once -- --dry-run` exercises ingest+rank end-to-end without Telegram sends or DB suggestions.
- Both human gates are wired: Apply/Deny on the digest, Submit/Edit/Cancel on tailored materials, with idempotent transitions and the edit-loop accumulating notes.
- The Submit handler is a stub (`startApply`) that Plan 4 will replace with the Claude Agent SDK applier without touching `bot.ts` or `pipeline.ts`.

---

## Self-Review notes

- **Spec coverage:** §5 daily flow (8 PM scheduled pipeline → digest → Apply/Deny → Easy-Apply tailor → Gate 2 Submit/Edit/Cancel → edit loop) is implemented; the actual browser submit (§5.6) is intentionally a `startApply` stub for Plan 4. §7 idempotent callbacks: every handler short-circuits on the wrong starting status. §11 secrets via `.env` is implemented in `lib/env.ts`. Dry-run from §10 is implemented in `runOnce.ts`.
- **Placeholders:** none. The `startApply` stub is a real, working stub (sends a "[Plan 4 not yet wired]" message) — not a TODO.
- **Type consistency:** `Settings` (Plan 1 `lib/config.ts`) used identically in `runDailyPipeline`, `buildBot`, and `runOnce`. `Posting`/`ScoredPosting`/`TailoredDocs` (Plan 1 `lib/types.ts`) reused everywhere. `tracker.*` signatures (`(db, ...)`) preserved. `compileFn(texPath, outDir): Promise<string>` matches `lib/compile.ts:compilePdf`. `tailorFn(args)` matches `lib/tailor.ts:tailor` exactly. `rankFn` argument shape (`postings, {resumeText, profile, topN, model?}`) matches `lib/rank.ts:rank`.
