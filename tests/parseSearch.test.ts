import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseSearchHtml } from "../worker/parseSearch.js";

const FIXTURE = join(__dirname, "fixtures", "linkedin_search.html");

describe("parseSearchHtml", () => {
  it.skipIf(!existsSync(FIXTURE))("extracts postings with required fields from the captured page", () => {
    const html = readFileSync(FIXTURE, "utf8");
    const postings = parseSearchHtml(html);
    expect(postings.length).toBeGreaterThan(0);
    for (const p of postings) {
      expect(p.linkedinJobId).toBeTruthy();
      expect(p.title).toBeTruthy();
      expect(p.company).toBeTruthy();
      expect(p.url).toMatch(/^https?:\/\//);
      expect(["easy_apply", "external"]).toContain(p.applyType);
    }
    const ids = postings.map((p) => p.linkedinJobId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns [] for HTML with no job cards", () => {
    expect(parseSearchHtml("<html><body>no jobs here</body></html>")).toEqual([]);
  });
});
