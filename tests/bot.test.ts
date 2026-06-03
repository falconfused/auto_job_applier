import { describe, it, expect, beforeEach } from "vitest";
import { openDb, migrate, type DB } from "../lib/db.js";
import * as tracker from "../lib/tracker.js";
import { buildBot } from "../worker/bot.js";
import type { Posting } from "../lib/types.js";

const sample: Posting = {
  sourceJobId: "100",
  source: "linkedin",
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
};

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
      writeFile: async () => {},
      startApply: async (_appId) => {},
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
    expect(sent.filter((m) => /dismissed|denied/i.test(m.text)).length).toBe(1);
  });

  it("Apply on external job → external_sent + link reply", async () => {
    const job = tracker.getJobBySource(db, "linkedin", "100")!;
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
    expect(app?.status).toBe("awaiting_submit");
    expect(sent.some((m) => /Submit/i.test(m.text))).toBe(true);
  });

  it("Submit calls startApply with the appId", async () => {
    let started = -1;
    const bot = mkBot({ startApply: async (id) => { started = id; } });
    await bot.onCallback(42, `submit:${appId}`);
    expect(started).toBe(appId);
  });
});
