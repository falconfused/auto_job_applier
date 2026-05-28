import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildUnstopUrl, parseUnstopHtml } from "../worker/sources/unstop.js";

const FIXTURE = join(__dirname, "fixtures", "unstop_search.html");

describe("buildUnstopUrl", () => {
  it("builds /jobs?oppstatus=open with category", () => {
    const url = buildUnstopUrl({ type: "jobs", category: "engineering" });
    expect(url).toContain("https://unstop.com/jobs");
    expect(url).toContain("oppstatus=open");
    expect(url).toContain("category=engineering");
  });

  it("builds /internships path with location", () => {
    const url = buildUnstopUrl({ type: "internships", location: "delhi" });
    expect(url).toContain("/internships");
    expect(url).toContain("location=delhi");
  });
});

describe("parseUnstopHtml", () => {
  it.skipIf(!existsSync(FIXTURE))("extracts postings from real fixture", () => {
    const html = readFileSync(FIXTURE, "utf8");
    const postings = parseUnstopHtml(html, "jobs");
    expect(postings.length).toBeGreaterThan(5);
    for (const p of postings) {
      expect(p.sourceJobId).toMatch(/^\d+$/);
      expect(p.source).toBe("unstop");
      expect(p.title).toBeTruthy();
      expect(p.url).toMatch(/^https:\/\/unstop\.com\//);
    }
    const ids = postings.map((p) => p.sourceJobId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns [] for empty HTML", () => {
    expect(parseUnstopHtml("<html></html>")).toEqual([]);
  });
});
