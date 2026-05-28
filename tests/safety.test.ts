import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openDb, migrate, type DB } from "../lib/db.js";
import * as tracker from "../lib/tracker.js";
import { checkDailyCap, detectChallenge } from "../worker/safety.js";
import type { Posting } from "../lib/types.js";

const sample: Posting = {
  linkedinJobId: "x", title: "T", company: "C", location: "L", url: "u", applyType: "easy_apply", jdText: "",
};

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
});

describe("checkDailyCap", () => {
  it("allows when under cap", () => {
    const jobId = tracker.addJob(db, sample);
    const appId = tracker.createApplication(db, jobId);
    tracker.setStatus(db, appId, "applied");
    expect(checkDailyCap(db, 5)).toEqual({ ok: true, appliedToday: 1 });
  });

  it("blocks when at or over cap", () => {
    for (let i = 0; i < 3; i++) {
      const jobId = tracker.addJob(db, { ...sample, linkedinJobId: `j${i}` });
      const appId = tracker.createApplication(db, jobId);
      tracker.setStatus(db, appId, "applied");
    }
    expect(checkDailyCap(db, 3)).toEqual({ ok: false, appliedToday: 3 });
  });
});

describe("detectChallenge", () => {
  it("flags a captcha/checkpoint page", () => {
    const html = readFileSync(join(__dirname, "fixtures", "linkedin_challenge.html"), "utf8");
    expect(detectChallenge(html)).toBe(true);
  });

  it("does not flag a normal page", () => {
    expect(detectChallenge("<html><body>jobs feed</body></html>")).toBe(false);
  });
});
