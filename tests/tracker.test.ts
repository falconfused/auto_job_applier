import { describe, it, expect, beforeEach } from "vitest";
import { openDb, migrate, type DB } from "../lib/db.js";
import * as tracker from "../lib/tracker.js";
import type { Posting } from "../lib/types.js";

const sample: Posting = {
  linkedinJobId: "123",
  title: "Backend Engineer",
  company: "Acme",
  location: "Bangalore",
  url: "https://linkedin.com/jobs/view/123",
  applyType: "easy_apply",
  jdText: "Build APIs in Python.",
};

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
});

describe("tracker", () => {
  it("addJob is idempotent on linkedinJobId", () => {
    const id1 = tracker.addJob(db, sample);
    const id2 = tracker.addJob(db, sample);
    expect(id1).toBe(id2);
  });

  it("getJobByLinkedinId returns the row", () => {
    tracker.addJob(db, sample);
    const row = tracker.getJobByLinkedinId(db, "123");
    expect(row?.company).toBe("Acme");
    expect(row?.apply_type).toBe("easy_apply");
  });

  it("createApplication starts as suggested and transitions", () => {
    const jobId = tracker.addJob(db, sample);
    const appId = tracker.createApplication(db, jobId);
    expect(tracker.getApplication(db, appId)?.status).toBe("suggested");
    tracker.setStatus(db, appId, "tailoring");
    expect(tracker.getApplication(db, appId)?.status).toBe("tailoring");
  });

  it("setStatus rejects an unknown status", () => {
    const jobId = tracker.addJob(db, sample);
    const appId = tracker.createApplication(db, jobId);
    expect(() => tracker.setStatus(db, appId, "banana" as never)).toThrow();
  });

  it("appendEditNote accumulates notes", () => {
    const jobId = tracker.addJob(db, sample);
    const appId = tracker.createApplication(db, jobId);
    tracker.appendEditNote(db, appId, "emphasize python");
    tracker.appendEditNote(db, appId, "drop project X");
    const notes = tracker.getApplication(db, appId)?.edit_notes ?? "";
    expect(notes).toContain("emphasize python");
    expect(notes).toContain("drop project X");
  });

  it("setStatus applied sets applied_at", () => {
    const jobId = tracker.addJob(db, sample);
    const appId = tracker.createApplication(db, jobId);
    tracker.setStatus(db, appId, "applied");
    expect(tracker.getApplication(db, appId)?.applied_at).toBeTruthy();
  });

  it("recordRun stores counts", () => {
    const runId = tracker.recordRun(db, { searched: 3, foundNew: 5, suggested: 5, status: "ok" });
    const run = tracker.getRun(db, runId);
    expect(run?.found_new).toBe(5);
    expect(run?.status).toBe("ok");
  });
});
