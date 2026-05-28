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
};

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
    expect(tracker.getRun(db, result.runId)?.status).toBe("ok");
    expect(tracker.getJobByLinkedinId(db, "1")).toBeTruthy();
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
    expect(sent).toEqual([]);
    expect(tracker.getJobByLinkedinId(db, "1")).toBeTruthy();
  });
});
