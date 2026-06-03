import { describe, it, expect, beforeEach } from "vitest";
import { openDb, migrate, type DB } from "../lib/db.js";
import * as tracker from "../lib/tracker.js";
import { listApplications, listRuns } from "../lib/dashboard.js";
import type { Posting } from "../lib/types.js";

const sample: Posting = {
  sourceJobId: "1", source: "linkedin", title: "Backend Engineer", company: "Acme", location: "Bangalore",
  url: "https://linkedin.com/jobs/view/1", applyType: "easy_apply", jdText: "",
};

let db: DB;
beforeEach(() => { db = openDb(":memory:"); migrate(db); });

describe("listApplications", () => {
  it("joins job + application fields", () => {
    const jobId = tracker.addJob(db, sample);
    const appId = tracker.createApplication(db, jobId);
    tracker.setStatus(db, appId, "applied");
    const rows = listApplications(db);
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe("Backend Engineer");
    expect(rows[0].status).toBe("applied");
    expect(rows[0].apply_type).toBe("easy_apply");
  });

  it("returns newest first", async () => {
    const a = tracker.addJob(db, sample);
    await new Promise((r) => setTimeout(r, 5));
    const b = tracker.addJob(db, { ...sample, sourceJobId: "2", title: "Newer" });
    tracker.createApplication(db, a);
    await new Promise((r) => setTimeout(r, 5));
    tracker.createApplication(db, b);
    const rows = listApplications(db);
    expect(rows[0].title).toBe("Newer");
  });
});

describe("listRuns", () => {
  it("returns runs newest first", async () => {
    tracker.recordRun(db, { searched: 1, foundNew: 2, suggested: 2, status: "ok" });
    await new Promise((r) => setTimeout(r, 5));
    tracker.recordRun(db, { searched: 1, foundNew: 0, suggested: 0, status: "failed", error: "boom" });
    const rows = listRuns(db);
    expect(rows.length).toBe(2);
    expect(rows[0].status).toBe("failed");
  });
});
