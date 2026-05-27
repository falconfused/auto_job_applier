import { describe, it, expect } from "vitest";
import { rank } from "../lib/rank.js";
import type { Posting } from "../lib/types.js";

function postings(n: number): Posting[] {
  return Array.from({ length: n }, (_, i) => ({
    linkedinJobId: String(i),
    title: `Job ${i}`,
    company: "Acme",
    location: "Bangalore",
    url: `u${i}`,
    applyType: "easy_apply" as const,
    jdText: "python backend",
  }));
}

describe("rank", () => {
  it("returns top-N sorted by fitScore desc", async () => {
    const complete = async () => ({
      rankings: Array.from({ length: 5 }, (_, i) => ({
        linkedinJobId: String(i),
        fitScore: i * 10,
        fitReason: `reason ${i}`,
      })),
    });
    const result = await rank(postings(5), { resumeText: "x", profile: {}, topN: 3, complete });
    expect(result.map((r) => r.posting.linkedinJobId)).toEqual(["4", "3", "2"]);
    expect(result[0].fitScore).toBe(40);
    expect(result[0].fitReason).toBe("reason 4");
  });

  it("ignores unknown ids returned by the model", async () => {
    const complete = async () => ({
      rankings: [{ linkedinJobId: "999", fitScore: 99, fitReason: "ghost" }],
    });
    const result = await rank(postings(2), { resumeText: "x", profile: {}, topN: 5, complete });
    expect(result).toEqual([]);
  });

  it("returns empty for empty input without calling the model", async () => {
    let called = false;
    const complete = async () => {
      called = true;
      return { rankings: [] };
    };
    const result = await rank([], { resumeText: "x", profile: {}, topN: 5, complete });
    expect(result).toEqual([]);
    expect(called).toBe(false);
  });
});
