import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildCutshortUrl, parseCutshortHtml } from "../worker/sources/cutshort.js";

const FIXTURE = join(__dirname, "fixtures", "cutshort_search.html");

describe("buildCutshortUrl", () => {
  it("builds role-based path", () => {
    expect(buildCutshortUrl({ role: "backend-developer" })).toBe(
      "https://cutshort.io/jobs/backend-developer-jobs-in-india",
    );
  });

  it("falls back to /jobs without role", () => {
    expect(buildCutshortUrl({})).toBe("https://cutshort.io/jobs");
  });

  it("respects custom location", () => {
    expect(buildCutshortUrl({ role: "fullstack-engineer", location: "remote" })).toContain(
      "/jobs/fullstack-engineer-jobs-in-remote",
    );
  });
});

describe("parseCutshortHtml", () => {
  it.skipIf(!existsSync(FIXTURE))("extracts unique postings from real fixture", () => {
    const html = readFileSync(FIXTURE, "utf8");
    const postings = parseCutshortHtml(html);
    expect(postings.length).toBeGreaterThan(3);
    for (const p of postings) {
      expect(p.sourceJobId).toBeTruthy();
      expect(p.source).toBe("cutshort");
      expect(p.title).toBeTruthy();
      expect(p.url).toMatch(/^https?:\/\/cutshort\.io\/job\//);
    }
    const ids = postings.map((p) => p.sourceJobId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns [] for empty HTML", () => {
    expect(parseCutshortHtml("<html></html>")).toEqual([]);
  });
});
