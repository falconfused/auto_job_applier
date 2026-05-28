import { describe, it, expect, beforeEach } from "vitest";
import { openDb, migrate, type DB } from "../lib/db.js";
import * as tracker from "../lib/tracker.js";
import { applyToJobWith } from "../worker/applyAgent.js";
import type { Posting } from "../lib/types.js";

const sample: Posting = {
  sourceJobId: "55", source: "linkedin", title: "Backend Engineer", company: "Acme", location: "Bangalore",
  url: "https://linkedin.com/jobs/view/55", applyType: "easy_apply", jdText: "",
};

let db: DB;
let appId: number;
let sent: string[];

beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
  const jobId = tracker.addJob(db, sample);
  appId = tracker.createApplication(db, jobId);
  tracker.setStatus(db, appId, "awaiting_submit");
  tracker.setResumePaths(db, appId, "/tmp/r.pdf", "/tmp/c.pdf");
  sent = [];
});

const settings = {
  schedule: { time: "20:00" },
  ranking: { topN: 10 },
  search: { filters: [] },
  apply: { dailyCap: 5, easyApplyOnly: true },
  llm: { model: "claude-sonnet-4-6" },
  telegram: { chatId: 42 },
};

function deps(over: any = {}) {
  return {
    sendMessage: async (_id: number, t: string) => { sent.push(t); },
    openJobPage: async (_url: string) => ({ html: "<html>job page</html>", close: async () => {} }),
    runFillingAgent: async (_page: any, _args: any) => ({ ready: true }),
    finalizeSubmit: async (_page: any) => {},
    ...over,
  };
}

describe("applyToJobWith", () => {
  it("blocks when daily cap is hit and notifies", async () => {
    for (let i = 0; i < 5; i++) {
      const jid = tracker.addJob(db, { ...sample, sourceJobId: `pre${i}` });
      const aid = tracker.createApplication(db, jid);
      tracker.setStatus(db, aid, "applied");
    }
    const result = await applyToJobWith({ db, appId, settings, profile: {}, deps: deps() });
    expect(result.outcome).toBe("cap_hit");
    expect(sent.some((s) => /cap/i.test(s))).toBe(true);
    expect(tracker.getApplication(db, appId)?.status).toBe("awaiting_submit");
  });

  it("aborts on challenge page and notifies", async () => {
    const result = await applyToJobWith({
      db, appId, settings, profile: {},
      deps: deps({ openJobPage: async () => ({ html: "<html>security check captcha</html>", close: async () => {} }) }),
    });
    expect(result.outcome).toBe("challenge");
    expect(sent.some((s) => /challenge|captcha|checkpoint|security/i.test(s))).toBe(true);
    expect(tracker.getApplication(db, appId)?.status).toBe("failed");
  });

  it("escalates when the filling agent returns an unanswerable question", async () => {
    const result = await applyToJobWith({
      db, appId, settings, profile: {},
      deps: deps({ runFillingAgent: async () => ({ ready: false, escalation: "What is your annual sales quota?" }) }),
    });
    expect(result.outcome).toBe("escalated");
    expect(sent.some((s) => /annual sales quota/.test(s))).toBe(true);
    expect(tracker.getApplication(db, appId)?.status).toBe("awaiting_submit");
  });

  it("submits on happy path and marks applied", async () => {
    let submitted = false;
    const result = await applyToJobWith({
      db, appId, settings, profile: {},
      deps: deps({ finalizeSubmit: async () => { submitted = true; } }),
    });
    expect(result.outcome).toBe("applied");
    expect(submitted).toBe(true);
    expect(tracker.getApplication(db, appId)?.status).toBe("applied");
  });
});
