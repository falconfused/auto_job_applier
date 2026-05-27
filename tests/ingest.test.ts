import { describe, it, expect, beforeEach } from "vitest";
import { openDb, migrate, type DB } from "../lib/db.js";
import * as tracker from "../lib/tracker.js";
import { ingestWith } from "../worker/ingest.js";
import type { Posting } from "../lib/types.js";

function posting(id: string): Posting {
  return { linkedinJobId: id, title: `T${id}`, company: "Acme", location: "Remote", url: `https://x/${id}`, applyType: "easy_apply", jdText: "" };
}

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
});

const filters = [{ keywords: "SDE", location: "India", experienceLevel: "", datePosted: "" }];

describe("ingestWith", () => {
  it("adds new postings and returns only the new ones", async () => {
    const fetchHtml = async () => "<html></html>";
    const parse = () => [posting("1"), posting("2")];
    const result = await ingestWith({ db, filters, easyApplyOnly: true, fetchHtml, parse });
    expect(result.map((p) => p.linkedinJobId).sort()).toEqual(["1", "2"]);
    expect(tracker.getJobByLinkedinId(db, "1")).toBeTruthy();
  });

  it("dedupes postings already in the db across runs", async () => {
    const fetchHtml = async () => "<html></html>";
    const parse = () => [posting("1"), posting("2")];
    await ingestWith({ db, filters, easyApplyOnly: true, fetchHtml, parse });
    const second = await ingestWith({ db, filters, easyApplyOnly: true, fetchHtml, parse: () => [posting("2"), posting("3")] });
    expect(second.map((p) => p.linkedinJobId)).toEqual(["3"]);
  });

  it("dedupes within a single run across multiple filters", async () => {
    const twoFilters = [filters[0], { keywords: "Backend", location: "India", experienceLevel: "", datePosted: "" }];
    const fetchHtml = async () => "<html></html>";
    const parse = () => [posting("1")];
    const result = await ingestWith({ db, filters: twoFilters, easyApplyOnly: true, fetchHtml, parse });
    expect(result.map((p) => p.linkedinJobId)).toEqual(["1"]);
  });
});
