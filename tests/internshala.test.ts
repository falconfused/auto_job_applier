import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildInternshalaUrl, parseInternshalaHtml } from "../worker/sources/internshala.js";

const FIXTURE = join(__dirname, "fixtures", "internshala_search.html");

describe("buildInternshalaUrl", () => {
  it("builds a basic internship search URL", () => {
    const url = buildInternshalaUrl({ type: "internship", category: "computer-science" });
    expect(url).toBe("https://internshala.com/internships/computer-science-internship/");
  });

  it("builds a job search URL with location", () => {
    const url = buildInternshalaUrl({ type: "job", category: "backend-development", location: "delhi" });
    expect(url).toBe("https://internshala.com/jobs/backend-development-jobs/delhi/");
  });

  it("appends keyword search query param", () => {
    const url = buildInternshalaUrl({
      type: "internship",
      category: "full-stack-development",
      location: "work-from-home",
      keywords: "node.js",
    });
    expect(url).toContain("/internships/full-stack-development-internship/work-from-home/");
    expect(url).toContain("search=node.js");
  });
});

describe("parseInternshalaHtml", () => {
  it.skipIf(!existsSync(FIXTURE))("extracts postings with required fields from the captured page", () => {
    const html = readFileSync(FIXTURE, "utf8");
    const postings = parseInternshalaHtml(html);
    expect(postings.length).toBeGreaterThan(10);
    for (const p of postings) {
      expect(p.sourceJobId).toMatch(/^\d+$/);
      expect(p.source).toBe("internshala");
      expect(p.title).toBeTruthy();
      expect(p.company).toBeTruthy();
      expect(p.url).toMatch(/^https:\/\/internshala\.com\//);
      expect(p.applyType).toBe("external");
    }
    // No duplicates
    const ids = postings.map((p) => p.sourceJobId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns [] for HTML with no internship cards", () => {
    expect(parseInternshalaHtml("<html><body>nope</body></html>")).toEqual([]);
  });

  it("ignores ad blocks (no internshipid attr in real cards = ad)", () => {
    const adHtml = `<div class="container-fluid individual_internship" id="image_ad_7818">
      <div class="internship_meta"><div class="company-name">Ad Company</div></div></div>`;
    expect(parseInternshalaHtml(adHtml)).toEqual([]);
  });
});
