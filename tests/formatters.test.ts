import { describe, it, expect } from "vitest";
import { formatDigest, formatGate2Message, formatExternalMessage } from "../worker/formatters.js";
import type { ScoredPosting } from "../lib/types.js";

function scored(id: string, applyType: "easy_apply" | "external", score: number): ScoredPosting {
  return {
    posting: {
      sourceJobId: id,
      source: "linkedin",
      title: `Title ${id}`,
      company: `Co ${id}`,
      location: "Remote",
      url: `https://linkedin.com/jobs/view/${id}`,
      applyType,
      jdText: "",
    },
    fitScore: score,
    fitReason: `reason ${id}`,
  };
}

describe("formatDigest", () => {
  it("renders one card per posting with fit score and reason", () => {
    const msg = formatDigest([scored("1", "easy_apply", 80), scored("2", "external", 60)]);
    expect(msg).toContain("Title 1");
    expect(msg).toContain("Co 1");
    expect(msg).toContain("80");
    expect(msg).toContain("reason 1");
    expect(msg).toContain("Title 2");
    expect(msg).toContain("external");
  });

  it("returns a 'no matches' message for empty input", () => {
    expect(formatDigest([])).toMatch(/no.*matches/i);
  });
});

describe("formatExternalMessage", () => {
  it("includes the job url", () => {
    const msg = formatExternalMessage(scored("9", "external", 70));
    expect(msg).toContain("https://linkedin.com/jobs/view/9");
  });
});

describe("formatGate2Message", () => {
  it("describes what will be submitted", () => {
    const msg = formatGate2Message(scored("3", "easy_apply", 90), { resumePath: "/r.pdf", coverLetterPath: "/c.pdf" });
    expect(msg).toContain("Title 3");
    expect(msg).toContain("Co 3");
    expect(msg).toContain("Submit");
    expect(msg).toContain("Edit");
  });
});
