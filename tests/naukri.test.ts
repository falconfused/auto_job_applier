import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildNaukriUrl, parseNaukriHtml } from "../worker/sources/naukri.js";

const FIXTURE = join(__dirname, "fixtures", "naukri_search.html");

describe("buildNaukriUrl", () => {
  it("builds a basic url with keyword + location slugs", () => {
    const url = buildNaukriUrl({ keywords: "backend developer", location: "noida", experience: "0" });
    expect(url).toContain("/backend-developer-jobs-in-noida");
    expect(url).toContain("k=backend+developer");
    expect(url).toContain("l=noida");
    expect(url).toContain("experience=0");
  });

  it("handles multi-keyword + multi-location", () => {
    const url = buildNaukriUrl({
      keywords: "backend developer, sde, mts",
      location: "greater noida, noida",
      experience: "0",
    });
    expect(url).toContain("/backend-developer-sde-mts-jobs-in-greater-noida");
  });
});

describe("parseNaukriHtml", () => {
  it.skipIf(!existsSync(FIXTURE))("extracts postings with required fields from real fixture", () => {
    const html = readFileSync(FIXTURE, "utf8");
    const postings = parseNaukriHtml(html);
    expect(postings.length).toBeGreaterThan(5);
    for (const p of postings) {
      expect(p.sourceJobId).toMatch(/^\d+$/);
      expect(p.source).toBe("naukri");
      expect(p.title).toBeTruthy();
      expect(p.company).toBeTruthy();
      expect(p.url).toMatch(/^https:\/\/www\.naukri\.com\//);
      expect(p.applyType).toBe("external");
    }
    const ids = postings.map((p) => p.sourceJobId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns [] for HTML with no job tuples", () => {
    expect(parseNaukriHtml("<html><body>nope</body></html>")).toEqual([]);
  });
});
